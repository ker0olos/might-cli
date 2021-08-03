#! /usr/bin/env node

import minimist from 'minimist';

import c from 'ansi-colors';
import prompts from 'prompts';

import draftlog from 'draftlog';

import isCI from 'is-ci';

import sanitize from 'sanitize-filename';

import { basename, join } from 'path';

import { readJSON, writeJSON, writeFileSync } from 'fs-extra';

import { spawn } from 'child_process';

import exit from 'exit';

import { stepsToString } from 'might-core';

import { runner } from './runner.js';

type Map = import('./runner.js').Map;

type Config = {
  startCommand: string,
  url: string,
  targets: string[],
  viewport: {
    width: number,
    height: number
  },
  titleBasedScreenshots: boolean,
  parallelTests: number,
  defaultTimeout: number,
  tolerance: number,
  antialiasingTolerance: number,
  pageErrorIgnore: string[],
  coverageExclude: string[]
}

declare global {
  interface Console {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    draft(...data: any[]): Console['draft']
  }
}

let running: import('child_process').ChildProcessWithoutNullStreams;

let quiet = isCI;

async function readConfig(): Promise<Config>
{
  let config: Config;

  try
  {
    config = await readJSON(resolve('might.config.json'));
  }
  catch
  {
    if (quiet)
      return;

    console.log(c.bold.yellow('? Config is missing or corrupted.'));

    const newConfig = await prompts({
      type: 'toggle',
      name: 'value',
      message: 'Do you want to create a new config?',
      initial: false,
      active: 'yes',
      inactive: 'no'
    });

    if (!newConfig.value)
      return;

    console.log('\n? (e.g. npm run start) [Leave empty if none is needed].');

    const startCommand = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter a command that starts a http server for your app:'
    });

    console.log('\n? (e.g. http://localhost:8080) [required]');

    const url = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter the URL of your app:'
    });

    if (!url.value)
      return;

    console.log();

    config = {
      startCommand: startCommand.value || null,
      url: url.value,
      targets: [ 'chromium', 'firefox', 'webkit' ],
      viewport: {
        width: null,
        height: null
      },
      titleBasedScreenshots: false,
      parallelTests: 3,
      defaultTimeout: 25000,
      tolerance: 2.5,
      antialiasingTolerance: 3.5,
      pageErrorIgnore: [
        'net::ERR_ABORTED',
        'NS_BINDING_ABORTED',
        'access control checks',
        'Load request cancelled'
      ],
      coverageExclude: [
        // popular directories people hate
        '/node_modules/**',
        '/webpack/**',
        '/ws \'(\'ignored\')\'',
        '/\'(\'webpack\')\'/**',
        '/\'(\'webpack\')\'-dev-server/**'
      ]
    };

    await writeJSON(resolve('might.config.json'), config, { spaces: 2 });
  }
  finally
  {
    return config;
  }
}

async function readMap(dialog: boolean): Promise<Map>
{
  let map = [];

  try
  {
    map = (await readJSON(resolve('might.map.json'))).data;
  }
  catch
  {
    if (!dialog)
      return;

    console.log(c.bold.yellow('Map is missing or corrupted.'));
    console.log(c.bold('Make sure you have a file called "might.map.json" in the root of the project\'s directory.'));

    console.log();
  }
  finally
  {
    return map;
  }
}

/** the main process
*/
async function main()
{
  const argv = minimist(process.argv.slice(2));

  // open help menu
  if (argv.help || argv.h)
  {
    console.log(c.bold.cyan('--help, -h'), '       Opens this help menu.');
    console.log(c.bold.cyan('--map, -m, -x'), '    Opens Might UI (even if not installed).');
    console.log(c.bold.cyan('--quiet, -q'), '      Disables all animations.');
    console.log(c.bold.cyan('--print'), '          Prints all the targeted tests.');

    console.log();

    console.log(c.bold.cyan('--target, -t'), '     [string]   List the tests that should run (use their titles and separate them with a comma).');
    console.log(c.bold.cyan('--update, -u'), '     [boolean]  Updates the screenshots of targeted tests (if no tests were targeted it updates any failed tests).');
    console.log(c.bold.cyan('--clean'), '          [boolean]  Deletes all unused screenshots.');

    console.log();

    console.log(c.bold.cyan('--chromium\n--firefox'), '        Ignores the config and runs tests on the specified browser.', c.bold.cyan('\n--webkit'));

    console.log();

    console.log(c.bold.cyan('--parallel, -p'), '   [number]   Control how many tests should be allowed to run at the same time.');
    console.log(c.bold.cyan('--coverage, -c'), '   [boolean]  Outputs a coverage report at the end.');
  }
  // opens might-ui (even if not installed because npx is cool)
  else if (argv.map || argv.m || argv.x)
  {
    running = spawn('npx might-ui', { shell: true, cwd: process.cwd() });

    running.stdout.on('data', (data) => console.log(data.toString()));

    running.stderr.on('data', (data) => console.log(c.red(data.toString())));

    // awaits for eternity
    await new Promise(() => undefined);
  }
  // display version number
  else if (argv.version || argv.v)
  {
    const json = await readJSON(join(__dirname, '../package.json'));

    console.log(`v${json.version}`);
  }
  // start runner
  else
  {
    if (quiet)
    {
      console.log(c.magenta('Might discovered it\'s running inside a CI environment, it will be quieter.\n'));
    }
    else if (argv.q || argv.quiet)
    {
      quiet = true;
      
      console.log(c.magenta('Might will be quieter.\n'));
    }

    // read the config file
    const config = await readConfig();

    if (!config)
      throw new Error('Error: Unable to load config file');

    // make sure that at least there's one supported browser included in targets
    if (
      !Array.isArray(config.targets) ||
      !config.targets.some(t => [ 'chromium', 'firefox', 'webkit' ].includes(t))
    )
    {
      console.log(c.red('Error: Invalid config'));

      throw new Error(`${c.bold('Incorrect "targets":')} the supported browsers are [ "chromium", "firefox", "webkit" ]`);
    }

    // spawn the start command
    if (typeof config.startCommand === 'string' && config.startCommand.length)
      start(config.startCommand);

    // read the map file
    const map = await readMap(true);

    await run(map, config);
  }
}

/** run the tests and output their progress and outcome
* to the terminal
*/
async function run(map: Map, config: Config)
{
  const argv = minimist(process.argv.slice(2));

  const clean = argv.clean;

  const update = argv.update || argv.u;

  let coverage = argv.coverage || argv.c;

  let target = argv.target ?? argv.t;

  const parallel = argv.parallel ?? argv.p;

  const updateFailed = update && !target;
  const updateAll = update && target;

  const meta = await readJSON(resolve('package.json'));

  // handle target parsing
  if (typeof target === 'string')
  {
    // split by commas but allow commas to be escaped
    target = target.match(/(?:\\,|[^,])+/g).map((t) => t.trim());

    if (target.length <= 0)
      target = undefined;
  }
  // interactive tui to choose targets
  else if (target)
  {
    const input = await prompts({
      name: 'target',
      type: 'multiselect',
      message: 'Choice your targets?',
      choices: map.map(({ title }) => ({ title, value: title.replace(/,/g, '\\,') }))
    });

    target = input.target.join(',');

    console.log();
  }
  else
  {
    target = undefined;
  }

  if (argv.print)
  {
    map
      .filter(t => !target || (target as string[]).includes(t.title))
      .forEach((test, i) =>
      {
        if (i > 0)
          console.log();

        console.log(c.bold(`${test.title ?? 'Untitled'}:`), stepsToString(test.steps, {
          pretty: true,
          url: config.url
        }).trim());
      });

    return;
  }

  if (argv.chromium)
    config.targets = [ 'chromium' ];
  else if (argv.firefox)
    config.targets = [ 'firefox' ];
  else if (argv.webkit)
    config.targets = [ 'webkit' ];

  // currently only chromium comes with built-in coverage support
  if (coverage && !config.targets.includes('chromium'))
  {
    coverage = false;

    console.log(c.bold.yellow('To enable coverage reports please add "chromium" to your targets.\n'));
  }

  // hide cursor
  hideCursor();

  // let length = 0;
  let draft: (s?: string) => void | undefined;

  const animation = [ '|', '/', '-', '\\' ];

  const running = {};

  await runner({
    url: config.url,
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height
    },
    map,
    meta,
    target,
    browsers: config.targets,
    update,
    parallel: parallel ?? config.parallelTests,
    coverage,
    clean,
    screenshotsDir: resolve('__might__'),
    coverageDir: resolve('__coverage__'),
    titleBasedScreenshots: config.titleBasedScreenshots,
    stepTimeout: config.defaultTimeout,
    tolerance: config.tolerance,
    antialiasingTolerance: config.antialiasingTolerance,
    pageErrorIgnore: config.pageErrorIgnore,
    coverageExclude: config.coverageExclude
  },
  (type, value) =>
  {
    // the amount of tasks that are going to run
    // if (type === 'started')
    //   length = value;

    // an error occurred during a test
    if (type === 'error')
    {
      let error: Error;

      // if there's a property called diff that means that it's a mismatch error
      if (value.diff)
      {
        const filename = resolve(sanitize(`might.error.${new Date().toISOString()}.png`));

        //  write the difference image to disk
        writeFileSync(filename, value.diff);

        error = new Error(`${value.message}\n${c.yellow(`Diff Image: ${c.white(filename)}`)}`);
      }
      else
      {
        error = new Error(value.message || value);
      }

      throw error;
    }

    // all tests are done
    if (type === 'done')
    {
      // no tests at all
      if (value.total === 0 && value.skipped === 0)
      {
        console.log(c.bold.yellow('Map has no tests.'));
      }
      // all tests were skipped
      else if (value.total === value.skipped)
      {
        console.log(c.bold.magenta('All tests were skipped.'));
      }
      // print a summary of all the tests
      else
      {
        const passed = (value.passed) ? `${c.bold.green(`${value.passed} passed`)}, ` : '';
        const updated = (value.updated) ? `${c.bold.yellow(`${value.updated} updated`)}, ` : '';
        const failed = (value.failed) ? `${c.bold.red(`${value.failed} failed`)}, ` : '';
        const skipped = (value.skipped) ? `${c.bold.magenta(`${value.skipped} skipped`)}, ` : '';

        const total = `${value.total} total`;

        let updateNotice = '';

        if (updateAll)
          updateNotice = ' (All TARGETED TESTS WERE UPDATED):';
        else if (updateFailed)
          updateNotice = ` (ALL ${c.bold.red('FAILED')} TESTS WERE UPDATED):`;

        // draft is used to show info before summary is printed
        // when summary is printed it show replace whatever what shown in that spot

        // use a normal log if no info was being shown

        console.log(`\nSummary:${updateNotice} ${passed}${updated}${failed}${skipped}${total}.`);

        if (!target && value.unused.length)
        {
          const plural = value.unused.length > 1 ?  'screenshots' : 'screenshot';
          const pronoun = value.unused.length > 1 ?  'them' : 'it';

          // screenshots are only cleaned if no tests are targeted
          if (clean)
            console.log(c.yellow.bold(`\nDeleted ${value.unused.length} unused ${plural}.`));
          // only log about unused screenshots when no tests are targeted
          else
            console.log(c.yellow(`\nFound ${value.unused.length} unused ${plural}, use --clean to delete ${pronoun}.`));
        }
      }
    }

    // one of the tests made progress
    if (type === 'progress')
    {
      if (value.state === 'running')
      {
        const draft = quiet ? console.log : console.draft(c.bold.blueBright('RUNNING (|)'), value.title);

        running[value.id] = {
          draft,
          frame: 1,
          timestamp: Date.now()
        };

        if (!quiet)
        {
          running[value.id].interval = setInterval(() =>
          {
            const { timestamp, frame } = running[value.id];

            const time = roundTime(Date.now(), timestamp);

            // upgrade the animation to the next frame
            if (frame >= 3)
              running[value.id].frame = 0;
            else
              running[value.id].frame = frame + 1;

            // show that a test is taking too much time (over 15 seconds)
            if (time >= 15)
              draft(c.bold.blueBright('RUNNING'), c.bold.red(`(${time}s)`), value.title);
            else
              // eslint-disable-next-line security/detect-object-injection
              draft(c.bold.blueBright(`RUNNING (${animation[frame]})`), value.title);
          }, 500);
        }
      }
      else
      {
        if (running[value.id].interval)
          clearInterval(running[value.id].interval);
      }

      if (value.state === 'updated')
      {
        const time = roundTime(Date.now(),  running[value.id].timestamp);

        let reason = '(NEW)';

        if (updateFailed && value.force)
          reason = c.red('(FAILED)');
        else if (value.force)
          reason = '(FORCED)';

        running[value.id].draft(c.bold.yellow(`UPDATED ${reason} (${time}s)`), value.title);
      }
      else if (value.state === 'failed')
      {
        const time = roundTime(Date.now(),  running[value.id].timestamp);

        running[value.id].draft(c.bold.red(`FAILED (${time}s)`), value.title);
      }
      else if (value.state === 'passed')
      {
        const time = roundTime(Date.now(),  running[value.id].timestamp);

        running[value.id].draft(c.bold.green(`PASSED (${time}s)`), value.title);
      }
    }

    if (type === 'coverage')
    {
      if (value.state === 'running')
      {
        console.log();

        draft = console.draft(c.bold.blueBright('Generating Coverage Report...'));
      }

      if (value.state === 'done')
      {
        const overall = value.overall;

        const files: {
          name: string,
          coverage: number,
          uncoveredLines: number[]
        }[] = value.files;

        if (files?.length)
        {
          let length = 0;
          
          files.forEach(f => f.name.length > length ? length = f.name.length : undefined);
          
          draft(c.grey(`Files ${Array(length - 2).fill(' ').join('')} Cov   Uncovered`));
          console.log(c.grey(`----- ${Array(length - 2).fill(' ').join('')} ---   ---------`));

          console.log(files?.map(({ name, coverage, uncoveredLines }) =>
          {
            let color = c.red;

            if (coverage >= 90)
              color = c.green;
            else if (coverage >= 70)
              color = c.yellow;

            const slice = uncoveredLines.length > 3 ? '...' : '';
            
            const leftPadding = Array(length - name.length + 3).fill(' ').join('');

            const rightPadding = Array(1).fill(' ').join('');

            const pct = coverage >= 100 ? c.green.bold('✔') : color.bold(`${coverage}%`);
            
            const filename = c.grey(name.replace(basename(name), '')) + c.bold(basename(name));
            
            return `${filename} ${leftPadding} ${pct} ${rightPadding} ${c.red.bold(uncoveredLines.slice(0, 3).join(', ') + slice)}`;
          }).join('\n'));

          console.log();

          let color = c.red;

          if (overall >= 90)
            color = c.green;
          else if (overall >= 70)
            color = c.yellow;
          
          console.log('Total Coverage is ' + color.bold(`${overall}%`));
        }
        else
        {
          draft('');
        }
      }
    }
  });
}

/** resolves a path using the current working directory
*/
const resolve = (...args: string[]) => join(process.cwd(), ...args);

/** spawns the start command
*/
function start(command: string)
{
  running = spawn(command, { shell: true, cwd: process.cwd() });
}

function roundTime(end: number, start: number)
{
  const num = (end - start) / 1000;

  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/** kill the the start process if it's running
*/
function kill()
{
  // since the app can't run async code while dying
  // we spawn a new process
  // that will kill any running children then exits automatically

  if (running)
    spawn(process.argv[0], [ join(__dirname, 'kill.js'), running.pid.toString() ]);
}

function showCursor()
{
  if (process.stderr.isTTY)
    process.stderr.write('\u001B[?25h');
}

function hideCursor()
{
  if (process.stderr.isTTY)
    process.stderr.write('\u001B[?25l');
}

function exitGracefully()
{
  // ensure the to enable input and cursor
  showCursor();

  console.log();

  // exit main process gracefully
  exit(0);
}

function exitForcefully()
{
  // ensure the to enable input and cursor
  showCursor();

  console.log();

  // force exit the process
  exit(1);
}

// listen for interruptions
process.on('SIGINT', () =>
{
  // print a notice about the manual termination
  console.log(c.yellow('\n\nProcess was interrupted.'));

  // kill all running children
  kill();

  // exit the main process forcefully
  exitGracefully();
});

// start the main process
(async() =>
{
  try
  {
    // add new line
    console.log();

    // setup draftlog
    draftlog.into(console);

    await main();

    // kill all running children
    kill();

    // exit the main process gracefully
    exitGracefully();
  }
  catch (e)
  {
    // print the error

    console.log(c.red(`\n${e.message || e}`));
    // console.log(c.red(`\n${e.stack}`));

    // kill all running children
    kill();

    exitForcefully();
  }
})();
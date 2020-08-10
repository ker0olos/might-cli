#! /usr/bin/env node

import c from 'ansi-colors';
import prompts from 'prompts';

import draftlog from 'draftlog';

import { join } from 'path';

import { readJSON, writeJSON, writeFileSync } from 'fs-extra';

import { spawn } from 'child_process';

import exit from 'exit';

import { runner } from './runner.js';

/**
* @typedef { object } Config
* @property { string } startCommand
* @property { string } url
* @property { { width: number, height: number } } viewport
* @property { number } parallelTests
* @property { number } defaultTimeout
* @property { string[] } coverageIgnore
*/

/** the start command process
* @type { import('child_process').ChildProcessWithoutNullStreams }
*/
let running;

function resolve(...args)
{
  return join(process.cwd(), ...args);
}

function roundTime(end, start)
{
  const num = (end - start) / 1000;

  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/** read the config file from disk
* @returns { Promise<Config> }
*/
async function readConfig()
{
  let config;

  try
  {
    config = await readJSON(resolve('might.config.json'));
  }
  catch
  {
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
      viewport: {
        width: null,
        height: null
      },
      parallelTests: null,
      defaultTimeout: null,
      coverageIgnore: [
        // popular directories people hate
        '/node_modules/**',
        '/webpack/**',
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

/** read the map file from disk
* @param { boolean } dialog
* @returns { Promise<import('./runner.js').Map> }
*/
async function readMap(dialog)
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

    console.log(c.bold.yellow('[WARN: Map is missing or corrupted]'));
    console.log(c.bold('Make sure you have a file called "might.map.json" in the root of the project\'s directory.'));

    console.log();
  }
  finally
  {
    return map;
  }
}

/** the main process "loop"
*/
async function main()
{
  // open help menu
  if (process.argv.includes('--help') || process.argv.includes('-h'))
  {
    console.log(c.bold.cyan('--help, -h'), '       Opens this help menu.');
    console.log(c.bold.cyan('--map, -m'), '        Opens Might UI (even if not installed).');

    console.log();

    console.log(c.bold.cyan('--target, -t'), '     [string]   List the tests that should run (use their titles and separate them with a comma).');
    console.log(c.bold.cyan('--update, -u'), '     [boolean]  Updates the screenshots of targeted tests (if no tests were targeted it updates any failed tests).');

    console.log();

    console.log(c.bold.cyan('--parallel, -p'), '   [number]   Control how many tests should be allowed to run at the same time.');
    console.log(c.bold.cyan('--coverage, -c'), '   [boolean]  Outputs a coverage report at the end (experimental).');
  }
  // opens might-ui (even if not installed because npx is cool)
  else if (process.argv.includes('--map') || process.argv.includes('-m'))
  {
    running = spawn('npx might-ui', { shell: true, cwd: process.cwd() });

    running.stdout.on('data', (data) => console.log(data.toString()));

    running.stderr.on('data', (data) => console.log(c.red(data.toString())));

    // awaits for eternity
    await new Promise(() => undefined);
  }
  // start runner
  else
  {
    let target, parallel;

    // read the config file
    const config = await readConfig();

    if (!config)
      throw new Error('Error: Unable to load config file');

    // spawn the start command
    if (typeof config.startCommand === 'string' && config.startCommand)
      start(config.startCommand);

    if (process.argv.includes('--target'))
      target = process.argv.indexOf('--target');
    else if (process.argv.includes('-t'))
      target = process.argv.indexOf('-t');

    if (target > -1)
    {
      target = process.argv[target + 1];

      // split by commas but allow commas to be escaped
      if (target)
        target = target.match(/(?:\\,|[^,])+/g).map((t) => t.trim());
    }
    else
    {
      target = undefined;
    }

    if (process.argv.some((s) => s.startsWith('--parallel')))
      parallel = process.argv.findIndex((s) => s.startsWith('--parallel'));
    else if (process.argv.includes('-p'))
      parallel = process.argv.indexOf('-p');

    if (parallel > -1)
    {
      // eslint-disable-next-line security/detect-object-injection
      const value = process.argv[parallel];

      if (value.includes('='))
        parallel = parseInt(value.split('=')[1]);
      else
        parallel = parseInt(process.argv[parallel + 1]);
    }
    else
    {
      parallel = undefined;
    }

    // read the map file
    const map = await readMap(true);

    const update = process.argv.includes('--update') || process.argv.includes('-u');

    const coverage = process.argv.includes('--coverage') || process.argv.includes('-c');

    await run(map, target, update, parallel, coverage, config);
  }
}

/** spawn the start command
* @param { string } command
*/
function start(command)
{
  running = spawn(command, { shell: true, cwd: process.cwd() });
}

/** run the tests and output their progress and outcome
* to the terminal
* @param { import('./runner.js').Map } map
* @param { [] } target
* @param { boolean } update
* @param { number } parallel
* @param { boolean } coverage
* @param { Config } config
*/
async function run(map, target, update, parallel, coverage, config)
{
  const updateFailed = update && !target;
  const updateAll = update && target;

  // hide cursor
  hideCursor();

  // let length = 0;
  let draft;
  
  const animation = [ '|', '/', '-', '\\' ];

  const running = {};

  await runner({
    url: config.url,
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height
    },
    map,
    target,
    update,
    parallel: parallel ?? config.parallelTests,
    coverage,
    screenshotsDir: resolve('__might__'),
    coverageDir: resolve('__coverage__'),
    stepTimeout: config.defaultTimeout,
    coverageIgnore: config.coverageIgnore
  },
  (type, value) =>
  {
    // the amount of tasks that are going to run
    // if (type === 'started')
    //   length = value;

    // an error occurred during a test
    if (type === 'error')
    {
      let error;

      // if there's a property called diff that means that it's a mismatch error
      if (value.diff)
      {
        const filename = resolve(`might.error.${new Date().toISOString()}.png`);

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
        let log = draft;

        // use a normal log if no info was being shown
        if (!log)
        {
          console.log();

          log = console.log;
        }

        log(`Summary:${updateNotice} ${passed}${updated}${failed}${skipped}${total}.`);
      }
    }

    // one of the tests made progress
    if (type === 'progress')
    {
      if (value.state === 'running')
      {
        const draft = console.draft(c.bold.blueBright('RUNNING (|)'), value.title);

        running[value.id] = {
          draft,
          frame: 1,
          timestamp: Date.now()
        };

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

      if (value.state === 'done' && value.report !== undefined)
      {
        let color = c.red;

        if (value.report >= 70)
          color = c.yellow;
        
        if (value.report >= 90)
          color = c.green;

        console.log('\nTotal Coverage is', color.bold(`${value.report}%`));
      }
    }
  });
}

function kill()
{
  // since the app can't run async code will running we spawn a process
  // that will be kill any running children then exits automatically

  if (running)
    spawn(process.argv[0], [ join(__dirname, 'kill.js'), running.pid ]);
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
#! /usr/bin/env node

import { runner } from 'might-core';

import { terminal } from 'terminal-kit';

import { join } from 'path';

import { readJSON, writeJSON, writeFileSync } from 'fs-extra';

import { spawn } from 'child_process';

/**
* @typedef { object } Config
* @property { string } startCommand
* @property { string } url
* @property { { width: number, height: number } } viewport
*/

/** the start command process
* @type { import('child_process').ChildProcessWithoutNullStreams }
*/
let app;

function path(...args)
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
    config = await readJSON(path('might.config.json'));
  }
  catch
  {
    terminal.bold.yellow('[WARN: Config is missing or corrupted]\n');
    terminal('Do you want to create a new config? ').bold('[Y/n]\n');

    const result = await terminal.yesOrNo({ yes: [ 'Y' ], no: [ 'n' ] }).promise;

    if (!result)
      return;

    terminal('\n[e.i., npm run start] [Leave empty if none is needed]\n');
    terminal.bold('Enter a command that starts a http server for your app: ');
    
    const startCommand = await terminal.inputField().promise;

    terminal('\n');

    terminal('\n[e.i., http://localhost:8080] [required]\n');
    terminal.bold('Enter the URL of your app: ');
    
    const url = await terminal.inputField().promise;

    terminal('\n[e.i., 1280x720] [optional]\n');
    terminal.bold('Enter the default viewport of the app: ');
    
    const viewport = await terminal.inputField().promise;

    const [ width, height ] = viewport.split('x');
    
    terminal('\n\n');

    config = {
      startCommand,
      url: url || 'http://localhost:8080',
      viewport: {
        width: parseInt(width),
        height: parseInt(height)
      }
    };

    await writeJSON(path('might.config.json'), config, { spaces: '\t' });
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
    map = (await readJSON(path('might.map.json'))).data;
  }
  catch
  {
    if (!dialog)
      return;

    terminal.bold.yellow('[WARN: Map is missing or corrupted]\n');
    terminal.bold('[INFO: Create "might.map.json" in the root of the project and add your tests to it]\n');

    terminal('\n');
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
    terminal('Options:\n');
 
    terminal('\n--help (-h)           Opens this help menu.');
    terminal('\n--update (-u)         Updates all target screenshots.');

    // TODO should spawn "might-ui" now instead
    // terminal('\n--map-editor (-m)     Manage existing tests or add new ones.');

    terminal('\n--target (-t)         List the tests that should run (use their titles --- separate them with a comma)');
  }
  // TODO should spawn "might-ui" now instead
  // opens map editor (ignoring the runner)
  // else if (process.argv.includes('--map-editor') || process.argv.includes('-m'))
  // {
  //   // read the map file
  //   const map = await readMap(false);

  //   // then rewrite map editor to use said api
  //   await editor(map);
  // }
  // start runner
  else
  {
    let target;

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

    // read the map file
    const map = await readMap(true);

    const update = process.argv.includes('--update') || process.argv.includes('-u');

    await run(map, target, update, config);
  }
}

/** spawn the start command
* @param { string } command
*/
function start(command)
{
  app = spawn(
    command.split(' ')[0],
    command.split(' ').slice(1),
    { cwd: process.cwd() });
}

/** run the tests and output their progress and outcome
* to the terminal
* @param { import('./runner.js').Map } map
* @param { [] } target
* @param { Config } config
*/
async function run(map, target, update, config)
{
  // hide cursor
  terminal.hideCursor(true);

  let interval;

  let startTimestamp;

  let index = 1, length = 0;

  await runner({
    url: config.url,
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height
    },
    map,
    update,
    target,
    dir: path('__might__')
  }, (type, value) =>
  {
    // the amount of tasks that are going to run
    if (type === 'started')
      length = value;

    // an error occurred during a test
    if (type === 'error')
    {
      // if there's a property called diff then the error is a mismatch
      if (value.diff)
      {
        //  write the difference error to disk
        const diffLocation = path(`might.error.${new Date().toISOString()}.png`);
          
        writeFileSync(diffLocation, value.diff);

        terminal(`\n${diffLocation}\n`);
      }

      if (interval)
        clearInterval(interval);

      throw new Error(value.message || value);
    }
    
    // all tests are done
    if (type === 'done')
    {
      // no tests at all
      if (value.total === 0 && value.skipped === 0)
      {
        terminal.bold.yellow('Map has no tests.');
      }
      // all tests were skipped
      else if (value.total === value.skipped)
      {
        terminal.bold.magenta('All tests were skipped.');
      }
      // print a summary of all the tests
      else
      {
        terminal.bold('\nSummary: ');

        if (value.passed)
          terminal.bold.green(`${value.passed} passed`)(', ');
      
        if (value.updated)
          terminal.bold.yellow(`${value.updated} updated`)(', ');
      
        if (value.skipped)
          terminal.bold.magenta(`${value.skipped} skipped`)(', ');
      
        terminal(`${value.total} total`);
      }
    }

    // one of the tests made progress
    if (type === 'progress')
    {
      const time = roundTime(Date.now(), startTimestamp);

      if (value.state === 'running')
      {
        terminal.saveCursor();

        startTimestamp = Date.now();

        terminal.bold.brightBlue(`RUNNING (0.0s) (${index}/${length})`)(` ${value.title}\n`);

        interval = setInterval(() =>
        {
          terminal.restoreCursor();
          terminal.deleteLine();

          const time = roundTime(Date.now(), startTimestamp);

          terminal.bold.brightBlue(`RUNNING (${time}s) (${index}/${length})`)(` ${value.title}\n`);
        }, 100);
      }
      else
      {
        index = index + 1;

        if (interval)
          clearInterval(interval);

        terminal.restoreCursor();
        terminal.eraseDisplayBelow();
      }
      
      if (value.state === 'updated')
      {
        terminal.bold.yellow(`UPDATED (${time}s)`)(` ${value.title}\n`);
      }
      else if (value.state === 'failed')
      {
        terminal.bold.red(`FAILED (${time}s)`)(` ${value.title}\n`);
      }
      else if (value.state === 'passed')
      {
        terminal.bold.green(`PASSED (${time}s)`)(` ${value.title}\n`);
      }
    }
  });

  // show cursor again
  terminal.hideCursor(false);
}

function exitGracefully()
{
  // kill the start command
  if (app && !app.killed)
    app.kill();

  // ensure the to enable input and cursor
  terminal.grabInput(false);
  terminal.hideCursor(false);
  
  terminal('\n');
    
  // exit main process gracefully
  terminal.processExit(0);
}

function exitForcefully()
{
  // kill the start command
  if (app && !app.killed)
    app.kill();

  // ensure the to enable input and cursor
  terminal.grabInput(false);
  terminal.hideCursor(false);

  // add 2 new lines
  terminal('\n\n');

  // force exit the process
  process.exit(1);
}

// grab the input
terminal.grabInput({ mouse: 'button' }) ;

// listen for interruptions
terminal.on('key', (name) =>
{
  if (name === 'CTRL_C')
  {
    // print a notice about the manual termination
    terminal.yellow('\nProcess was interrupted.');
    
    // exit the main process gracefully
    exitGracefully();
  }
});

// add new line
terminal('\n');

// start the main process
main()
  .then(exitGracefully)
  .catch((e) =>
  {
    // print the error
    terminal.red(`\n${e.message || e}`);

    exitForcefully();
  });
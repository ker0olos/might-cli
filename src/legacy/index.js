#! /usr/bin/env node

import { terminal } from 'terminal-kit';

import { readFile, writeJSON } from 'fs-extra';

import { spawn } from 'child_process';

import { path } from './utils.js';

import { runMap, mapEditor } from './map.js';

/**
* @typedef { object } MightConfig
* @property { boolean } update
* @property { string } startCommand
* @property { string } url
* @property { string[] } target
*/

/** the start command process
* @type { import('child_process').ChildProcessWithoutNullStreams }
*/
let app;

/**
* @returns { Promise<MightConfig> }
*/
async function readConfig()
{
  let config;
  
  try
  {
    config = await readFile(path('might.config.json'), 'utf8');

    config = JSON.parse(config);
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

    terminal('\n\n');

    config = {
      startCommand,
      url
    };

    await writeJSON(path('might.config.json'), config, { spaces: '\t' });
  }
  finally
  {
    return config;
  }
}

/**
* @param {string } startCommand
*/
function startApp(startCommand)
{
  app = spawn(
    startCommand.split(' ')[0],
    startCommand.split(' ').slice(1),
    { cwd: process.cwd() });
}

async function main()
{
  // open help menu
  if (process.argv.includes('--help') || process.argv.includes('-h'))
  {
    terminal('Options:\n');

    terminal('\n--help (-h)           Opens this help menu.');
    terminal('\n--update (-u)         Updates all target screenshots.');
    terminal('\n--map-editor (-m)     Manage existing tests or add new ones.');
    terminal('\n--target (-t)         List the tests that should run (use their titles and separate them with a comma)');
  }
  // opens map editor (ignoring the runner)
  else if (process.argv.includes('--map-editor') || process.argv.includes('-m'))
  {
    await mapEditor();
  }
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
      startApp(config.startCommand);
  
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

    await runMap({
      ...config,
      target: target,
      update: process.argv.includes('--update') || process.argv.includes('-u')
    });
  }
}

function exitGracefully()
{
  // kill the start command
  if (app && !app.killed)
    app.kill();

  // make sure cursor is not hidden
  terminal.hideCursor(false);

  // add new line
  terminal('\n');
    
  // exit main process gracefully
  terminal.processExit(0);
}

export function exitForcefully()
{
  // kill the start command
  if (app && !app.killed)
    app.kill();

  // make sure cursor is not hidden
  terminal.hideCursor(false);

  // add 2 new lines
  terminal('\n\n');

  // force exit the process
  process.exit(1);
}

// allow the process to be interrupted
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
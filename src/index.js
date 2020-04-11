#! /usr/bin/env node

import { terminal } from 'terminal-kit';

import { readFile, writeJSON } from 'fs-extra';

import { spawn } from 'child_process';

import { path } from './utils.js';

import { runMap, mapMode } from './map.js';

/**
* @typedef { object } MightConfig
* @property { string } startCommand
* @property { string } url
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
  // read file error
  catch
  {
    terminal('Might config file is missing or corrupted.\n');
    terminal('Do you want to create a new config? [Y/n]\n');

    const result = await terminal.yesOrNo({ yes: [ 'Y' ], no: [ 'n' ] }).promise;

    if (!result)
      return;

    terminal('Enter the command that starts a http server of your app: ');
    
    const startCommand = await terminal.inputField().promise;

    terminal('\nEnter the URL of your app: ');

    const url = await terminal.inputField().promise;

    config = {
      startCommand,
      url
    };

    await writeJSON(path('might.config.json'), config);
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
  // map mode only (no runner)
  if (process.argv.indexOf('--map-mode') > -1)
  {
    await mapMode();
  }
  // start runner
  else
  {
    // read the config file
    const config = await readConfig();
  
    // TODO re-enable
    // spawn the start command
    // if (typeof config.startCommand !== 'string')
    //   throw new Error('config.startCommand is not a string!');
    // else
    //   startApp(config.startCommand);
  
    await runMap(config);
  }
}

function exitGracefully()
{
  // kill the start command
  if (app && !app.killed)
    app.kill();
    
  // exit main process gracefully
  terminal.processExit(0);
}

function exitForcefully(e)
{
// kill the start command
  if (app && !app.killed)
    app.kill();

  // print the error that cased the exit code
  terminal.red(`\n${e.message || e}`);

  // exit main process with an error
  terminal.processExit(1);
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

// start the main process
main()
  .then(exitGracefully)
  .catch((e) => exitForcefully(e));
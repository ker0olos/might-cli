#! /usr/bin/env node

import { terminal } from 'terminal-kit';

import { join } from 'path';

import { readFile, writeJSON } from 'fs-extra';

import { spawn } from 'child_process';

/** the start command process
* @type { import('child_process').ChildProcessWithoutNullStreams }
*/
let app;

function path(s)
{
  return join(process.cwd(), `./${s}`);
}

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
    terminal('Might config file is missing of corrupted.\n');
    terminal('Do you want to create a new config? [y/N]\n');

    const result = await terminal.yesOrNo({ yes: [ 'y' ], no: [ 'N' ] }).promise;

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
  // read the config file
  const config = await readConfig();

  // TODO re-enable
  // spawn the start command
  // if (typeof config.startCommand !== 'string')
  //   throw new Error('config.startCommand is not a string!');
  // else
  //   startApp(config.startCommand);

  // TODO start map.js
  // await new Promise((resolve) =>
  // {
  //   setTimeout(resolve, 1200000);
  // });
}

// allow the process to be interrupted
terminal.on('key', (name) =>
{
  if (name === 'CTRL_C')
  {
    // kill the start command
    if (app && !app.killed)
      app.kill();

    // print a notice about the manual termination
    //then exit the main process gracefully
    terminal.yellow('\nProcess was terminated.').processExit(0);
  }
});

// start the main process
main()
  .then(() =>
  {
    // kill the start command
    if (app && !app.killed)
      app.kill();
    
    // exit main process gracefully
    terminal.processExit(0);
  })
  .catch((e) =>
  {
    // kill the start command
    if (app && !app.killed)
      app.kill();
    
    // print the error that cased the exit code
    terminal.red(`\n${e.message || e}`);

    // exit main process with an error
    terminal.processExit(1);
  });
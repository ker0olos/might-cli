import { terminal } from 'terminal-kit';

import { readFile, writeJSON } from 'fs-extra';

import { path, serializeStep, stepsToString } from './utils.js';

import { runner } from './runner.js';
import { whileRunner } from './src2/cli.js';

/**
* @typedef { MightTest[] } MightMap
*/

/**
* @typedef { object } MightTest
* @property { string } title
* @property { MightStep[] } steps
*/

/**
* @typedef { object } MightStep
* @property { 'wait' | 'select' | 'click' | 'type' } action
* @property { any } value
*/

/**
* @returns { Promise<MightMap> }
*/
async function readMap()
{
  let map = await readFile(path('might.map.json'), 'utf8');

  map = JSON.parse(map).data;

  return map;
}

/**
* @param { import('.').MightConfig } config
*/
export async function runMap(config)
{
  /**
  * @type { MightMap }
  */
  let map;

  try
  {
    map = await readMap();
  }
  catch
  {
    terminal.bold.yellow('[WARN: Map is missing or corrupted]\n');
    terminal('Do you want to create a new map? ').bold('[Y/n]\n');

    const result = await terminal.yesOrNo({ yes: [ 'Y' ], no: [ 'n' ] }).promise;

    if (!result)
      return;

    terminal('\n');

    // go to map editor to create a new map
    map = await mapEditor();
  }
  finally
  {
    // run the map
    await whileRunner(map, config);
  }
}

/**
* @returns { Promise<MightMap> }
*/
export async function mapEditor()
{
  /**
  * @type { MightMap }
  */
  let map;
  
  // try to load the existing map file
  // to show and edit existing tests
  try
  {
    map = await readMap();
  }
  catch
  {
    map = [];
  }

  /** Pick an action and its value
  */
  async function action()
  {
    terminal.restoreCursor().eraseDisplayBelow();

    terminal('Pick an action: \n');

    const actions = [ 'Wait', 'Select', 'Click', 'Type', 'Cancel' ];

    const result = await terminal.singleColumnMenu(actions).promise;

    if (result.selectedIndex < actions.length - 1)
    {
      const key = result.selectedText.toLowerCase();

      if (key === 'wait')
        terminal('\nEnter time to wait in seconds: ');
      else if (key === 'select')
        terminal('\nEnter selector: ');
      else if (key === 'type')
        terminal('\nEnter input: ');

      if (key === 'wait' || key === 'select' || key === 'type')
      {
        const value = await terminal.inputField({ minLength: 1 }).promise;
  
        return { action: key, value };
      }
      else
      {
        return { action: key };
      }
    }
  }

  /** Edit/Add A Test
  * @param { MightTest } test
  */
  async function edit(test)
  {
    terminal.restoreCursor().eraseDisplayBelow();

    test = test || {
      title: '',
      steps: []
    };

    terminal(`Editing: ${test.title || 'Untitled Test'}\n`);

    const exists = map.includes(test);

    let menu = [ 'New Step', 'Confirm', 'Cancel' ];

    if (exists)
      menu = [ 'Delete Test', 'Cancel' ];

    const result = await terminal.singleColumnMenu([
      ...test.steps.map((s, i) => `${i + 1}. ${serializeStep(s)}`),
      ...menu
    ]).promise;

    // add new step to test
    if (result.selectedText === 'New Step')
    {
      const step = await action();

      if (step)
        test.steps.push(step);

      await edit(test);
    }
    // remove test from map
    else if (result.selectedText === 'Delete Test')
    {
      map.splice(map.indexOf(test), 1);

      await home();
    }
    // add test to map
    else if (result.selectedText === 'Confirm')
    {
      terminal('\nEnter test title (can be empty): ');
      test.title = await terminal.inputField().promise;

      map.push(test);
      
      await home();
    }
    // cancel
    else if (result.selectedText === 'Cancel')
    {
      await home();
    }
    // stay at the same state
    else
    {
      await edit(test);
    }
  }

  async function manage()
  {
    terminal.restoreCursor().eraseDisplayBelow();

    terminal('Manage Tests:\n');

    const result = await terminal.singleColumnMenu([
      ...map.map((t, i) => `${i + 1}. ${t.title || stepsToString(t.steps)}`),
      'Back'
    ]).promise;

    if (result.selectedText === 'Back')
    {
      await home();
    }
    else
    {
      await edit(map[result.selectedIndex]);
    }
  }

  /** The homepage of Map Editor
  */
  async function home()
  {
    terminal.restoreCursor().eraseDisplayBelow();

    terminal('Map Editor:\n');

    let menu = [ 'New Test', 'Manage Tests', 'Save', 'Cancel' ];

    if (map.length <= 0)
      menu = [ 'New Test', 'Save', 'Cancel' ];

    const result = await terminal.singleColumnMenu(menu).promise;

    // add new test
    if (result.selectedText === 'New Test')
    {
      await edit();
    }
    // manage existing tests
    else if (result.selectedText === 'Manage Tests')
    {
      await manage();
    }
    // save map
    else  if (result.selectedText === 'Save')
    {
      // write the object to disk
      await writeJSON(path('might.map.json'), {
        data: map
      }, { spaces: '\t' });

      terminal('\nSuccessfully saved the map.\n\n');
    }
  }

  // save cursors location
  terminal.saveCursor();

  // begin the interface loop
  await home();

  // return map to runner
  return map;
}

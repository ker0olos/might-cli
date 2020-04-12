import { terminal } from 'terminal-kit';

import { readFile, writeJSON } from 'fs-extra';

import { path } from './utils.js';

import { runner } from './runner.js';

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
  // read file error
  catch
  {
    terminal('Your map is missing or corrupted.\n');
    terminal('Do you want to go to "Map Mode" and create a new map? [Y/n]\n');

    const result = await terminal.yesOrNo({ yes: [ 'Y' ], no: [ 'n' ] }).promise;

    if (!result)
      return;

    // go to map mode to create a new map
    map = await mapMode();
  }
  finally
  {
    // run the map
    if (map)
      await runner(map, config);
  }
}

/**
* @returns { Promise<MightMap> }
*/
export async function mapMode()
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

  /**
  * @param { MightStep } step
  */
  const serializeStep = (step) =>
  {
    if (step.action === 'wait')
      return `Wait ${step.value}s`;
    else if (step.action === 'select')
      return `Select ${step.value}`;
    else if (step.action === 'click')
      return 'Click';
    else if (step.action === 'type')
      return `Type ${step.value}`;
  };

  /** Pick an action and its value
  */
  async function action()
  {
    terminal.clear();

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
    terminal.clear();

    test = test || {
      title: '',
      steps: []
    };

    terminal(`Editing: ${test.title || 'Untitled Test'}\n`);

    let menu = [ 'New Step', 'Confirm', 'Cancel' ];

    if (map.includes(test))
    {
      menu = [ 'New Step', 'Delete Test', 'Confirm', 'Cancel' ];
    }

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
    terminal.clear();

    terminal('[Might] Manage Tests\n');

    const replacementTitle = (steps) =>
    {
      return steps.map(serializeStep).join(' 🠮 ');
    };

    const result = await terminal.singleColumnMenu([
      ...map.map((t, i) => `${i + 1}. ${t.title || replacementTitle(t.steps)}`),
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

  /** The homepage of Map Mode
  */
  async function home()
  {
    terminal.clear();

    terminal('[Might] Map Mode\n');

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
      });

      terminal('\nSuccessfully saved the map.');
    }
  }

  // begin the interface loop
  await home();

  // return map to runner
  return map;
}

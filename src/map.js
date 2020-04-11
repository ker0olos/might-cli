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
* @property { 'wait' | 'click' } action
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

  async function home()
  {
    const result = await terminal.singleColumnMenu([ 'Add New Test', 'Manage Existing Tests', 'Save', 'Cancel' ]).promise;

    if (result.selectedIndex === 0)
    {
      // TODO
      terminal('Add New Test');
    }
    else if (result.selectedIndex === 1)
    {
      // TODO
      terminal('Manage Existing Tests');
    }
    else  if (result.selectedIndex === 2)
    {
      // write map to disk
      await writeJSON(path('might.map.json'), {
        data: map
      });

      return map;
    }
    else
    {
      return false;
    }
  }

  return await home();
}

import puppeteer from 'puppeteer';

import { PNG } from 'pngjs';

import pixelmatch from 'pixelmatch';

import { join } from 'path';

import { pathExists, ensureDir, readFile } from 'fs-extra';

import { stepsToString, wait } from './utils.js';

/**
* @typedef { Test[] } Map
* @property { string } title
* @property { Step[] } steps
*/

/**
* @typedef { object } Test
* @property { string } title
* @property { Step[] } steps
*/

/**
* @typedef { object } Step
* @property { 'wait' | 'select' | 'click' | 'type' } action
* @property { any } value
*/

class MismatchError extends Error
{
  /**
  * @param { string } message
  * @param { Buffer } diff
  */
  constructor(message, diff)
  {
    super(message);

    this.diff = diff;
  }
}

/**
*
* @param { {
  url: string,
  map: Map,
  update: boolean,
  target: string[],
  dir: string,
  stepTimeout: number
 } } options
* @param { (type: 'started' | 'progress' | 'error' | 'done', value: any) => void } callback
*/
export async function runner(options, callback)
{
  options = options || {};

  options.dir = options.dir || join(__dirname, '../__might__');

  options.stepTimeout = options.stepTimeout || 15000;

  let map = options.map;

  if (!map)
  {
    callback('error', {
      message: 'Error: Unable to load map file'
    });

    return;
  }
  
  const skipped = [];

  let passed = 0;
  let updated = 0;
  let failed = 0;

  // TODO research allowing people to use might with jest
  // maybe make runner use functions like screenshot, compare doStep() ?
  
  // filter tests using maps and target
  if (Array.isArray(options.target))
  {
    map = map.filter((t) =>
    {
      // leave the test in map
      // if its a target
      if (options.target.includes(t.title))
        return true;
      // remove test from map
      // push it to a different array
      // to allow us to output skipped tests to terminal
      else
        skipped.push(t);
    });
  }

  // if map has no tests or if all tests were skipped
  if (map.length <= 0)
  {
    callback('done', {
      total: map.length + skipped.length,
      skipped: skipped.length
    });

    return;
  }

  // ensure the screenshots directory exists
  await ensureDir(options.dir);

  // launch puppeteer
  const browser = await puppeteer.launch({
    timeout: options.stepTimeout,
    defaultViewport: { width: 1366, height: 768 },
    args: [ '--no-sandbox', '--disable-setuid-sandbox' ]
  });

  // announce the amount of tests that are pending
  callback('started', map.length);

  // run tests in sequence
  for (const t of map)
  {
    const title = t.title || stepsToString(t.steps);

    let selector;

    try
    {
      callback('progress', {
        title,
        state: 'running'
      });
  
      const page = await browser.newPage();

      // an attempt to make tests more consistent
      // through different machines
      await page.setExtraHTTPHeaders({
        'X-Forwarded-For': '8.8.8.8',
        'Accept-Language': 'en-US,en;q=0.5'
      });

      // go to the web app's url
      await page.goto(options.url, {
        // septate timeout - since some web app will take some time
        // to compile, start then load
        timeout: 60000
      });
  
      // follow the steps
      for (const s of t.steps)
      {
        if (s.action === 'wait')
        {
          await wait(s.value);
        }
        else if  (s.action === 'select')
        {
          selector = s.value;
        }
        else if (s.action === 'click')
        {
          await page.click(selector);
        }
        else if (s.action === 'type')
        {
          await page.type(selector, s.value);
        }
      }
  
      // all steps were executed
  
      const screenshotId = stepsToString(t.steps, '_').split(' ').join('_').toLowerCase();
      const screenshotPath = join(options.dir, `${screenshotId}.png`);
  
      const screenshotExists = await pathExists(screenshotPath);
  
      // update the stored screenshot
      if (!screenshotExists || options.update)
      {
        await page.screenshot({
          path: screenshotPath
        });
  
        callback('progress', {
          title,
          state: 'updated'
        });

        updated = updated + 1;
      }
      else
      {
        const img1 = PNG.sync.read(await page.screenshot({}));
        const img2 = PNG.sync.read(await readFile(screenshotPath));
  
        const diff = new PNG({ width: img1.width, height: img1.height });
  
        const mismatch = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height);
  
        if (mismatch > 0)
          throw new MismatchError(`Error: Mismatched ${mismatch} pixels`, PNG.sync.write(diff));
  
        callback('progress', {
          title,
          state: 'passed'
        });

        passed = passed + 1;
      }
    }
    catch (e)
    {
      // test failed

      callback('progress', {
        title,
        state: 'failed'
      });

      callback('error', e);

      failed = failed + 1;

      // if one test failed then don't run the rest
      break;
    }
  }

  // close puppeteer
  await browser.close();

  callback('done', {
    total: map.length + skipped.length,
    passed,
    updated,
    skipped: skipped.length,
    failed
  });
}
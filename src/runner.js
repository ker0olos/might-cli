import { PNG } from 'pngjs';

import puppeteer from 'puppeteer';

import pixelmatch from 'pixelmatch';

import { join } from 'path';

import { pathExists, ensureDir, readFile } from 'fs-extra';

import { stepsToString } from 'might-core';

/**
* @typedef { Test[] } Map
*/

/**
* @typedef { import('might-core').Step } Step
*/

/**
* @typedef { object } Test
* @property { string } title
* @property { Step[] } steps
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
* @param { number } seconds
*/
function wait(seconds)
{
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
*
* @param { {
  url: string,
  viewport: { width: number, height: number },
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

  options.viewport = options.viewport || {};

  options.viewport.width = options.viewport.width || 1366;
  options.viewport.height = options.viewport.height || 768;

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
    defaultViewport: { width: options.viewport.width, height: options.viewport.height },
    args: [ '--no-sandbox', '--disable-setuid-sandbox' ]
  });

  // announce the amount of tests that are pending
  callback('started', map.length);

  // run tests in sequence
  for (const t of map)
  {
    const title = t.title || stepsToString(t.steps);

    let selector;

    /**
    * @param { puppeteer.Page } page
    * @param { Step } step
    */
    const runStep = async(page, step) =>
    {
      if (step.action === 'wait')
      {
        // wait a duration of time
        if (typeof step.value === 'number')
          await wait(step.value);
        // wait for a selector
        else
          await page.waitForSelector(step.value, {
            timeout: options.stepTimeout
          });
      }
      else if  (step.action === 'viewport')
      {
        const [ width, height ] = step.value.split('x');

        await page.setViewport({
          width: parseInt(width),
          height: parseInt(height)
        });
      }
      else if  (step.action === 'select')
      {
        selector = step.value;
      }
      else if (step.action === 'hover')
      {
        await page.hover(selector);
      }
      else if (step.action === 'click')
      {
        await page.click(selector);
      }
      else if (step.action === 'type')
      {
        await page.type(selector, step.value);
      }
    };

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
  
      // run the steps
      for (const step of t.steps)
      {

        await runStep(page, step);
      }
  
      // all steps were executed
  
      const screenshotId = stepsToString(t.steps, '_').split(' ').join('_').toLowerCase();
      const screenshotPath = join(options.dir, `${screenshotId}.png`);
  
      const screenshotExists = await pathExists(screenshotPath);
  
      // new first-run test or a forced update command
      if (!screenshotExists || options.update)
      {
        // save screenshot to disk
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
        // compare the new screenshot
        const img1 = PNG.sync.read(await page.screenshot({}));

        // with the old screenshot
        const img2 = PNG.sync.read(await readFile(screenshotPath));
  
        const diff = new PNG({ width: img1.width, height: img1.height });
  
        const mismatch = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height);
  
        // throw error if they don't match each other
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
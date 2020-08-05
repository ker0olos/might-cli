import { PNG } from 'pngjs';

import puppeteer from 'puppeteer';

import { keyDefinitions } from 'puppeteer/lib/cjs/puppeteer/common/USKeyboardLayout.js';

import pixelmatch from 'pixelmatch';

import md5 from 'md5';

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
* @param { () => Promise<any> } fn
* @param { number } delay
* @param { number } maxTime
 */
function retry(fn, delay, maxTime)
{
  return new Promise((resolve, reject) =>
  {
    let timeout = false;

    const timeoutRef = setTimeout(() => timeout = true, maxTime);

    const r = (e) =>
    {
      if (timeoutRef)
        clearTimeout(timeoutRef);
      
      resolve(e);
    };

    const call = () => fn().then(r);

    const fail = (e) =>
    {
      if (timeout)
        reject(e);
      else
        setTimeout(() => call().catch(fail), delay);
    };

    call().catch(fail);
  });
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
  
  // skipping broken tests
  // and filtering targets
  {
    map = map.filter((t) =>
    {
      // skip tests with no steps
      if (!t.steps || t.steps.length <= 0)
        skipped.push(t);
      // leave the test in map
      // if its a target
      else if (Array.isArray(options.target))
      {
        if (options.target.includes(t.title))
          return true;
        else
          skipped.push(t);
      }
      else
      {
        return true;
      }
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
    defaultViewport: {
      hasTouch: false,
      width: options.viewport.width,
      height: options.viewport.height,
      isMobile: false,
      isLandscape: false,
      deviceScaleFactor: 1
    },
    args: [ '--no-sandbox', '--disable-setuid-sandbox' ]
  });

  // announce the amount of tests that are pending
  callback('started', map.length);

  // run tests in sequence
  for (const t of map)
  {
    const title = t.title || stepsToString(t.steps, {
      pretty: true,
      url: options.url
    }).trim();

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
        {
          await wait(step.value);
        }
        // wait for a selector
        else
        {
          await page.waitForSelector(step.value, {
            timeout: options.stepTimeout
          });

          // so there's no need to select the same element again after waiting
          selector = step.value;
        }
      }
      else if  (step.action === 'viewport')
      {
        let touch = false;

        const [ width, height ] = step.value.split('x');

        if (height.endsWith('t'))
          touch = true;

        await page.setViewport({
          hasTouch: touch,
          width: parseInt(width),
          height: parseInt(height),
          isMobile: false,
          isLandscape: false,
          deviceScaleFactor: 1
        });
      }
      else if (step.action === 'goto')
      {
        let url = step.value;

        if (url.startsWith('/'))
          url = `${options.url}${url}`;

        await page.goto(url, {
          timeout: options.stepTimeout
        });
      }
      else if  (step.action === 'media')
      {
        const [ name, value ] = step.value.split(':');

        await page.emulateMediaFeatures([ {
          name: name.trim(),
          value: value.trim()
        } ]);
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
        const { hasTouch } = page.viewport();

        if (hasTouch)
          await page.tap(selector);
        else
          await page.click(selector, { button: 'left' });
      }
      else if (step.action === 'drag')
      {
        // dragging an element to a specified location
        // (relative to selected element)

        let [ x1, y1 ] = step.value;

        const elem = await page.$(selector);

        const boundingBox = await elem.boundingBox();

        const { width, height } = page.viewport();

        const x0 = (boundingBox.x + boundingBox.width) * 0.5;
        const y0 = (boundingBox.y + boundingBox.height) * 0.5;

        // offset unit (relative to element x-axis)
        if (x1.endsWith?.('f'))
          x1 = x0 + parseInt(x1);
        // viewport unit (relative to viewport width)
        else if (x1.endsWith?.('v'))
          x1 = (parseInt(x1) / 100) * width;
        // default (relative to parent position)
        else
          x1 = parseInt(x1);

        // offset unit (relative to element y-axis)
        if (y1.endsWith?.('f'))
          y1 = y0 + parseInt(y1);
        // viewport unit (relative to viewport height)
        else if (y1.endsWith?.('v'))
          y1 = (parseInt(y1) / 100) * height;
        // default (relative to parent position)
        else
          y1 = parseInt(y1);

        await page.mouse.move(x0, y0);
        await page.mouse.down({ button: 'left' });

        await page.mouse.move(x1, y1);
        await page.mouse.up({ button: 'left' });
      }
      else if (step.action === 'swipe')
      {
        // swiping across the viewport
        // from a specified location
        // to another specified location

        let [ x0, y0, x1, y1 ] = step.value;

        const { width, height } = page.viewport();

        // viewport unit (v) (relative to viewport height)

        x0 = x0.endsWith?.('v') ? (parseInt(x0) / 100) * width : parseInt(x0);
        x1 = x1.endsWith?.('v') ? (parseInt(x1) / 100) * width : parseInt(x1);

        y0 = y0.endsWith?.('v') ? (parseInt(y0) / 100) * height : parseInt(y0);
        y1 = y1.endsWith?.('v') ? (parseInt(y1) / 100) * height : parseInt(y1);

        await page.mouse.move(x0, y0);
        await page.mouse.down({ button: 'left' });

        await page.mouse.move(x1, y1);
        await page.mouse.up({ button: 'left' });
      }
      else if (step.action === 'keyboard')
      {
        /**
        * @type { string[] }
        */
        const split = step.value.replace('++', '+NumpadAdd').split('+');

        // make sure the selected element is focused
        await page.focus(selector);

        let shift = false, ctrl = false, alt = false;

        // hold modifier keys

        if (split.includes('Shift'))
        {
          shift = true;

          await page.keyboard.down('Shift');
        }

        if (split.includes('Control'))
        {
          ctrl = true;
          
          await page.keyboard.down('Control');
        }

        if (split.includes('Alt'))
        {
          alt = true;
          
          await page.keyboard.down('Alt');
        }

        // press all other keys

        for (let i = 0; i < split.length; i++)
        {
          // eslint-disable-next-line security/detect-object-injection
          const key = split[i];

          if (key !== 'Shift' && key !== 'Control' && key !== 'Alt')
          {
            // eslint-disable-next-line security/detect-object-injection
            const code = keyDefinitions[key]?.code;

            if (code)
              await page.keyboard.press(code);
            else
              await page.keyboard.type(key);
          }
        }

        // release modifier keys

        if (shift)
          await page.keyboard.up('Shift');

        if (ctrl)
          await page.keyboard.up('Control');

        if (alt)
          await page.keyboard.up('Alt');
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

      // go to the web app's url (retry enabled)
      await retry(
        () => page.goto(options.url, { timeout: 10000 }),
        1000,
        60000
      );

      // run the steps
      for (const step of t.steps)
      {
        await runStep(page, step);
      }
  
      // all steps were executed
  
      const screenshotId = md5(stepsToString(t.steps));
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
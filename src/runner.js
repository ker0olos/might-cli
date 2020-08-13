import jimp from 'jimp';

import puppeteer from 'puppeteer';

import { keyDefinitions } from 'puppeteer/lib/cjs/puppeteer/common/USKeyboardLayout.js';

import limit from 'p-limit';

import md5 from 'md5';

import { join } from 'path';

import { pathExists, ensureDir, readFile, emptyDir } from 'fs-extra';

import { stepsToString } from 'might-core';

import screenshot from './screenshot.js';

import { coverage } from './coverage.js';

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

/**
* @typedef { object } Options
* @property { string } url
* @property { { width: number, height: number } } viewport
* @property { Map } map
* @property { string[] } target
* @property { boolean } update
* @property { number } parallel
* @property { boolean } coverage
* @property { string } screenshotsDir
* @property { string } coverageDir
* @property { number } stepTimeout
* @property { string[] } coverageExclude
* @property { import('./coverage').CoverageIgnore } coverageIgnoreLines
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
* @param { Options } options
* @param { (type: 'started' | 'progress' | 'error' | 'done', value: any) => void } callback
*/
export async function runner(options, callback)
{
  options = options || {};

  options.viewport = (typeof options.viewport !== 'object') ? {} : options.viewport;

  options.viewport.width = (typeof options.viewport.width !== 'number') ? 1366 : (options.viewport.width || 1366);
  options.viewport.height = (typeof options.viewport.height !== 'number') ? 768 : (options.viewport.height || 768);

  options.stepTimeout = (typeof options.stepTimeout !== 'number') ? 15000 : (options.stepTimeout || 15000);

  options.parallel = (typeof options.parallel !== 'number') ? 3 : (options.parallel || 3);

  options.coverageExclude = (!Array.isArray(options.coverageExclude)) ? [] : options.coverageExclude;

  options.coverageIgnoreLines = (typeof options.coverageIgnoreLines !== 'object') ? {} : options.coverageIgnoreLines;

  options.coverageIgnoreLines.equal = (!Array.isArray(options.coverageIgnoreLines.equal)) ? [] : options.coverageIgnoreLines.equal;
  options.coverageIgnoreLines.startsWith = (!Array.isArray(options.coverageIgnoreLines.startsWith)) ? [] : options.coverageIgnoreLines.startsWith;
  options.coverageIgnoreLines.endsWith = (!Array.isArray(options.coverageIgnoreLines.endsWith)) ? [] : options.coverageIgnoreLines.endsWith;
  
  options.coverageIgnoreLines.startsEndsWith = (!Array.isArray(options.coverageIgnoreLines.startsEndsWith)) ? [] : options.coverageIgnoreLines.startsEndsWith;

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

  const coverageCollection = [];

  // skipping broken tests
  // and filtering targets
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
  await ensureDir(options.screenshotsDir);

  // launch puppeteer
  const browser = await puppeteer.launch({
    timeout: 15000,
    defaultViewport: {
      width: options.viewport.width,
      height: options.viewport.height,
      hasTouch: false,
      isMobile: false,
      isLandscape: false,
      deviceScaleFactor: 1
    },
    // disable-web-security is used because of CORS rejections
    args: [ '--no-sandbox', '--disable-web-security', '--disable-setuid-sandbox' ]
  });

  // announce the amount of tests that are pending
  callback('started', map.length);

  /**
  * @param { Test } test
  * @param { number } id
  */
  const runTest = async(test, id) =>
  {
    const title = test.title || stepsToString(test.steps, {
      pretty: true,
      url: options.url
    }).trim();

    try
    {
      let selector;
      
      let fullscreen = false;

      callback('progress', {
        id,
        title,
        state: 'running'
      });

      const page = await browser.newPage();

      // start collecting coverage
      if (options.coverage)
      {
        await Promise.all([
          page.coverage.startJSCoverage(),
          page.coverage.startCSSCoverage()
        ]);
      }

      // an attempt to make tests more consistent
      // through different machines
      // works with anything that doesn't work too hard to track your location (google)
      await page.setExtraHTTPHeaders({
        'X-Forwarded-For': '8.8.8.8',
        'Accept-Language': 'en-US,en;q=0.5'
      });

      // go to the web app's url (retry enabled)
      await retry(
        () => page.goto(options.url, { timeout: options.stepTimeout }),
        1000,
        options.stepTimeout
      );

      // run the steps
      for (const step of test.steps)
      {
        const returnValue = await runStep(page, selector, step, options);

        if (step.action === 'viewport')
          fullscreen = returnValue;
        else
          selector = returnValue ?? selector;
      }

      // all steps were executed

      const screenshotId = md5(stepsToString(test.steps));
      const screenshotPath = join(options.screenshotsDir, `${screenshotId}.png`);

      const screenshotExists = await pathExists(screenshotPath);

      // new first-run test or a forced update
      const update = async(force) =>
      {
        // take a new screenshot and save it to disk
        await screenshot({
          page,
          full: fullscreen,
          path: screenshotPath
        });

        callback('progress', {
          id,
          title,
          force: force,
          state: 'updated'
        });

        updated = updated + 1;
      };

      if (!screenshotExists)
      {
        await update();
      }
      else if (options.target && options.update)
      {
        await update(true);
      }
      else
      {
        try
        {
          // compare the new screenshot
          const img1 = await jimp.read(await screenshot({
            page,
            full: fullscreen
          }));

          // with the old screenshot
          const img2 = await jimp.read(await readFile(screenshotPath));

          if (img1.getWidth() !== img2.getWidth() ||
            img1.getHeight() !== img2.getHeight())
            throw new Error('Error: Images have different sizes');

          const diff = jimp.diff(img1, img2);
          
          // throw error if they don't match each other
          if (diff.percent > 0)
          {
            throw new MismatchError(
              `Error: Images are ${Math.round(diff.percent * 100)}% different`,
              await diff.image.getBufferAsync(jimp.MIME_PNG)
            );
          }
          else
          {
            callback('progress', {
              id,
              title,
              state: 'passed'
            });

            passed = passed + 1;
          }
        }
        catch (e)
        {
          if (options.update)
          {
            failed = failed + 1;

            await update(true);
          }
          else
          {
            throw e;
          }
        }
      }

      // stop collecting coverage
      if (options.coverage)
      {
        const [ jsCoverage, cssCoverage ] = await Promise.all([
          page.coverage.stopJSCoverage(),
          page.coverage.stopCSSCoverage()
        ]);

        coverageCollection.push({
          url: page.url(),
          js: jsCoverage,
          css: cssCoverage
        });
      }

      // close the page
      await page.close();
    }
    catch (e)
    {
      // test failed

      callback('progress', {
        id,
        title,
        state: 'failed'
      });

      callback('error', e);
    }
  };
  
  const parallel = limit(options.parallel);

  // run tests in parallel
  await Promise.all(
    map.map(((t, id) => parallel(() => runTest(t, id))))
  );

  // close puppeteer
  await browser.close();

  // process the coverage of all the tests
  if (options.coverage)
  {
    callback('coverage', {
      state: 'running'
    });

    const sourceDir = join(options.coverageDir, '__tmp__');

    // empties and ensures that the coverage directories exists
    await emptyDir(options.coverageDir);
  
    // handle the coverage data returned by puppeteer
    const report = await coverage(coverageCollection, options.coverageDir, sourceDir, options.coverageExclude, options.coverageIgnoreLines);

    callback('coverage', {
      state: 'done',
      report
    });
  }

  callback('done', {
    total: map.length + skipped.length,
    passed,
    updated,
    skipped: skipped.length,
    failed
  });
}

/**
* @param { puppeteer.Page } page
* @param { string } selector
* @param { Step } step
* @param { Options } options
*/
async function runStep(page, selector, step, options)
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
      return step.value;
    }
  }
  else if  (step.action === 'viewport')
  {
    const value = step.value;
    
    const current = page.viewport();
    
    let width = current.width;
    let height = current.height;

    let touch = false;
    let fullscreen = false;

    if (value.includes('x'))
    {
      let [ w, h ] = step.value.split('x');

      w = parseInt(w), h = parseInt(h);

      if (!isNaN(w))
        width = w;

      if (!isNaN(h))
        height = h;
    }

    if (value.includes('t'))
      touch = true;

    if (value.includes('f'))
      fullscreen = true;

    await page.setViewport({
      width,
      height,
      hasTouch: touch,
      isMobile: false,
      isLandscape: false,
      deviceScaleFactor: 1
    });

    return fullscreen;
  }
  else if (step.action === 'goto')
  {
    let url = step.value;

    if (url === 'back')
    {
      await page.goBack({
        timeout: options.stepTimeout
      });
    }
    else if (url === 'forward')
    {
      await page.goForward({
        timeout: options.stepTimeout
      });
    }
    else
    {
      if (url.startsWith('/'))
        url = `${options.url}${url}`;

      await page.goto(url, {
        timeout: options.stepTimeout
      });
    }
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
    return step.value;
  }
  else if (step.action === 'hover')
  {
    await page.hover(selector);
  }
  else if (step.action === 'click')
  {
    const { hasTouch } = page.viewport();

    if (step.value === 'right')
      await page.click(selector, { button: 'right' });
    else if (step.value === 'middle')
      await page.click(selector, { button: 'middle' });
    else if (hasTouch)
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
}
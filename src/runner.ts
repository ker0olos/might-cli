import jimp from 'jimp';

import playwright from 'playwright';

import limit from 'p-limit';

import sanitize from 'sanitize-filename';

import md5 from 'md5';

import { join } from 'path';

import { pathExists, readFile, ensureDir, emptyDir, readdir, unlink } from 'fs-extra';

import { stepsToString } from 'might-core';

import screenshot from './screenshot.js';

import { difference } from './diff.js';

import { coverage } from './coverage.js';

type Step = import('might-core').Step;

export type Map = Test[];

type Test = {
  title: string,
  steps: Step[]
};

type Options = {
  url: string,
  viewport?: {
    width?: number,
    height?: number
  },
  map?: Map,
  target?: string[],
  browsers?: string[],
  update?: boolean,
  parallel?: number,
  repeat?: number,
  coverage?: boolean,
  clean?: boolean,
  screenshotsDir?: string,
  coverageDir?: string,
  titleBasedScreenshots?: boolean,
  stepTimeout?: number,
  tolerance?: number,
  antialiasingTolerance?: number,
  coverageExclude?: string[]
};

class MismatchError extends Error
{
  constructor(message: string, diff: Buffer)
  {
    super(message);

    this.diff = diff;
  }

  diff: Buffer
}

function wait(seconds: number)
{
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function retry(fn: () => Promise<unknown>, delay: number, maxTime: number)
{
  return new Promise((resolve, reject) =>
  {
    let timeout = false;

    const timeoutRef = setTimeout(() => timeout = true, maxTime);

    const r = (e: unknown) =>
    {
      if (timeoutRef)
        clearTimeout(timeoutRef);
      
      resolve(e);
    };

    const call = () => fn().then(r);

    const fail = (err: Error) =>
    {
      if (timeout)
        reject(err);
      else
        setTimeout(() => call().catch(fail), delay);
    };

    call().catch(fail);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runner(options: Options, callback: (type: 'started' | 'coverage' | 'progress' | 'error' | 'done', value: any) => void): Promise<void>
{
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
  options = options || {};

  options.viewport = (typeof options.viewport !== 'object') ? {} : options.viewport;

  options.viewport.width = (typeof options.viewport.width !== 'number') ? 1366 : (options.viewport.width || 1366);
  options.viewport.height = (typeof options.viewport.height !== 'number') ? 768 : (options.viewport.height || 768);

  options.titleBasedScreenshots = (typeof options.titleBasedScreenshots !== 'boolean') ? false : options.titleBasedScreenshots;

  options.stepTimeout = (typeof options.stepTimeout !== 'number') ? 25000 : (options.stepTimeout || 25000);

  options.parallel = (typeof options.parallel !== 'number') ? 3 : (options.parallel || 3);
  options.repeat = (typeof options.repeat !== 'number') ? 1 : (options.repeat || 1);

  options.tolerance = (typeof options.tolerance !== 'number') ? 2.5 : (options.tolerance || 2.5);
  options.antialiasingTolerance = (typeof options.antialiasingTolerance !== 'number') ? 3.5 : (options.antialiasingTolerance || 3.5);
  
  options.coverageExclude = (!Array.isArray(options.coverageExclude)) ? [] : options.coverageExclude;

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

  const coverageCollection: import('./coverage.js').CoverageEntry[] = [];

  // skipping broken tests
  // and filtering targets
  map = map.filter((t) =>
  {
    // skip tests with no steps
    if (!t.steps || t.steps.length <= 0)
      skipped.push(t);
    // leave the test in map
    // if its a target
    else if (options.target)
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

  const screenshots = {};

  // get all files in the screenshots directory
  (await readdir(options.screenshotsDir))
    .forEach((p) =>
    {
      if (p.endsWith('.png'))
        screenshots[join(options.screenshotsDir, p)] = true;
    });

  const targets = [ 'chromium', 'firefox', 'webkit' ]
    .filter(b => options.browsers.includes(b));

  const browsers = {
    chromium: targets.includes('chromium') ?
      await playwright.chromium.launch({
        timeout: 15000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // because of CORS rejections
          '--disable-web-security'
        ]
      }) : undefined,
    
    firefox: targets.includes('firefox') ?
      await playwright.firefox.launch({
        timeout: 15000
      }) : undefined,
    
    webkit: targets.includes('webkit') ?
      await playwright.webkit.launch({
        timeout: 15000
      }) : undefined
  };

  // announce the amount of tests that are pending
  callback('started', map.length);

  const runTest = async(browser: playwright.Browser, browserType: string, test: Test, displayName: string, screenshotId: string, callback: (type: 'progress' | 'error', args: unknown) => void) =>
  {
    try
    {
      let selector: string;
        
      let touch = false, full = false;

      let page: playwright.Page;

      // this will result in the page reloading (closing all previous steps and coverage)
      const updateContext = async(contextOptions?: playwright.BrowserContextOptions) =>
      {
        // clean up old page

        if (page)
        {
          await page.context().close();
          await page.close();
        }

        // create new page

        const context = await browser.newContext({
          colorScheme: 'light',
          hasTouch: touch,
          viewport: {
            width: options.viewport.width,
            height: options.viewport.height
          },
            
          ...contextOptions,

          locale: 'en-US',
          timezoneId: 'America/Los_Angeles'
        });
          
        page = await context.newPage();

        // start collecting coverage
        if (options.coverage && browserType === 'chromium')
          await page.coverage.startJSCoverage();

        // an easy attempt to make tests more consistent
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
      };

      await updateContext();

      let err: Error;

      page.on('crash', () =>
      {
        console.warn('Browser pages might crash if they try to allocate too much memory.');
        console.warn('The most common way to deal with crashes is to catch an exception.');

        err = new Error('Page crashed');
      });

      page.on('pageerror', e => err = e);

      page.on('requestfailed', e => err = new Error(`${e.method()} ${e.url()} ${e.failure().errorText}`));

      // run the steps
      for (const step of test.steps)
      {
        const returnValue = await runStep(page, selector, step, touch, options);
    
        if (step.action === 'viewport')
        {
          const { width, height }: {
              width: number,
              height: number,
              touch: boolean,
              full: boolean
            } = returnValue;

          if (typeof returnValue.full === 'boolean' && returnValue.full !== full)
            full = returnValue.full;

          // update context
          if (typeof returnValue.touch === 'boolean' && returnValue.touch !== touch)
          {
            touch = returnValue.touch;

            await updateContext({
              viewport: {
                width: width ?? options.viewport.width,
                height: height ?? options.viewport.height
              }
            });
          }
          // update just the viewport
          else
          {
            await page.setViewportSize({
              width: width ?? options.viewport.width,
              height: height ?? options.viewport.height
            });
          }
        }
        else
        {
          // set new selector if any
          selector = returnValue ?? selector;
        }
      }

      // all steps were executed

      if (err)
        throw err;

      const screenshotPath = join(options.screenshotsDir, `${screenshotId}.${browserType}.png`);

      const screenshotExists = await pathExists(screenshotPath);

      // new first-run test or a forced update
      const update = async(force?: boolean) =>
      {
        // take a new screenshot and save it to disk
        await screenshot({
          full,
          page,
          path: screenshotPath
        });

        // mark screenshot as used
        // eslint-disable-next-line security/detect-object-injection
        screenshots[screenshotPath] = false;

        callback('progress', {
          title: displayName,
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
            full,
            page
          }));

          // with the old screenshot
          const img2 = await jimp.read(await readFile(screenshotPath));

          const [ x1, y1 ] = [ img1.getWidth(), img1.getHeight() ];
          const [ x2, y2 ] = [ img2.getWidth(), img2.getHeight() ];

          if (x1 !== x2 || y1 !== y2)
          {
            throw new Error(`Error: Screenshots have different sizes (${x2}x${y2}) (${x1}x${y1})`);
          }

          const diff = await difference(
            img1, img2,
            options.tolerance,
            options.antialiasingTolerance
          );

          if (!diff.same)
          {
            // throw error if they don't match each other

            throw new MismatchError(
              `Error: Found ${diff.differences} difference`,
              await diff.diffImage
            );
          }
          else
          {
            // mark screenshot as used
            // eslint-disable-next-line security/detect-object-injection
            screenshots[screenshotPath] = false;

            callback('progress', {
              title: displayName,
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
      if (options.coverage && browserType === 'chromium')
      {
        const coverage = await page.coverage.stopJSCoverage();
          
        coverageCollection.push(...coverage);
      }

      // close the page and context
        
      await page.context().close();
      await page.close();
    }
    catch (e)
    {
      // test failed

      callback('progress', {
        title: displayName,
        state: 'failed'
      });

      callback('error', e);
    }
  };

  const prepTest = async(test: Test, id: number) =>
  {
    const displayName = test.title || stepsToString(test.steps, {
      pretty: true,
      url: options.url
    }).trim();

    const screenshotId =
    // [this is the default method and also the fallback to title-based screenshots]
    // if not then screenshots names are based on the md5 sum of all the test's steps
    // if 2 or more tests have the same exact steps they will have the same screenshot,
    // PROS: the same the series of steps should always result into the same screenshot
    // each time they run
    // PROS: any change in the test results in creating a new screenshot instead to needing to update them each time
    // CONS: it makes it harder to view the results of tests on their initial run
    (!options.titleBasedScreenshots || !test.title) ?
      md5(stepsToString(test.steps)) :
      // if enabled then screenshots names are based on the test's title
      // if 2 or more tests have the same title they will have the same screenshot
      // PROS: easier to view and compare
      // CONS: needs to be update each time the test steps change
      // CONS: will cause tests with duplicate titles to fail
      sanitize(test.title);

    const processes = [];

    callback('progress', {
      id,
      title: displayName,
      state: 'running'
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let callbackArgs: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callbackWrapper = (type: 'progress' | 'error', args: any) =>
    {
      if (type === 'error')
      {
        callback('progress', callbackArgs);
        
        callback('error', args);
      }
      else if (
        type === 'progress' &&
        // avoid outputting passed state
        // if a different test was updated
        (callbackArgs === undefined || args.state !== 'passed')
        // we don't have to worry about checking
        // arguments, since there's only 'force'
        // and it won't differ between each test
      )
      {
        callbackArgs = {
          id,
          ...args
        };
      }
    };

    for (const type of targets)
    {
      // eslint-disable-next-line security/detect-object-injection
      const browser = browsers[type];

      processes.push(runTest(browser, type, test, displayName, screenshotId, callbackWrapper));
    }

    // runs the test on all targets in parallel
    await Promise.all(processes);

    // release the real callback after
    // all the browsers are finished
    callback('progress', callbackArgs);
  };
  
  const parallel = limit(options.parallel);

  for (let i = 0; i < options.repeat; i++)
  {
    await Promise.all(
      map.map(((t, index) => parallel(() => prepTest(t, index))))
    );
  }

  // close browsers
  await Promise.all(targets
    // eslint-disable-next-line security/detect-object-injection
    .map(async(key) => await browsers[key].close()));

  // process the coverage of all the tests
  if (options.coverage)
  {
    callback('coverage', {
      state: 'running'
    });

    // empties and ensures that the coverage directories exists
    await emptyDir(options.coverageDir);
  
    //  handle the coverage data returned by playwright
    const report = await coverage(coverageCollection, options.coverageDir, options.coverageExclude);

    callback('coverage', {
      state: 'done',
      report
    });
  }

  // filter screenshots that were used to only get the unused ones
  const unused = Object.keys(screenshots)
    // eslint-disable-next-line security/detect-object-injection
    .filter(key => screenshots[key] === true);

  // cleaning unused screenshots
  // screenshots are only cleaned if no tests were targeted
  if (!options.target && options.clean)
  {
    for (let i = 0; i < unused.length; i++)
    {
      // eslint-disable-next-line security/detect-object-injection
      await unlink(unused[i]);
    }
  }

  callback('done', {
    total: passed + updated + failed + skipped.length,
    unused,
    passed,
    updated,
    skipped: skipped.length,
    failed
  });
}

async function runStep(page: playwright.Page, selector: string, step: Step, touchEvents: boolean, options: Options)
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
    
    const current = page.viewportSize();
    
    let width = current.width;
    let height = current.height;

    let touch = false;
    let full = false;

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
      full = true;

    return {
      width,
      height,
      touch,
      full
    };
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

    // TODO prefers-reduced-motion is not supported on playwright

    if (name === 'prefers-color-scheme' && [ 'light', 'dark', 'no-preference' ].includes(value))
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.emulateMedia({ colorScheme: (value as any) });
    }
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
    const elements = await page.$$(selector);

    for (const elem of elements)
    {
      if (step.value === 'right')
        await elem.click({ button: 'right', force: true, timeout: options.stepTimeout });
      else if (step.value === 'middle')
        await elem.click({ button: 'middle', force: true, timeout: options.stepTimeout });
      else if (touchEvents)
        await elem.tap({ force: true, timeout: options.stepTimeout });
      else
        await elem.click({ button: 'left', force: true, timeout: options.stepTimeout });

      await page.mouse.move(-1, -1);
    }
  }
  else if (step.action === 'drag')
  {
    // dragging an element to a specified location
    // (relative to selected element)

    let [ x1, y1 ] = step.value;

    const elem = await page.$(selector);

    const boundingBox = await elem.boundingBox();

    const { width, height } = page.viewportSize();

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

    const { width, height } = page.viewportSize();

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
    const split: string[] = step.value.replace('++', '+NumpadAdd').split('+');

    const elem = await page.$(selector);

    // make sure the selected element is focused
    await elem.focus();

    const
      shift = split.includes('Shift'),
      ctrl = split.includes('Control'),
      alt = split.includes('Alt');

    // hold modifier keys

    if (shift)
      await page.keyboard.down('Shift');

    if (ctrl)
      await page.keyboard.down('Control');

    if (alt)
      await page.keyboard.down('Alt');

    // press all other keys

    for (let i = 0; i < split.length; i++)
    {
      // eslint-disable-next-line security/detect-object-injection
      const key = split[i];

      if (key !== 'Shift' && key !== 'Control' && key !== 'Alt')
        await page.keyboard.press(key);
    }

    // release modifier keys

    if (shift)
      await page.keyboard.up('Shift');

    if (ctrl)
      await page.keyboard.up('Control');

    if (alt)
      await page.keyboard.up('Alt');

    // blur the element after that because
    // input caret can ruin tests
    await elem.evaluate((elem) => elem.blur());
  }
  else if (step.action === 'type')
  {
    const elements = await page.$$(selector);

    for (const elem of elements)
    {
      // get in the new value
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = await elem.evaluate((elem) => (elem as any).value);

      // focus on the input element
      await elem.focus();

      // empty the input element's value
      for (let i = 0; i < current.length; i++)
      {
        await page.keyboard.press('Backspace');
      }

      // type in the new value
      await page.keyboard.type(step.value);

      // blur the element after that because
      // input caret can ruin tests
      await elem.evaluate((elem) => elem.blur());
    }
  }
}
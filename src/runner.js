import puppeteer from 'puppeteer';

import { terminal } from 'terminal-kit';

import { stepsToString, roundTime, path } from './utils.js';

import { exitForcefully } from '.';

const stepTimeout = 10000;

/**
* @param { import('./map.js').MightMap } map
* @param { import('.').MightConfig } config
*/
export async function runner(map, config)
{
  // eslint-disable-next-line no-async-promise-executor
  await new Promise(async(resolve) =>
  {
    const tasks = map.map((t) => t.title || stepsToString(t.steps));

    terminal.clear();

    terminal('[Might] Running Tests:');

    // map has no tests
    if (tasks.length <= 0)
    {
      terminal.yellow('\n\nMap has no tests.');
      
      return resolve();
    }

    // show a progress ba in the terminal
    const progressBar = terminal.progressBar({
      width: 80,
      title: '\n\n',
      percent: true,
      items: tasks.length
    });

    // launch puppeteer
    const browser = await puppeteer.launch({
      timeout: stepTimeout,
      defaultViewport: { width: 1366, height: 768 },
      args: [ '--no-sandbox', '--disable-setuid-sandbox' ]
    });

    // run all test in sequence
    for (const t of map)
    {
      const id = stepsToString(t.steps);

      const title = t.title || id;

      try
      {
        progressBar.startItem(title);

        t.startTimeStamp = Date.now();
      
        const page = await browser.newPage();

        // set the ip as Google's Public DNS
        // attempt to make tests consistent
        // through different machines
        await page.setExtraHTTPHeaders({
          'x-forwarded-for': '8.8.8.8'
        });

        // go to the web app's url
        await page.goto(config.url, {
        // septate timeout - since some web app will take some time
        // to compile, start then load
          timeout: 60000
        });

        // TODO follow test steps

        // await page.click('div[title="Lista de Tarefas"]');

        // store screenshot if doesn't exists
        // or if config has update: true

        // await page.screenshot({
        //   path: path('screenshot.png')
        // });

        t.state = 'passed';

        t.endTimeStamp = Date.now();

        progressBar.itemDone(title);
      }
      catch (e)
      {
        // test failed
        t.error = e;
        t.state = 'failed';
        t.endTimeStamp = Date.now();
        
        // one test failed
        // don't run the rest
        break;
      }
    }

    // close puppeteer
    await browser.close();

    // print info about all tests

    terminal.clear();

    terminal('[Might] Tests Results:\n\n');

    for (const t of map)
    {
      const title = t.title || stepsToString(t.steps);

      const time = roundTime(t.startTimeStamp, t.endTimeStamp);

      if (t.state === 'passed')
      {
        terminal.green(`PASSED (${time}s) `);
        terminal(`${title}\n`);
      }
      else if (t.state === 'updated')
      {
        terminal.yellow(`UPDATED (${time}s) `);
        terminal(`${title}\n\n`);
      }
      else
      {
        terminal.red(`FAILED (${time}s) `);
        terminal(`${title}\n\n`);

        // print the error
        terminal(t.error);
        
        // force exit the process with an exit code 1
        exitForcefully();
      }
    }

    resolve();
  });
}
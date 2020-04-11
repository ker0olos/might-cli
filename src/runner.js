// import puppeteer from 'puppeteer';

import { terminal } from 'terminal-kit';

/**
* @param { import('./map.js').MightMap } map
* @param { import('.').MightConfig } config
*/
export async function runner(map, config)
{
  terminal.red('Runner is not yet implemented.');

  // const browser = await puppeteer.launch({
  //   defaultViewport: { width: 1366, height: 768 },
  //   args: [ '--no-sandbox', '--disable-setuid-sandbox' ]
  // });

  // const page = await browser.newPage();

  // set the ip as Google's Public DNS
  // attempt to make tests consistent
  // through different machines
  // await page.setExtraHTTPHeaders({
  //   'x-forwarded-for': '8.8.8.8'
  // });

  // await page.goto(config.url);

  // await page.click();
  
  // await page.screenshot({
  //   path: join(process.cwd(), 'screenshot.png')
  // });

  // await browser.close();
}
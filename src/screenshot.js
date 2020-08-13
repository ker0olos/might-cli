/* eslint-disable no-undef */

// this implementation is originally from puppeteer-full-page-screenshot
// https://github.com/morteza-fsh/puppeteer-full-page-screenshot/blob/6fcb7afabd185b670649666c7c065a440f5273f0/src/index.js

import jimp from 'jimp';

import merge from 'merge-img';

import { promisify } from 'util';

/**
* @param { import('puppeteer').Page } page
*/
const pageDown = async(page) =>
{
  const isEnd = await page.evaluate(() =>
  {
    window.scrollBy(0, window.innerHeight);

    return window.scrollY >= (document.body.clientHeight - window.innerHeight);
  });

  return isEnd;
};

/**
* @param { { page: import('puppeteer').Page, path: string, full: boolean } } options
*/
export default async(options) =>
{
  options = options || {};

  const page = options.page;

  if (!options.full)
  {
    return await page.screenshot({
      path: options.path
    });
  }

  // puppeteer appears to have an issue with full-page screenshots
  // on some web apps including one of ours
  // so we're going to be using this workaround of the foreseeable future

  const { pagesCount, extraPixels, viewport } = await page.evaluate(() =>
  {
    window.scrollTo(0, 0);

    return {
      pagesCount: Math.ceil(document.body.clientHeight / window.innerHeight),
      extraPixels: document.body.clientHeight % window.innerHeight * window.devicePixelRatio,
      viewport: { height: window.innerHeight * window.devicePixelRatio, width: window.innerWidth * window.devicePixelRatio }
    };
  });

  if (pagesCount === 1)
  {
    return await page.screenshot({
      path: options.path
    });
  }

  const images = [];

  for (let index = 0; index < pagesCount; index++)
  {
    const image = await page.screenshot();

    await pageDown(page);

    images.push(image);
  }

  // crop last image extra pixels
  const last = images.pop();

  const cropped = await jimp.read(last)
    .then(image => image.crop(0, viewport.height - extraPixels, viewport.width, extraPixels))
    .then(image => image.getBufferAsync(jimp.MIME_PNG));

  images.push(cropped);

  const mergedImage = await merge(images, { direction: true });

  if (options.path)
  {
    mergedImage.write = mergedImage.write.bind(mergedImage);

    const writeAsync = promisify(mergedImage.write);

    await writeAsync(options.path);

    return;
  }

  mergedImage.getBuffer = mergedImage.getBuffer.bind(mergedImage);

  const getBufferAsync = promisify(mergedImage.getBuffer);

  return await getBufferAsync(jimp.MIME_PNG);
};
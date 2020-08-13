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
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
};

// /**
// * @param { import('puppeteer').Page } page
// */
// const removeFixedSticky = async(page) =>
// {
//   await page.evaluate(() =>
//   {
//     const elements = document.querySelectorAll('body *');

//     elements.forEach((el) =>
//     {
//       const { display, position } = window.getComputedStyle(el);

//       // if ((position === 'fixed' || position === 'sticky') && display !== 'none')
//       if ((position === 'fixed' || position === 'sticky') && display !== 'none')
//         el.parentNode.removeChild(el);
//     });
//   });
// };

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
  // on some web apps including one of ours (possibly due to the use of the viewport units)
  // so we're going to be using this workaround of the foreseeable future

  const { pagesCount, extraPixels, viewport } = await page.evaluate(() =>
  {
    // scroll to the beginning of the page
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

  for (let i = 0; i < pagesCount; i++)
  {
    const image = await page.screenshot();

    images.push(image);

    await pageDown(page);

    // this has an issue with sticky elements
    // since this scrolls the page
    // sticky elements will appear multiple times

    // this is not considered as an issue
    // however, we do have this fix here
    // if we ever needed to act on this

    // if (i === 0)
    //   await removeFixedSticky(page);
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
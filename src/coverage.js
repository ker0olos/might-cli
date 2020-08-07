import libCoverage from 'istanbul-lib-coverage';

import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
 
import v8ToIstanbul from 'v8-to-istanbul';

import fetch from 'node-fetch';

import globRegex from 'glob-to-regexp';

import { join, resolve } from 'path';

import { outputFile, remove } from 'fs-extra';

/**
* @typedef { import('puppeteer').CoverageEntry } CoverageEntry
*/

/**
* @param { { url: string, js: CoverageEntry[], css: CoverageEntry[] } } puppeteerData
* @param { string } glob
* @param { string } mainDir
* @param { string } sourceDir
*/
export async function coverage(puppeteerData, glob, mainDir, sourceDir)
{
  // TODO FIX results are not accurate at all

  // TODO merge all tests result into one report

  // TODO enable css support
  
  const includeRegex = globRegex(glob, {
    globstar: true
  });

  const coverageMap = libCoverage.createCoverageMap();

  // const summary = libCoverage.createCoverageSummary();

  const v8Coverage = await convertPuppeteerToV8(puppeteerData.js, puppeteerData.url, includeRegex, sourceDir);

  console.log('v8 coverage data length is', v8Coverage.length);
  
  console.log('v8 coverage data urls:');

  v8Coverage.forEach((c, i) => console.log(i, '-', c.url));

  for (let i = 0; i < v8Coverage.length; i++)
  {
    // eslint-disable-next-line security/detect-object-injection
    const entry = v8Coverage[i];

    // using V8-to-istanbul convert the data we created
    // to data that can be consumed by istanbul to create a report

    const converter = v8ToIstanbul(entry.url);

    await converter.load();

    converter.applyCoverage(entry.functions);
  
    const istanbulCoverage = converter.toIstanbul();

    for (const filename in istanbulCoverage)
    {
      // eslint-disable-next-line security/detect-object-injection
      const file = istanbulCoverage[filename];

      // if file is included
      if (includeRegex.test(file.path))
      {
        // turn it to an absolute path if not
        if (!file.path.startsWith(sourceDir))
          file.path = join(sourceDir, file.path);

        coverageMap.addFileCoverage(file);

        // const fc = coverageMap.fileCoverageFor(file.path);

        // summary.merge(fc.toSummary());
      }
    }
  }
  
  const context = libReport.createContext({
    dir: mainDir,
    defaultSummarizer: 'nested',
    coverageMap
  });
  
  reports.create('html').execute(context);
  
  // reports.create('lcov').execute(context);
  // reports.create('clover').execute(context);
  // reports.create('json').execute(context);

  // source data is not needed anymore
  // await remove(sourceDir);
}

/**
* @param { CoverageEntry[] } coverageEntries
* @param { string } pageUrl
* @param { RegExp } includeRegex
* @param { string } sourceDir
*/
async function convertPuppeteerToV8(coverageEntries, pageUrl, includeRegex, sourceDir)
{
  /** covert puppeteer range object to V8 range object
  * @param { { start: number, end: number } } range
  */
  const convertRange = (range) => ({
    startOffset: range.start,
    endOffset: range.end,
    count: 1
  });

  const convertedData = [];

  for (let i = 0; i < coverageEntries.length; i++)
  {
    // eslint-disable-next-line security/detect-object-injection
    const entry = coverageEntries[i];
    
    // create a filename by removing the page url part
    // and joining the rest of the string to the coverage directory
    const source = join(sourceDir, entry.url.replace(pageUrl, ''));

    // save the text (script) to disk
    await outputFile(source, entry.text);
    // await outputFile(source, entry.text.replace(/\/\/# sourceMappingURL=/g, '//'));

    // this experimental source-map support
    // is experimental, very experimental.

    // our support should to be kept up-to-date with v8-to-istanbul support

    // check the text for the source-map tag
    let sourceMap = entry.text.lastIndexOf('//# sourceMappingURL=');
    
    if (sourceMap)
    {
      // extract source-map path
      sourceMap = entry.text.substring(sourceMap).replace('//# sourceMappingURL=', '');

      // make the full url of the source-map
      const sourceMapUrl = `${pageUrl}/${sourceMap}`;

      // filename for the source-map file
      const sourceMapPath = join(sourceDir, sourceMap);

      // fetch the source-map file using its full url
      const response = await fetch(sourceMapUrl);

      let buffer = await response.arrayBuffer();

      buffer  = Buffer.from(buffer);

      // save the source-map file to disk
      await outputFile(sourceMapPath, buffer);

      // unpack source-map files
      
      const data = JSON.parse(buffer.toString());

      const files = data.sources
        .map((path, idx) =>
        {
          // ignore protocol
          if (path.indexOf(':') >= 0)
            path = path.split(':')[1];

          // if file is included
          if (includeRegex.test(resolve(path)))
          {
            // transform to a full path
            const filename = join(sourceDir, path);
  
            // save to disk
            // eslint-disable-next-line security/detect-object-injection
            return outputFile(filename, data.sourcesContent[idx]).catch(() => undefined);
          }
        });

      await Promise.all(files);
    }

    convertedData.push({
      url: source,
      functions: [ {
        functionName: '',
        isBlockCoverage: false,
        ranges: entry.ranges.map(convertRange)
      } ]
    });
  }

  return convertedData;
}
/* eslint-disable security/detect-object-injection */

import { createCoverageMap } from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';

import reports from 'istanbul-reports';

import fetch from 'node-fetch';

import convert from 'convert-source-map';

import { SourceMapConsumer } from 'source-map';

import { isMatch } from 'nanomatch';

import { join } from 'path';

import { outputFile, remove } from 'fs-extra';

/**
* @typedef { import('puppeteer').CoverageEntry } CoverageEntry
*/

/**
* @param { { url: string, js: CoverageEntry[], css: CoverageEntry[] }[] } collection
* @param { string } mainDir
* @param { string } sourceDir
* @param { string[] } ignore
*/
export async function coverage(collection, mainDir, sourceDir, ignore)
{
  const mainMap = createCoverageMap();

  for (const item of collection)
  {
    const data = await getCoverageMap(item, sourceDir, ignore);
   
    // merges all tests coverage together in one report
    mainMap.merge(data);
  }

  const context = createContext({
    dir: mainDir,
    defaultSummarizer: 'nested',
    coverageMap: mainMap
  });

  reports.create('lcov').execute(context);
  reports.create('clover').execute(context);
  reports.create('json').execute(context);

  // clean the source directory
  await remove(sourceDir);

  // const output = {
  //   files: [],
  //   pct: 0
  // };

  // const files = mainMap.files();

  // for (let i = 0; i < files.length; i++)
  // {
  //   const file = mainMap.fileCoverageFor(files[i]);

  //   output.files.push({
  //     path: files[i].replace(sourceDir, ''),
  //     pct: file.toSummary().lines.pct
  //   });
  // }

  // output.pct = mainMap.getCoverageSummary().lines.pct;

  return mainMap.getCoverageSummary().lines.pct;
}

/**
* @param { { url: string, js: CoverageEntry[], css: CoverageEntry[] } } data
* @param { string } sourceDir
* @param { string[] } ignore
*/
async function getCoverageMap(data, sourceDir, ignore)
{
  const map = createCoverageMap();

  const coverageData = await fromPuppeteer([ ...data.js, ...data.css ], data.url, ignore, sourceDir);

  for (const fileCoverage in coverageData)
  {
    map.addFileCoverage(coverageData[fileCoverage]);
  }

  return map;
}

/**
* @param { CoverageEntry[] } coverageEntries
* @param { string } pageUrl
* @param { import('ignore').Ignore } ignore
* @param { string } sourceDir
*/
async function fromPuppeteer(coverageEntries, pageUrl, ignore, sourceDir)
{
  /**
  * @type { Object<string, import('istanbul-lib-coverage').FileCoverageData> }
  */
  const convertedData = {};

  for (let i = 0; i < coverageEntries.length; i++)
  {
    const entry = coverageEntries[i];

    // since this object is sent by puppeteer
    // its a full url, we only want the path name
    const entryPath = new URL(entry.url).pathname;

    // match path with ignore globs
    if (isMatch(entryPath.replace('\\', ''), ignore) || entryPath.length <= 1)
      continue;

    // create a filename by removing the page url part
    // and joining the rest of the string to the coverage directory
    const sourcePath = join(sourceDir, entryPath);

    // save the script text to disk
    await outputFile(sourcePath, entry.text);

    /**
    * @type { import('convert-source-map').SourceMapConverter }
    */
    let sourceMap;

    // download [file].map if found
    try
    {
      const response = await fetch(`${entry.url}.map`);

      if (response.status !== 200)
        throw new Error();

      const buffer = Buffer.from(await response.arrayBuffer());

      // save the source-map file to disk
      await outputFile(`${sourcePath}.map`, buffer);
    }
    catch
    {
      // don't freakout if the file doesn't exists
    }

    try
    {
      // read the source-map file from the entry script (if any)
      sourceMap =
      convert.fromSource(entry.text)?.sourcemap ??
      convert.fromMapFileSource(entry.text, sourceDir)?.sourcemap;
    }
    catch
    {
      // don't freakout if it can't happen
    }

    if (sourceMap)
    {
      const consumer = await SourceMapConsumer.with(sourceMap, undefined, c => c);

      // unpack source-map files
      await Promise.all(consumer.sources
        .map((path, id) =>
        {
          let relative = path;

          // ignore protocols
          if (path.indexOf('://') >= 0)
            relative = path.split('://')[1];

          // match path with ignore globs
          // P.S. some tools like webpack write filename
          // that contain backslashes and those break nanomatch
          // so we remove them in the test string
          if (!isMatch(relative.replace('\\', ''), ignore))
          {
            // transform to a full path
            const filename = join(sourceDir, relative);

            const text = consumer.sourcesContent[id];

            // this is called here with an empty range
            // simply to create a statementMap for each file
            // the fileCoverage returned is later used to write
            // the actual coverage data
            const fileCoverage = fromFile(sourceDir, relative, text, []);

            convertedData[path] = fileCoverage;

            // save to disk
            // those files are used while istanbul is generating reports
            // and get cleaned up after
            return outputFile(filename, consumer.sourcesContent[id]).catch(() => undefined);
          }
        }));

      // all the lines of the generated script
      const lines = buildLines(entry.text);

      /**
      * @type { import('source-map').MappingItem[][] }
      */
      const mappings = {};

      // store mappings
      // which are used to determine
      // original lines
      consumer.eachMapping((mapping) =>
      {
        if (!mappings[mapping.generatedLine])
          mappings[mapping.generatedLine] = [];

        mappings[mapping.generatedLine].push(mapping);
      });

      for (const range of entry.ranges)
      {
        const generatedCovered = rangeToLines(lines, entry.text, range);

        // loop though the generated covered lines
        // marking each time an original line is found
        for (let i = generatedCovered.startLine.line; i < generatedCovered.endLine.line; i++)
        {
          const originalCovered = mappings[i];

          originalCovered?.forEach((mapping) =>
          {
            const path = mapping?.source;

            // this is only true if
            // the file is not ignored
            if (convertedData[path])
            {
              // if that line number is part of the statement map
              if (convertedData[path].statementMap[mapping.originalLine])
                convertedData[path].s[mapping.originalLine] = 1;
            }
          });
        }
      }
    }
    // no sourcemap was detected
    // processing coverage on entry's text as-is
    else
    {
      const fileCoverage = fromFile(
        sourceDir,
        entryPath,
        entry.text,
        entry.ranges);

      convertedData[entry.url] = fileCoverage;
    }
  }

  return convertedData;
}

/**
* @param { string } sourceDir
* @param { string } path
* @param { string } text
* @param { { start: number, end: number }[] } ranges
*/
function fromFile(sourceDir, path, text, ranges)
{
  /**
  * @type { Object<string, import('istanbul-lib-coverage').Range> }
  */
  const statementMap = {};

  /**
  * @type { Object<string, number> }
  */
  const s = {};

  // /**
  // * @type { Object<string, import('istanbul-lib-coverage').BranchMapping> }
  // */
  // const branchMap = {};

  // /**
  // * @type { Object<string, number[]> }
  // */
  // const b = {};

  // let branches = 0;
  
  const lines = buildLines(text);

  for (let i = 0; i < lines.length; i++)
  {
    const number = lines[i].line;

    const startCol = 0;
    const endCol = lines[i].endCol - lines[i].startCol;

    // ignores empty lines
    if (endCol > 0)
    {
      statementMap[number] = {
        start: {
          line: number,
          column: startCol
        },
        end: {
          line: number,
          column: endCol
        }
      };

      s[number] = 0;
    }
  }

  for (const range of ranges)
  {
    const covered = rangeToLines(lines, text, range);

    for (let number = covered.startLine.line; number <= covered.endLine.line; number++)
    {
      // if that line number is part of the statement map
      if (statementMap[number])
        s[number] = 1;
    }

    // const branch = {
    //   start: {
    //     line: covered.startLine.line,
    //     column: range.start - covered.startLine.startCol
    //   },
    //   end: {
    //     line: covered.endLine.line,
    //     // column: range.end - covered.endLine.startCol
    //     column: range.end - covered.endLine.endCol
    //   }
    // };

    // const x = branches++;

    // branchMap[x] = {
    //   type: 'branch',
    //   line: covered.startLine.line,
    //   loc: branch,
    //   locations: [ branch ]
    // };

    // b[x] = [ 1 ];
  }

  return {
    path: join(sourceDir, path),
    statementMap,
    s,
    branchMap: {},
    b: {},
    fnMap: {},
    f: {}
  };
}

/**
* @param { string } text
* @returns { { line: number, startCol: number, endCol: number }[] }
*/
function buildLines(text)
{
  // this implementation is originally from v8-to-istanbul
  // https://github.com/istanbuljs/v8-to-istanbul/blob/b11b90f71ecf5bddbe77d2c882df6ab90230b89b/lib/source.js#L17

  // eslint-disable-next-line security/detect-unsafe-regex
  const lineRegex = /(?<=\r?\n)/u;

  let position = 0;

  const lines = [];

  for (const [ i, lineStr ] of text.split(lineRegex).entries())
  {
    const lineStrTrimmed = lineStr.trim();

    const line = i + 1;
    const startCol = position;

    const matchedNewLineChar = lineStr.match(/\r?\n$/u);

    const newLineLength = matchedNewLineChar ? matchedNewLineChar[0].length : 0;

    let endCol = startCol + lineStr.length - newLineLength;

    // ignore lines of full of just whitespace
    if (!lineStrTrimmed.length)
      endCol = startCol;

    lines.push({
      line,
      startCol,
      endCol
    });

    position += lineStr.length;
  }

  return lines;
}

/**
* @param { { line: number, startCol: number, endCol: number }[] } lines
* @param { string } text
* @param { { start: number, end: number } } range
*/
function rangeToLines(lines, text, range)
{
  // this implementation is originally from v8-to-istanbul
  // https://github.com/istanbuljs/v8-to-istanbul/blob/b11b90f71ecf5bddbe77d2c882df6ab90230b89b/lib/v8-to-istanbul.js#L167

  const startCol = Math.max(0, range.start);
  const endCol = Math.min(text.length, range.end);

  const matched = lines.filter((line) => (startCol <= line.endCol && endCol >= line.startCol));

  return {
    startLine: matched[0],
    endLine: matched[matched.length - 1]
  };
}
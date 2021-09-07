/* eslint-disable security/detect-object-injection */

import v8toIstanbul from 'v8-to-istanbul';

import { createContext } from 'istanbul-lib-report';

import * as libCoverage from 'istanbul-lib-coverage';

import type { FileCoverage, FileCoverageData } from 'istanbul-lib-coverage';

import reports from 'istanbul-reports';

import { join } from 'path';

import { outputFile } from 'fs-extra';

import { SourceMapConsumer, RawSourceMap } from 'source-map';

import convert from 'convert-source-map';

import * as nanomatch from 'nanomatch';

export type CoverageEntry = {
  url: string,
  scriptId: string,
  source?: string,
  functions: {
    functionName: string,
    isBlockCoverage: boolean,
    ranges: {
      count: number,
      startOffset: number,
      endOffset: number
    }[]
  }[]
}

export async function coverage(coverageCollection: CoverageEntry[], meta: { name: string }, dir: string, exclude: string[]): Promise<[ number, { name: string, coverage: number, uncoveredLines: number[] }[] ]>
{
  const mainMap = libCoverage.createCoverageMap();

  const processed: Record<string, ReturnType<typeof v8toIstanbul>> = {};

  for (const entry of coverageCollection)
  {
    // since this object is sent by chromium
    // its a full url, we only want the path name
    const entryPath = new URL(entry.url).pathname;

    // match path with excluded globs
    if (!entryPath.length || nanomatch.any(entryPath.replace('\\', ''), exclude, undefined))
      continue;
    
    if (!processed[entryPath])
    {
      const sourcemap = await getSourcemap(entry);

      if (sourcemap)
      {
        const consumer = await SourceMapConsumer.with(sourcemap, undefined, c => c);
  
        // unpack source-map files
        await Promise.all(consumer.sources
          .map(async(path, id) =>
          {
            let relative = path.replace(/\\/g, '');

            // ignore protocols

            if (path.includes('://'))
              relative = path.substring(path.indexOf('://') + 3);

            // eslint-disable-next-line security/detect-non-literal-regexp
            relative = relative.replace(new RegExp(process.env.PWD, 'g'), '');

            // ignore project

            if (relative.startsWith(`/${meta.name}/`))
              relative = relative.replace(`/${meta.name}`, '');
            else if (relative.startsWith(`${meta.name}/`))
              relative = relative.replace(meta.name, '');
            
            if (!relative.startsWith('/'))
              relative = '/' + relative;
              
            // match path with excluded globs
            if (!nanomatch.any(relative, exclude, undefined))
            {
              // save to disk
              // those files are used while istanbul is generating reports
              // and get cleaned up after
  
              try
              {
                await outputFile(join(dir, relative), sourcemap?.sourcesContent?.[id]);
              }
              catch (err)
              {
                //
              }
            }
          }));
      }

      processed[entryPath] = v8toIstanbul('', 0, {
        sourceMap: sourcemap ? { sourcemap } : undefined,
        source: entry.source
      });

      await processed[entryPath].load();
    }

    const converter = processed[entryPath];
    
    converter.applyCoverage(entry.functions);

    const data = converter.toIstanbul();

    Object.entries(data).forEach(([ key, file ]) =>
    {
      key = key
        .replace(/\\/g, '')
        // eslint-disable-next-line security/detect-non-literal-regexp
        .replace(new RegExp(process.env.PWD, 'g'), '');

      // ignore project

      if (key.startsWith(`/${meta.name}/`))
        key = key.replace(`/${meta.name}`, '');
      else if (key.startsWith(`${meta.name}/`))
        key = key.replace(meta.name, '');
      
      if (!key.startsWith('/'))
        key = '/' + key;

      // match path with excluded globs
      if (nanomatch.any(key, exclude, undefined))
        return;

      // resolve path
      file.path = join(dir, key);

      try
      {
        const exists = mainMap.fileCoverageFor(file.path);

        // due to merging 2 different file coverages
        // one of the files can have more mappings than the other
        // which causes everything to break horribly
        // when creating lcov reports

        // the inconsistent branch/function mappings is
        // a delicacy of the v8-to-istanbul transformation

        mergeMappings(file, exists);

        // normally merge the coverages
        exists.merge(file);
      }
      catch
      {
        mainMap.addFileCoverage(file);
      }
    });
  }

  const context = createContext({
    dir,
    defaultSummarizer: 'nested',
    coverageMap: mainMap
  });

  try
  {
    reports.create('json').execute(context);
    reports.create('clover').execute(context);
    reports.create('lcov').execute(context);
  }
  catch (e)
  {
    // don't freakout
    // console.error(e);
  }

  return [ Math.floor(mainMap.getCoverageSummary().lines.pct), mainMap.files().map(file =>
  {
    const coverage = Math.floor(mainMap.fileCoverageFor(file).toSummary().lines.pct);
    const uncoveredLines = mainMap.fileCoverageFor(file).getUncoveredLines();

    return {
      name: file.replace(dir, ''),
      coverage,
      uncoveredLines
    };
  }) ];
}

function mergeMappings(file: FileCoverage | FileCoverageData, target: FileCoverage)
{
  // add missing function mappings to the target file
  Object.entries(file.fnMap).forEach(([ key, mapping ]) =>
  {
    if (target.fnMap[key] === undefined)
      target.fnMap[key] = mapping;
  });

  // add missing brach mappings to the target file
  Object.entries(file.branchMap).forEach(([ key, mapping ]) =>
  {
    if (target.branchMap[key] === undefined)
      target.branchMap[key] = mapping;
  });
}

async function getSourcemap(entry: CoverageEntry)
{
  let sourcemap: RawSourceMap;

  // try to get the source-map using the source file itself

  try
  {
    // read the source-map file from the entry script (if any)
    sourcemap = convert.fromSource(entry.source)?.sourcemap;

    if (sourcemap)
      return sourcemap;
  }
  catch
  {
    // don't freakout
  }

  // download [file].map if found

  try
  {
    const fetch = await import('node-fetch');

    const response = await fetch.default(`${entry.url}.map`);

    if (response.status !== 200)
      throw new Error();

    const buffer = Buffer.from(await response.arrayBuffer());

    sourcemap = JSON.parse(buffer.toString('utf-8'));

    if (sourcemap)
      return sourcemap;
  }
  catch
  {
    // don't freakout
  }
}
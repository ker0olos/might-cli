/* eslint-disable security/detect-object-injection */

import v8toIstanbul from 'v8-to-istanbul';

import { createContext } from 'istanbul-lib-report';

import { createCoverageMap } from 'istanbul-lib-coverage';

import type { FileCoverage, FileCoverageData } from 'istanbul-lib-coverage';

import reports from 'istanbul-reports';

import { join } from 'path';

import fetch from 'node-fetch';

import { outputFile } from 'fs-extra';

import { SourceMapConsumer, RawSourceMap } from 'source-map';

import convert from 'convert-source-map';

import { any as isMatch } from 'nanomatch';

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

export async function coverage(coverageCollection: CoverageEntry[], dir: string, exclude: string[]): Promise<number>
{
  const mainMap = createCoverageMap();

  const processed: Record<string, ReturnType<typeof v8toIstanbul>> = {};

  for (const entry of coverageCollection)
  {
    // since this object is sent by chromium
    // its a full url, we only want the path name
    const entryPath = new URL(entry.url).pathname;

    // match path with excluded globs
    if (!entryPath.length || isMatch(entryPath.replace('\\', ''), exclude, undefined))
      continue;
    
    if (!processed[entryPath])
    {
      const sourcemap = await getSourcemap(entry);

      if (sourcemap)
      {
        const consumer = await SourceMapConsumer.with(sourcemap, undefined, c => c);
  
        // unpack source-map files
        await Promise.all(consumer.sources
          .map((path, id) =>
          {
            let relative = path;
  
            // ignore protocols
            if (path.indexOf('://') >= 0)
              relative = path.split('://')[1];
  
            // match path with excluded globs
            if (isMatch(relative.replace('\\', ''), exclude, undefined))
              return;
  
            // save to disk
            // those files are used while istanbul is generating reports
            // and get cleaned up after
            return outputFile(join(dir, relative), sourcemap?.sourcesContent?.[id]).catch(() => undefined);
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
      // match path with excluded globs
      if (!key.length || isMatch(key.replace('\\', ''), exclude, undefined))
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

  return mainMap.getCoverageSummary().lines.pct;
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
    const response = await fetch(`${entry.url}.map`);

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
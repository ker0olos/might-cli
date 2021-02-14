import jimp from 'jimp';

import looksSame from 'looks-same';

export async function difference(reference: jimp, current: jimp, tolerance: number, antialiasingTolerance: number): Promise<{ same: boolean, differences?: number, diffImage?: Promise<Buffer> }>
{
  const opts = {
    tolerance,
    strict: false,

    ignoreCaret: true,
    ignoreAntialiasing: true,
    antialiasingTolerance
  };

  const ref = await reference.getBufferAsync(jimp.MIME_PNG);
  const cur = await current.getBufferAsync(jimp.MIME_PNG);

  return new Promise((resolve, reject) =>
  {
    looksSame(ref, cur, opts, (err, result) =>
    {
      if (err)
      {
        reject(err);

        return;
      }

      if (!result.equal)
      {
        looksSame.createDiff({
          current: cur,
          reference: ref,
          highlightColor: '#FF00FF',
          ...opts
        }, (err, buffer) =>
        {
          if (err)
          {
            reject(err);
    
            return;
          }

          resolve({
            same: false,
            differences: 1,
            diffImage: detailedDifference(reference, current, buffer)
          });
        });
      }
      else
      {
        resolve({
          same: true
        });
      }
    });
  });
}

async function detailedDifference(reference: jimp, current: jimp, diffBuffer: Buffer)
{
  const width = reference.getWidth();
  const height = reference.getHeight();

  const margin = Math.min(50, width * 0.15);

  const diff = await jimp.read(diffBuffer);

  const halfReference = reference.clone();
  
  const final = await jimp.create((width * 2) + margin, (height * 2) + margin);
  
  final.composite(current, 0, 0);
  final.composite(reference, width + margin, 0);

  halfReference.opacity(0.35);

  final.composite(current, 0, height + margin);
  final.composite(halfReference, 0, height + margin);
  
  final.composite(diff, width + margin, height + margin);

  return final.getBufferAsync(jimp.MIME_PNG);
}
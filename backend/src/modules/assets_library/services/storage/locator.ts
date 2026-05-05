// Pure helper: shard the asset UUID into a directory path of the form
// `<aa>/<bb>/<assetId>.<ext>` so neither the local-FS leaf directories nor
// the cloud bucket key space ever bunches up. See research.md R5.

import { extname } from 'node:path';

export function computeLocator(input: { assetId: string; originalFilename: string }): string {
  const id = input.assetId.toLowerCase();
  if (id.length < 4) {
    throw new Error(`computeLocator: assetId too short ("${input.assetId}")`);
  }
  const aa = id.slice(0, 2);
  const bb = id.slice(2, 4);
  const rawExt = extname(input.originalFilename).slice(1);
  const ext = rawExt.length > 0 ? rawExt : 'bin';
  return `${aa}/${bb}/${id}.${ext}`;
}

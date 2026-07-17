/** Collect asset UUIDs from Puck tree props (any key ending with `assetId`). */
export function walkAssetIds(tree: unknown, acc: Set<string> = new Set()): Set<string> {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkAssetIds(item, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && /assetId$/i.test(key) && val.length > 0) {
      acc.add(val);
    } else {
      walkAssetIds(val, acc);
    }
  }
  return acc;
}

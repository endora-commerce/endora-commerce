// Content tree walker — feature 014 / T024.
//
// Walks a Puck-shaped JSON tree and yields:
//   - every `assetId` value found anywhere on `props` (case-insensitive
//     match on the suffix `assetId` so `iconAssetId`, `mainImageAssetId`,
//     etc. are caught too).
//   - every `code` referenced by an `InsertBlock` or `InsertTemplate` node.
//   - every component `type` not in a known-names set.
//
// Used by:
//   - the AssetReferenceRegistry's CMS descriptor (asset deletion blocked
//     when an asset is referenced inside content).
//   - the CmsReferenceRegistry (block / template deletion blocked when
//     embedded).
//   - the storefront-resolver (collects every embed code in one walk so
//     the resolver can batch-fetch).
//   - the admin's "missing component" warning surface.

export type AssetIdSet = Set<string>;
export type CodeSet = Set<string>;

export function walkAssetIds(tree: unknown, acc: AssetIdSet = new Set()): AssetIdSet {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkAssetIds(item, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && /assetId$/i.test(key)) {
      if (val.length > 0) acc.add(val);
    } else {
      walkAssetIds(val, acc);
    }
  }
  return acc;
}

export function walkBlockEmbeds(tree: unknown, acc: CodeSet = new Set()): CodeSet {
  return walkEmbedsByType(tree, 'cms.InsertBlock', acc);
}

export function walkTemplateEmbeds(tree: unknown, acc: CodeSet = new Set()): CodeSet {
  return walkEmbedsByType(tree, 'cms.InsertTemplate', acc);
}

function walkEmbedsByType(tree: unknown, typeName: string, acc: CodeSet): CodeSet {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkEmbedsByType(item, typeName, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  if (obj['type'] === typeName) {
    const props = obj['props'];
    if (props && typeof props === 'object' && typeof (props as Record<string, unknown>)['code'] === 'string') {
      const code = (props as Record<string, unknown>)['code'] as string;
      if (code.length > 0) acc.add(code);
    }
  }
  for (const v of Object.values(obj)) walkEmbedsByType(v, typeName, acc);
  return acc;
}

export function walkUnknownComponents(tree: unknown, knownNames: Set<string>, acc: Set<string> = new Set()): Set<string> {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkUnknownComponents(item, knownNames, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  if (typeof obj['type'] === 'string' && obj['props'] && typeof obj['props'] === 'object') {
    const t = obj['type'];
    if (!knownNames.has(t)) acc.add(t);
  }
  for (const v of Object.values(obj)) walkUnknownComponents(v, knownNames, acc);
  return acc;
}

import { dirname } from 'node:path';
import { parseBundleKeywords, type SupportedAdminLanguage } from '@endora-commerce/contracts';
import { loadModuleBundles } from '@endora-commerce/mod-i18n/backend';
import { REGISTERED_MANIFESTS } from '../../src/lifecycle/registered-manifests.js';

/**
 * The search words the palette serves for one registered action in
 * `language`: the manifest's English `keywords`, followed by the words its
 * `keywordsKey` resolves to in that language's bundle — the composition
 * `AdminActionsService.keywordsOf` performs (issues #560, #573).
 *
 * For a test that pins "an operator's ⌘K answer for *kanał* is what it was"
 * now that a Polish word lives in `pl.json` rather than in the manifest. It
 * reads the shipped files, so it drifts with the declaration, not away from it.
 */
export function servedPaletteKeywords(
  moduleId: string,
  actionId: string,
  language: SupportedAdminLanguage,
): string[] {
  const entry = REGISTERED_MANIFESTS.find((candidate) => candidate.manifest.id === moduleId);
  const action = (entry?.manifest.actions ?? []).find((candidate) => candidate.id === actionId);
  if (!entry || !action) return [];
  const declared = [...(action.keywords ?? [])];
  if (!action.keywordsKey || !entry.manifest.i18n) return declared;
  const bundle = loadModuleBundles(
    moduleId,
    dirname(entry.filePath),
    entry.manifest.i18n.bundlesDir,
  ).byLanguage.get(language);
  const value = bundle?.[action.keywordsKey];
  return [...new Set([...declared, ...(value === undefined ? [] : parseBundleKeywords(value))])];
}

import { LANGUAGE_FALLBACK, type ModuleListItem, type SupportedLanguage } from '@endora-commerce/contracts';

/**
 * Looks a key up in a module's own bundle: the requested language, then
 * English, then the `<moduleId>.<key>` placeholder — `AdminI18nTranslatePort`'s
 * contract, which `backend.ts` binds this to.
 */
export type ModuleBundleTranslate = (moduleId: string, key: string, language: SupportedLanguage) => Promise<string>;

/**
 * Where a module keeps the translation of each of its manifest's sentences
 * (issue #1809). The English stays the manifest's: the bundle's `en` entry
 * mirrors it, and `backend/test/unit/_i18n/manifest-prose-bundles.test.ts`
 * holds the two equal.
 */
export const MODULE_TEXT_KEYS = {
  name: 'module.name',
  description: 'module.description',
  nonDeactivatableReason: 'module.nonDeactivatableReason',
} as const;

async function translated(
  translate: ModuleBundleTranslate,
  moduleId: string,
  key: string,
  declared: string,
  language: SupportedLanguage,
): Promise<string> {
  try {
    const text = await translate(moduleId, key, language);
    return text === `${moduleId}.${key}` || text === key || text === '' ? declared : text;
  } catch {
    return declared;
  }
}

/**
 * One row of `GET /api/v1/admin/modules` in the reader's language (issue #1809).
 *
 * A module's name, description and lock reason are platform prose its manifest
 * declares, and the reader of this response has a language the backend
 * resolves, so the backend translates them and the id stays on the wire beside
 * them (`specs/conventions/module-i18n.md`, case 1). The route is ungated, so
 * this must answer when `_i18n` does not: English, no resolver, a missing key
 * and a refusing resolver all answer the manifest's English.
 */
export async function localizeModuleListItem(
  item: ModuleListItem,
  language: SupportedLanguage,
  translate: ModuleBundleTranslate | undefined,
): Promise<ModuleListItem> {
  if (!translate || language === LANGUAGE_FALLBACK) return item;
  const reason = item.nonDeactivatableReason ?? null;
  return {
    ...item,
    name: await translated(translate, item.id, MODULE_TEXT_KEYS.name, item.name, language),
    description:
      item.description === null
        ? null
        : await translated(translate, item.id, MODULE_TEXT_KEYS.description, item.description, language),
    ...(reason === null
      ? {}
      : {
          nonDeactivatableReason: await translated(
            translate,
            item.id,
            MODULE_TEXT_KEYS.nonDeactivatableReason,
            reason,
            language,
          ),
        }),
  };
}

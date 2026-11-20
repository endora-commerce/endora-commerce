import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UX audit 2026-11-17, the CONTENT and SHELL parts of the DS-02 text pass
 * (issue #1436, `ux-audit-content.md` *Text to cut* and `ux-audit-shell.md` §5):
 * the CMS editors, brand, forms, megamenu, blog editors, document templates,
 * comparisons and ad-mapping screens, and the settings, modules, command hooks,
 * API description, users, roles, API keys, webhooks, taxes, audit log,
 * credentials and global-search screens lost the page descriptions that
 * restated their title or spoke the implementation ("Bearer tokens",
 * "HMAC-signed", "Append-only", "Tree node + per-language metadata"). The few
 * kept say something the screen does not show, on one clamped line
 * (`specs/conventions/module-i18n.md`); the longer explanations that matter
 * moved to `help`, a ⓘ beside the title.
 *
 * Pinned per bundle and per language: a cut key stays cut, in the bundle and in
 * the sources that read it; a kept or shortened line fits its budget.
 */
const ONE_LINE = 80;
/** `help`'s budget (architect ruling for #1451). */
const HELP = 280;

const LANGUAGES = ['en', 'pl'] as const;

interface Cut {
  /** The package under `packages/modules/` whose `i18n/` holds the key. `_i18n` is the shared `core` bundle. */
  bundle: string;
  key: string;
  /** The source directory, relative to `packages/`, that must no longer read it. */
  reader: string;
}

const CMS = 'modules/cms/src/admin';
const BLOG = 'modules/blog/src/admin';
const FORMS = 'modules/forms/src/admin';
const SHELL = 'admin-shell/src';
const SETTINGS = 'modules/settings/src/admin';
const ADMIN_USERS = 'modules/admin_users/src/admin';
const ADMIN_SEARCH = 'modules/admin_search/src/admin';

const CUT: readonly Cut[] = [
  // CONTENT
  { bundle: 'cms', key: 'pageEditor.description', reader: CMS },
  { bundle: 'cms', key: 'blockEditor.description', reader: CMS },
  { bundle: 'cms', key: 'templateEditor.description', reader: CMS },
  { bundle: 'cms', key: 'brand.description', reader: CMS },
  { bundle: 'cms', key: 'brand.schemes.hint', reader: CMS },
  { bundle: 'cms', key: 'brand.spacing.hint', reader: CMS },
  { bundle: 'cms', key: 'brand.preview.hint', reader: CMS },
  { bundle: 'cms', key: 'brand.layout.tierHint', reader: CMS },
  { bundle: 'blog', key: 'postEditor.description.edit', reader: BLOG },
  { bundle: 'blog', key: 'categoryEditor.description.default', reader: BLOG },
  { bundle: 'forms', key: 'list.description', reader: FORMS },
  { bundle: 'forms', key: 'create.description', reader: FORMS },
  { bundle: 'forms', key: 'entries.description', reader: FORMS },
  { bundle: 'megamenu', key: 'editor.description', reader: 'modules/megamenu/src/admin' },
  { bundle: 'comparisons', key: 'list.page.description', reader: 'modules/comparisons/src/admin' },
  { bundle: 'comparisons', key: 'detail.page.description', reader: 'modules/comparisons/src/admin' },
  // SHELL
  { bundle: '_i18n', key: 'platform.modules.description', reader: SHELL },
  { bundle: '_i18n', key: 'platform.modules.cliHint', reader: SHELL },
  { bundle: '_i18n', key: 'platform.commandHooks.description', reader: SHELL },
  { bundle: '_i18n', key: 'platform.apiDescription.description', reader: SHELL },
  { bundle: '_i18n', key: 'home.stockAlerts.subtitle', reader: SHELL },
  { bundle: 'settings', key: 'page.description', reader: SETTINGS },
  { bundle: 'settings', key: 'groups.page.description', reader: SETTINGS },
  { bundle: 'settings', key: 'cache.page.description', reader: SETTINGS },
  { bundle: '_i18n', key: 'adminUsers.page.descriptionPrefix', reader: ADMIN_USERS },
  { bundle: '_i18n', key: 'adminUsers.rolesLink', reader: ADMIN_USERS },
  { bundle: '_i18n', key: 'adminRoles.page.descriptionPrefix', reader: ADMIN_USERS },
  { bundle: '_i18n', key: 'adminRoles.usersLink', reader: ADMIN_USERS },
  { bundle: '_i18n', key: 'apiKeys.page.description', reader: 'modules/api_keys/src/admin' },
  { bundle: '_i18n', key: 'webhooks.page.description', reader: 'modules/webhooks/src/admin' },
  { bundle: '_i18n', key: 'taxes.page.description', reader: 'modules/taxes/src/admin' },
  { bundle: '_i18n', key: 'auditLog.page.description', reader: 'modules/audit_logs/src/admin' },
  { bundle: 'credentials', key: 'page.subtitle', reader: 'modules/credentials/src/admin' },
  { bundle: 'admin_search', key: 'page.configuration.description', reader: ADMIN_SEARCH },
  { bundle: 'admin_search', key: 'page.results.description', reader: ADMIN_SEARCH },
];

/** Kept on screen as a description or a hint, so each must fit the one clamped line. */
const ONE_LINERS: readonly { bundle: string; key: string }[] = [
  { bundle: 'cms', key: 'brand.scope.globalHint' },
  { bundle: 'cms', key: 'brand.layout.scaleHint' },
  { bundle: 'cms', key: 'pageEditor.pageFieldsHelp' },
  { bundle: 'cms', key: 'pageEditor.languageVersion.help' },
  { bundle: 'cms', key: 'pageEditor.breadcrumbs.parentHelp' },
  { bundle: 'cms', key: 'pageEditor.parentPathInUrlHelp' },
  { bundle: 'cms', key: 'pageEditor.breadcrumbs.overlayHelp' },
  { bundle: 'cms', key: 'pageEditor.share.help' },
  { bundle: 'blog', key: 'addresses.description' },
  { bundle: 'blog', key: 'postEditor.description.new' },
  { bundle: 'blog', key: 'categoryEditor.description.new' },
  { bundle: 'blog', key: 'categoryEditor.description.system' },
  { bundle: 'forms', key: 'inspector.shareHint' },
  { bundle: 'megamenu', key: 'itemConfig.clickNavigatesHelp' },
  { bundle: 'megamenu', key: 'list.activeRule' },
  { bundle: 'transactional_emails', key: 'branding.description' },
  { bundle: 'document_templates', key: 'page.description' },
  { bundle: 'meta_ads', key: 'customEvents.subtitle' },
  { bundle: 'linkedin_ads', key: 'mappings.subtitle' },
  { bundle: 'settings', key: 'cache.i18n.description' },
  { bundle: 'settings', key: 'search.reindex.description' },
  { bundle: '_i18n', key: 'platform.apiDescription.reference.body' },
  { bundle: '_i18n', key: 'adminUsers.resetPassword.hint' },
  { bundle: 'admin_search', key: 'page.configuration.settingsNote' },
  { bundle: 'mfa', key: 'security.page.description' },
];

/** The longer explanations, moved behind a `help` ⓘ. */
const HELPS: readonly { bundle: string; key: string }[] = [
  { bundle: '_i18n', key: 'platform.modules.help' },
  { bundle: 'document_templates', key: 'page.help' },
  { bundle: 'meta_ads', key: 'customEvents.help' },
];

const packagesRoot = resolve(process.cwd(), '../packages');
const modulesRoot = join(packagesRoot, 'modules');

function bundle(name: string, language: (typeof LANGUAGES)[number]): Record<string, string> {
  return JSON.parse(readFileSync(join(modulesRoot, name, 'i18n', `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(packagesRoot, dir));
  return out;
}

function overBudget(
  entries: readonly { bundle: string; key: string }[],
  language: (typeof LANGUAGES)[number],
  budget: number,
): { key: string; length: number }[] {
  return entries
    .map(({ bundle: name, key }) => ({
      key: `${name}:${key}`,
      length: bundle(name, language)[key]?.length ?? Number.NaN,
    }))
    .filter(({ length }) => !(length <= budget));
}

describe('CONTENT and SHELL page copy (UX audit DS-02, #1436)', () => {
  it.each(LANGUAGES)('keeps every cut description out of the %s bundles', (language) => {
    const left = CUT.filter(({ bundle: name, key }) => key in bundle(name, language)).map(
      ({ bundle: name, key }) => `${name}:${key}`,
    );
    expect(left).toEqual([]);
  });

  it('leaves no source reading a cut key', () => {
    const readers = CUT.flatMap(({ key, reader }) =>
      sources(reader)
        .filter((file) => readFileSync(file, 'utf8').includes(`'${key}'`))
        .map((file) => `${key} ← ${file.slice(packagesRoot.length + 1)}`),
    );
    expect(readers).toEqual([]);
  });

  it.each(LANGUAGES)('fits every kept %s line in the one-line budget', (language) => {
    expect(overBudget(ONE_LINERS, language, ONE_LINE)).toEqual([]);
  });

  it.each(LANGUAGES)('fits every %s help text in the help budget', (language) => {
    expect(overBudget(HELPS, language, HELP)).toEqual([]);
  });
});

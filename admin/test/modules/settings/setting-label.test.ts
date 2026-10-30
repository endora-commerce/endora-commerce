import { describe, expect, it } from 'vitest';
// Reached at its source, for the reason `../admin_users/permission-label.test.ts`
// gives: the helper is not on the package's `./admin` subpath and must not be,
// and it is a pure function over its arguments.
import {
  resolveSettingDescription,
  resolveSettingGroupName,
  resolveSettingName,
  settingDescriptionKey,
  settingGroupNameKey,
  settingNameKey,
} from '../../../../packages/modules/settings/src/admin/components/setting-label';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * A setting's name and description, written in the owning module's own bundle,
 * have to render on the generic Settings screen.
 *
 * Every fixture below is a merged bundle — `namespace → flat entries` — which
 * is what the provider holds. The namespace is the owning module's id: the
 * bundle endpoint serves a module's `i18n/<language>.json` under its manifest
 * id, and `SettingDto.ownerModule` is that same id for every module that
 * declares a setting. The key embeds the setting code whole, dots included.
 */
describe('setting label resolution', () => {
  const SETTING = {
    code: 'seo.default_robots',
    ownerModule: 'seo',
    name: 'Default robots',
    description: 'What search engines are told about every page.',
  };
  const GROUP = { code: 'seo', ownerModule: 'seo', name: 'SEO' };

  const NAME_KEY = 'settingLabels.seo.default_robots.name';
  const DESCRIPTION_KEY = 'settingLabels.seo.default_robots.description';
  const GROUP_KEY = 'settingGroups.seo.name';

  it('builds the keys a module author writes', () => {
    expect(settingNameKey('seo.default_robots')).toBe(NAME_KEY);
    expect(settingDescriptionKey('seo.default_robots')).toBe(DESCRIPTION_KEY);
    expect(settingGroupNameKey('seo')).toBe(GROUP_KEY);
  });

  describe('name', () => {
    it("takes the administrator's language from the owner's namespace", () => {
      const bundle: Bundle = { seo: { [NAME_KEY]: 'Domyślne dyrektywy robots' } };
      const fallbackBundle: Bundle = { seo: { [NAME_KEY]: 'Default robots (bundle)' } };
      expect(resolveSettingName(SETTING, { language: 'pl', bundle, fallbackBundle })).toBe(
        'Domyślne dyrektywy robots',
      );
    });

    it('falls back to English when only the English bundle carries the key', () => {
      expect(
        resolveSettingName(SETTING, {
          language: 'pl',
          bundle: { seo: {} },
          fallbackBundle: { seo: { [NAME_KEY]: 'Default robots (bundle)' } },
        }),
      ).toBe('Default robots (bundle)');
    });

    it('falls back to the declared name when neither bundle carries the key', () => {
      expect(
        resolveSettingName(SETTING, {
          language: 'pl',
          bundle: { seo: { 'nav.seo.label': 'SEO' } },
          fallbackBundle: { seo: { 'nav.seo.label': 'SEO' } },
        }),
      ).toBe('Default robots');
    });

    it('falls back to the declared name when the owner ships no bundle at all', () => {
      expect(resolveSettingName(SETTING, { language: 'en', bundle: {} })).toBe('Default robots');
    });

    it('falls back to the declared name while the English bundle is still loading', () => {
      // The provider sets the requested bundle before the English one arrives;
      // for that round-trip the resolver reports a placeholder.
      expect(resolveSettingName(SETTING, { language: 'pl', bundle: { seo: {} } })).toBe(
        'Default robots',
      );
    });

    it('never renders the raw key', () => {
      const name = resolveSettingName(SETTING, { language: 'pl', bundle: {} });
      expect(name).not.toContain('settingLabels.');
    });

    it("reads the owner's namespace only — another module cannot rename the setting", () => {
      const bundle: Bundle = { blog: { [NAME_KEY]: 'hijacked' } };
      expect(resolveSettingName(SETTING, { language: 'en', bundle })).toBe('Default robots');
    });

    it('does not interpolate: braces in a translated label are literal', () => {
      const bundle: Bundle = { seo: { [NAME_KEY]: 'Pattern {year}/{seq}' } };
      expect(resolveSettingName(SETTING, { language: 'en', bundle })).toBe('Pattern {year}/{seq}');
    });
  });

  describe('description', () => {
    it("takes the administrator's language", () => {
      const bundle: Bundle = { seo: { [DESCRIPTION_KEY]: 'Co widzą wyszukiwarki.' } };
      expect(resolveSettingDescription(SETTING, { language: 'pl', bundle })).toBe(
        'Co widzą wyszukiwarki.',
      );
    });

    it('falls back to English, then to the declared description', () => {
      const fallbackBundle: Bundle = { seo: { [DESCRIPTION_KEY]: 'English bundle copy.' } };
      expect(
        resolveSettingDescription(SETTING, { language: 'pl', bundle: {}, fallbackBundle }),
      ).toBe('English bundle copy.');
      expect(resolveSettingDescription(SETTING, { language: 'pl', bundle: {} })).toBe(
        'What search engines are told about every page.',
      );
    });

    it('keeps a null description null when no bundle carries the key', () => {
      const bare = { ...SETTING, description: null };
      expect(
        resolveSettingDescription(bare, {
          language: 'pl',
          bundle: { seo: { [NAME_KEY]: 'Domyślne dyrektywy robots' } },
          fallbackBundle: { seo: { [NAME_KEY]: 'Default robots' } },
        }),
      ).toBeNull();
    });
  });

  describe('group name', () => {
    it("takes the administrator's language, then English, then the declared name", () => {
      expect(
        resolveSettingGroupName(GROUP, {
          language: 'pl',
          bundle: { seo: { [GROUP_KEY]: 'Pozycjonowanie' } },
        }),
      ).toBe('Pozycjonowanie');
      expect(
        resolveSettingGroupName(GROUP, {
          language: 'pl',
          bundle: {},
          fallbackBundle: { seo: { [GROUP_KEY]: 'Search engines' } },
        }),
      ).toBe('Search engines');
      expect(resolveSettingGroupName(GROUP, { language: 'pl', bundle: {} })).toBe('SEO');
    });

    it('leaves an operator-created group alone — its owner is not a module', () => {
      const manual = { code: 'my_group', ownerModule: 'manual', name: 'My group' };
      expect(
        resolveSettingGroupName(manual, {
          language: 'pl',
          bundle: { seo: { 'settingGroups.my_group.name': 'not mine' } },
        }),
      ).toBe('My group');
    });
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBundleKeywords } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

/**
 * What `cms` declares for the command palette (Principle XVI).
 *
 * Under `backend/` rather than beside `manifest.ts`: only the manifest is
 * published at the package's root subpath, and `manifests:generate` refuses a
 * sibling file there.
 */
const LANGUAGES = ['en', 'pl'] as const;

function bundle(language: (typeof LANGUAGES)[number]): Record<string, string> {
  return JSON.parse(
    readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
}

/**
 * Issue #573 — the Polish search words of an action, which live in `pl.json`
 * under its `keywordsKey` rather than in the manifest's English `keywords`.
 */
function polishKeywords(actionId: string): string[] {
  const key = (manifest.actions ?? []).find((a) => a.id === actionId)?.keywordsKey;
  return parseBundleKeywords(key ? (bundle('pl')[key] ?? '') : '');
}

const NAVIGATION_ENTRIES = [
  {
    id: 'open-pages',
    targetRoute: '/cms/pages',
    icon: 'Newspaper',
    weight: 131,
    key: 'openPages',
    en: 'CMS Pages',
    pl: 'Strony CMS',
    keywords: ['pages'],
    polish: ['strony'],
  },
  {
    id: 'open-blocks',
    targetRoute: '/cms/blocks',
    icon: 'Newspaper',
    weight: 132,
    key: 'openBlocks',
    en: 'CMS Blocks',
    pl: 'Bloki CMS',
    keywords: ['blocks'],
    polish: ['bloki'],
  },
  {
    id: 'open-templates',
    targetRoute: '/cms/templates',
    icon: 'Newspaper',
    weight: 133,
    key: 'openTemplates',
    en: 'CMS Templates',
    pl: 'Szablony CMS',
    keywords: ['templates'],
    polish: ['szablony'],
  },
  {
    id: 'open-hooks',
    targetRoute: '/cms/hooks',
    icon: 'Webhook',
    weight: 134,
    key: 'openHooks',
    en: 'CMS Hooks',
    pl: 'Hooki CMS',
    keywords: ['hooks'],
    polish: ['hooki'],
  },
] as const;

describe('cms manifest — command palette', () => {
  const actions = manifest.actions ?? [];

  it('keeps the new-page shortcut exactly as it was', () => {
    expect(actions.find((a) => a.id === 'new-page')).toEqual({
      id: 'new-page',
      labelKey: 'actions.newPage.label',
      descriptionKey: 'actions.newPage.description',
      icon: 'FileText',
      targetRoute: '/cms/pages/new',
      requiredPermission: 'cms.write',
      keywords: ['page', 'new', 'create'],
      keywordsKey: 'actions.newPage.keywords',
      weight: 130,
    });
    expect(polishKeywords('new-page')).toEqual(['strona', 'nowa', 'utwórz']);
  });

  it('declares one navigation entry per list screen, right after new-page', () => {
    expect(actions.map((a) => a.id)).toEqual([
      'new-page',
      ...NAVIGATION_ENTRIES.map((e) => e.id),
      // Feature 151 — the translation settings entry.
      'open-page-builder-translation-settings',
      // Feature 163 — the brand screen.
      'open-cms-brand',
      // Feature 169 (T096, deliberately changed) — the contact form's recipients close the list.
      'open-contact-form-settings',
    ]);
  });

  it('opens the brand screen under the read code, found by English and Polish words', () => {
    expect(actions.find((a) => a.id === 'open-cms-brand')).toMatchObject({
      targetRoute: '/cms/brand',
      requiredPermission: 'cms.read',
      icon: 'Layers',
      weight: 136,
      labelKey: 'actions.openCmsBrand.label',
      descriptionKey: 'actions.openCmsBrand.description',
      keywords: expect.arrayContaining(['brand', 'fonts', 'colours', 'colors', 'typography', 'theme']),
    });
    expect(polishKeywords('open-cms-brand')).toContain('marka');
    for (const language of LANGUAGES) {
      const messages = bundle(language);
      expect(messages['actions.openCmsBrand.label']).toMatch(/\S/);
      expect(messages['actions.openCmsBrand.description']).toMatch(/\S/);
    }
  });

  for (const entry of NAVIGATION_ENTRIES) {
    describe(entry.id, () => {
      const action = actions.find((a) => a.id === entry.id);

      it('opens its list screen under the read code that screen enforces', () => {
        expect(action).toMatchObject({
          targetRoute: entry.targetRoute,
          requiredPermission: 'cms.read',
          icon: entry.icon,
          weight: entry.weight,
          labelKey: `actions.${entry.key}.label`,
          descriptionKey: `actions.${entry.key}.description`,
        });
      });

      it('is found by an English and a Polish word', () => {
        expect(action?.keywords).toEqual(expect.arrayContaining(['cms', ...entry.keywords]));
        expect(polishKeywords(entry.id)).toEqual(expect.arrayContaining([...entry.polish]));
      });

      it('has a label matching the sidebar and a description in both languages', () => {
        for (const language of LANGUAGES) {
          const messages = bundle(language);
          expect(messages[`actions.${entry.key}.label`]).toBe(entry[language]);
          expect(messages[`actions.${entry.key}.description`]).toMatch(/\S/);
        }
      });
    });
  }
});

/** Feature 151 — the Page Builder translation's manifest surface. */
describe('cms manifest — Page Builder translation', () => {
  const settings = manifest.settings?.settings ?? [];
  const setting = (code: string) => settings.find((s) => s.code === code);

  it('declares the three translation settings in the Page Builder group', () => {
    expect(setting('cms.page_builder.translation.enabled')).toMatchObject({
      groupCode: 'cms_page_builder',
      valueType: 'boolean',
      defaultValue: false,
    });
    expect(setting('cms.page_builder.translation.llm_credentials')).toMatchObject({
      groupCode: 'cms_page_builder',
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
    });
    expect(setting('cms.page_builder.translation.max_source_characters')).toMatchObject({
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: 40000,
    });
  });

  it('names and describes each setting in English and Polish, saying content leaves the platform', () => {
    for (const language of LANGUAGES) {
      const messages = bundle(language);
      for (const code of [
        'cms.page_builder.translation.enabled',
        'cms.page_builder.translation.llm_credentials',
        'cms.page_builder.translation.max_source_characters',
      ]) {
        expect(messages[`settingLabels.${code}.name`], `${language} ${code}`).toMatch(/\S/);
        expect(messages[`settingLabels.${code}.description`], `${language} ${code}`).toMatch(/\S/);
      }
    }
    expect(setting('cms.page_builder.translation.enabled')!.description).toMatch(/sent to the provider/);
  });

  it('declares the permission, labelled in both languages', () => {
    expect(manifest.permissions).toContainEqual({
      code: 'cms.translate',
      label: 'Translate Page Builder content with AI',
    });
    for (const language of LANGUAGES) {
      expect(bundle(language)['adminRoles.permission.cms.translate']).toMatch(/\S/);
    }
  });

  it('degrades without credentials instead of depending on it', () => {
    expect(manifest.dependencies).not.toContain('credentials');
    expect(manifest.nonBindingDependencies).toContainEqual(
      expect.objectContaining({ moduleId: 'credentials', name: 'credentialsService', kind: 'degrades-without' }),
    );
  });

  it('declares its error codes, with the provider-failure tokens, translated in both languages', () => {
    const codes = manifest.errorCodes ?? [];
    expect(codes).toContainEqual({
      code: 'CMS_TRANSLATION_PROVIDER_FAILED',
      tokens: ['credentials_rejected', 'rate_limited', 'unavailable', 'timeout', 'malformed'],
    });
    for (const code of [
      'CMS_TRANSLATION_DISABLED',
      'CMS_TRANSLATION_NOT_CONFIGURED',
      'CMS_TRANSLATION_UNAVAILABLE',
      'CMS_TRANSLATION_TOO_LARGE',
      'CMS_TRANSLATION_SELECTION_NOT_FOUND',
    ]) {
      expect(codes).toContainEqual({ code });
      for (const language of LANGUAGES) expect(bundle(language)[`errors.${code}`]).toMatch(/\S/);
    }
    for (const language of LANGUAGES) expect(bundle(language)['errors.CMS_TRANSLATION_TOO_LARGE']).toContain('{limit}');
  });

  it('offers a palette entry to the translation settings, findable in English and Polish', () => {
    const action = (manifest.actions ?? []).find((a) => a.id === 'open-page-builder-translation-settings');
    expect(action).toMatchObject({
      targetRoute: '/settings',
      requiredPermission: 'settings:read',
      icon: 'Sparkles',
      labelKey: 'actions.openPageBuilderTranslationSettings.label',
      descriptionKey: 'actions.openPageBuilderTranslationSettings.description',
    });
    expect(action!.keywords).toEqual(expect.arrayContaining(['translate', 'ai', 'page builder']));
    expect(polishKeywords('open-page-builder-translation-settings')).toContain('tłumacz');
    for (const language of LANGUAGES) {
      expect(bundle(language)['actions.openPageBuilderTranslationSettings.label']).toMatch(/\S/);
    }
  });
});

/** Feature 169 — the contact form's manifest surface (`specs/169-page-builder-contact-form/` T096). */
describe('cms manifest — contact form', () => {
  const settings = manifest.settings?.settings ?? [];

  it('declares the recipients setting per channel in its own group, empty by default and not secret', () => {
    expect(settings.find((s) => s.code === 'cms.contact_form_recipients')).toMatchObject({
      groupCode: 'cms_contact_form',
      valueType: 'string_list',
      defaultValue: [],
    });
    expect(settings.find((s) => s.code === 'cms.contact_form_recipients')).not.toHaveProperty('secret', true);
    expect(manifest.settings?.groups).toContainEqual({ code: 'cms_contact_form', name: 'Contact form' });
    for (const language of LANGUAGES) {
      const messages = bundle(language);
      expect(messages['settingGroups.cms_contact_form.name'], language).toMatch(/\S/);
      expect(messages['settingLabels.cms.contact_form_recipients.name'], language).toMatch(/\S/);
      expect(messages['settingLabels.cms.contact_form_recipients.description'], language).toMatch(/\S/);
    }
  });

  it('declares the unavailable error code, translated in both languages', () => {
    expect(manifest.errorCodes).toContainEqual({ code: 'CMS_CONTACT_FORM_UNAVAILABLE' });
    for (const language of LANGUAGES) expect(bundle(language)['errors.CMS_CONTACT_FORM_UNAVAILABLE']).toMatch(/\S/);
  });

  it('depends on the mailer and the translator, both non-deactivatable', () => {
    expect(manifest.dependencies).toEqual(expect.arrayContaining(['email', '_i18n']));
    expect(manifest.dependencies).not.toContain('newsletter');
  });

  it('offers a palette entry to the Settings screen, findable in English and Polish', () => {
    const action = (manifest.actions ?? []).find((a) => a.id === 'open-contact-form-settings');
    expect(action).toMatchObject({
      targetRoute: '/settings',
      requiredPermission: 'settings:read',
      icon: 'Inbox',
      labelKey: 'actions.openContactFormSettings.label',
      descriptionKey: 'actions.openContactFormSettings.description',
      weight: 137,
    });
    expect(action!.keywords).toEqual(expect.arrayContaining(['contact', 'form', 'recipients']));
    expect(polishKeywords('open-contact-form-settings')).toEqual(expect.arrayContaining(['kontakt', 'formularz']));
    for (const language of LANGUAGES) {
      expect(bundle(language)['actions.openContactFormSettings.label']).toMatch(/\S/);
      expect(bundle(language)['actions.openContactFormSettings.description']).toMatch(/\S/);
    }
  });

  it('declares the cms.ContactForm block in the forms section with its translatable text', () => {
    const block = (manifest.blocks ?? []).find((b) => b.name === 'cms.ContactForm');
    expect(block).toMatchObject({
      category: 'forms',
      contexts: ['cms'],
      labelKey: 'blocks.contactForm.label',
      descriptionKey: 'blocks.contactForm.description',
      responsiveFields: ['margin', 'padding', 'border'],
    });
    const paths = (block?.translatable ?? []).map((entry) => entry.path);
    for (const key of ['name', 'email', 'phone', 'company', 'subject', 'choice', 'message']) {
      expect(paths).toContain(`fields.${key}.label`);
      expect(paths).toContain(`fields.${key}.placeholder`);
    }
    expect(paths).toEqual(
      expect.arrayContaining([
        'fields.choice.options[].label',
        'button.label',
        'messages.success',
        'messages.error',
        'messages.unavailable',
        'formLabel',
      ]),
    );
    expect(block?.translatable).toEqual(
      expect.arrayContaining([
        { path: 'privacyConsent.label', format: 'tiptap' },
        { path: 'marketingConsent.label', format: 'tiptap' },
      ]),
    );
    for (const language of LANGUAGES) expect(bundle(language)['blocks.contactForm.label']).toMatch(/\S/);
  });
});

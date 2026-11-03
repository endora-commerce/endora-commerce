import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

/**
 * `specs/170-forms-module/` T003 — the manifest is the module's declaration to
 * the platform: activation, the lifecycle edges, the admin surfaces, the
 * settings and the Page Builder block. Each case names the contract it holds.
 */
describe('forms manifest', () => {
  it('is an operator-toggleable module, on by default (Principle XVII, R-23)', () => {
    expect(manifest.id).toBe('forms');
    expect(manifest.activation).toEqual({ settingCode: 'forms.enabled', default: true });
  });

  it('binds only the eight non-deactivatable owners it reads (research R-2, T001 a)', () => {
    expect([...(manifest.dependencies ?? [])].sort()).toEqual([
      '_i18n',
      'audit_logs',
      'auth',
      'customer_accounts',
      'dictionaries',
      'email',
      'sales_channels',
      'settings',
    ]);
  });

  it('degrades without cms and contributes to webhooks, binding neither (R-2, FR-002)', () => {
    const edges = manifest.nonBindingDependencies ?? [];
    expect(edges).toHaveLength(2);

    const cms = edges.find((e) => e.moduleId === 'cms');
    expect(cms).toMatchObject({ name: 'cmsPageReadPort', kind: 'degrades-without' });
    expect(cms && 'whenAbsent' in cms ? cms.whenAbsent : '').toMatch(/confirmation message/i);

    const webhooks = edges.find((e) => e.moduleId === 'webhooks');
    expect(webhooks).toMatchObject({ name: 'webhookEventRegistry', kind: 'contributes-to' });
    expect(webhooks && 'whenAbsent' in webhooks ? webhooks.whenAbsent : undefined).toBeUndefined();
  });

  it('declares the five permissions with their requires (contracts/admin-surfaces.md §1)', () => {
    const byCode = new Map((manifest.permissions ?? []).map((p) => [p.code, p]));
    expect([...byCode.keys()].sort()).toEqual([
      'forms:entries_export',
      'forms:entries_read',
      'forms:entries_write',
      'forms:read',
      'forms:write',
    ]);
    expect(byCode.get('forms:read')?.requires ?? []).toEqual([]);
    expect(byCode.get('forms:write')?.requires).toEqual(['forms:read']);
    expect(byCode.get('forms:entries_read')?.requires ?? []).toEqual([]);
    expect(byCode.get('forms:entries_write')?.requires).toEqual(['forms:entries_read']);
    expect(byCode.get('forms:entries_export')?.requires).toEqual(['forms:entries_read']);
    for (const permission of byCode.values()) {
      expect(permission.module).toBe('forms');
      expect(permission.label).not.toBe('');
    }
  });

  it('declares the three palette actions on their codes (contracts/admin-surfaces.md §2)', () => {
    const actions = manifest.actions ?? [];
    expect(actions.map((a) => [a.id, a.targetRoute, a.requiredPermission, a.icon, a.keywordsKey])).toEqual([
      ['open-forms', '/forms', 'forms:read', 'ClipboardList', 'actions.openForms.keywords'],
      ['new-form', '/forms/new', 'forms:write', 'FilePlus', 'actions.newForm.keywords'],
      ['open-form-entries', '/forms/entries', 'forms:entries_read', 'Inbox', 'actions.openFormEntries.keywords'],
    ]);
    expect(actions.map((a) => [a.labelKey, a.descriptionKey])).toEqual([
      ['actions.openForms.label', 'actions.openForms.description'],
      ['actions.newForm.label', 'actions.newForm.description'],
      ['actions.openFormEntries.label', 'actions.openFormEntries.description'],
    ]);
  });

  it('declares the four settings of the forms group, the CAPTCHA secret as a secret (data-model §6)', () => {
    const settings = manifest.settings?.settings ?? [];
    expect(settings.map((s) => s.code)).toEqual([
      'forms.enabled',
      'forms.captcha_provider',
      'forms.captcha_site_key',
      'forms.captcha_secret_key',
    ]);
    for (const setting of settings) expect(setting.groupCode).toBe('forms');
    expect(settings[0]).toMatchObject({ valueType: 'boolean', defaultValue: true });
    expect(settings[1]).toMatchObject({
      valueType: 'string',
      defaultValue: 'none',
      enumOptions: ['none', 'turnstile', 'hcaptcha'],
    });
    expect(settings[2]).toMatchObject({ valueType: 'string', defaultValue: '' });
    expect(settings[3]).toMatchObject({ valueType: 'secret', defaultValue: '' });
  });

  it('declares the forms.Form block and its forms category (contracts/blocks-and-storefront.md §1)', () => {
    expect(manifest.blocks).toEqual([
      {
        name: 'forms.Form',
        labelKey: 'blocks.form.label',
        descriptionKey: 'blocks.form.description',
        category: 'forms',
        contexts: ['cms'],
        translatable: [],
        fields: {},
        responsiveFields: [],
        weight: 1,
      },
    ]);
    expect(manifest.blockCategories).toEqual([
      { key: 'forms', titleKey: 'blocks.category.forms', contexts: ['cms'], weight: 70 },
    ]);
  });

  it('ships its bundles and its documentation directory', () => {
    expect(manifest.i18n).toEqual({ bundlesDir: 'i18n' });
    expect(manifest.docs).toEqual({ dir: 'docs' });
  });
});

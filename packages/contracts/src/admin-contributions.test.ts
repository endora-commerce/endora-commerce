import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AdminZoneContributionSchema,
  AdminZoneNameSchema,
  RECORD_TAB_ZONE_NAMES,
  RecordTabDeclarationSchema,
  isRecordTabZoneName,
  type AdminZoneProps,
  type OpportunityDetailZoneProps,
  type RecordTabZoneName,
  type SettingsSettingAfterZoneProps,
} from './admin-contributions.js';

/**
 * `settings.setting.after` — the place beside one setting on the Settings
 * screen (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md`
 * §2.3).
 *
 * The props are the contract between the `settings` module, which mounts the
 * zone once per row, and whichever module contributes beside a setting it
 * declared. The type-level cases are held by `tsc` when the package is
 * type-checked; the runtime cases are what `check:admin-zones` compares
 * contributions against.
 */
describe('the settings.setting.after zone', () => {
  it('is a declared member of the closed zone enum', () => {
    expect(AdminZoneNameSchema.options).toContain('settings.setting.after');
  });

  it('carries the setting, its owner, the channel being edited and the draft', () => {
    expectTypeOf<AdminZoneProps<'settings.setting.after'>>().toEqualTypeOf<SettingsSettingAfterZoneProps>();
    expectTypeOf<SettingsSettingAfterZoneProps>().toEqualTypeOf<{
      readonly settingCode: string;
      readonly ownerModule: string;
      readonly channelCode: string | null;
      readonly draftText: string | null;
      readonly dirty: boolean;
    }>();
  });

  it('accepts a contribution narrowed to one setting code', () => {
    const parsed = AdminZoneContributionSchema.parse({
      zone: 'settings.setting.after',
      weight: 0,
      requiredPermission: 'settings:read',
      match: { settingCode: 'seo.robots_txt_custom' },
    });
    expect(parsed.match).toEqual({ settingCode: 'seo.robots_txt_custom' });
  });
});

/**
 * `opportunity.detail.tabs` — the first record-tab zone
 * (`specs/183-record-tab-contributions/contracts/record-tab-zone.md` RT1–RT2,
 * FR-001–FR-003): its contributions are whole tabs of the host's record tab
 * strip, so each carries tab data, and no contribution to any other zone may.
 */
describe('record-tab zones', () => {
  const tab = { id: 'tasks', labelKey: 'recordTab.label', countLabelKey: 'recordTab.countLabel' };

  it('declares opportunity.detail.tabs, and lists it as a record-tab zone', () => {
    expect(AdminZoneNameSchema.options).toContain('opportunity.detail.tabs');
    expect(RECORD_TAB_ZONE_NAMES).toEqual(['opportunity.detail.tabs']);
    for (const name of RECORD_TAB_ZONE_NAMES) expect(AdminZoneNameSchema.options).toContain(name);
    expect(isRecordTabZoneName('opportunity.detail.tabs')).toBe(true);
    expect(isRecordTabZoneName('opportunity.detail.sidebar')).toBe(false);
  });

  it('carries the Opportunity’s id and nothing else', () => {
    expectTypeOf<AdminZoneProps<'opportunity.detail.tabs'>>().toEqualTypeOf<OpportunityDetailZoneProps>();
    expectTypeOf<RecordTabZoneName>().toEqualTypeOf<'opportunity.detail.tabs'>();
  });

  it('requires tab data on a record-tab zone', () => {
    expect(AdminZoneContributionSchema.safeParse({ zone: 'opportunity.detail.tabs', weight: 0 }).success).toBe(false);
    const parsed = AdminZoneContributionSchema.parse({ zone: 'opportunity.detail.tabs', weight: 100, tab });
    expect(parsed.tab).toEqual(tab);
  });

  it('refuses tab data on a stack zone', () => {
    expect(
      AdminZoneContributionSchema.safeParse({ zone: 'opportunity.detail.sidebar', weight: 0, tab }).success,
    ).toBe(false);
    expect(AdminZoneContributionSchema.safeParse({ zone: 'opportunity.detail.sidebar', weight: 0 }).success).toBe(true);
  });

  it('holds the tab id to a lowercase URL token and the keys to module-relative translation keys', () => {
    for (const id of ['tasks', 'a', 'time-log', 'x1']) {
      expect(RecordTabDeclarationSchema.safeParse({ id, labelKey: 'recordTab.label' }).success, id).toBe(true);
    }
    for (const id of ['', 'Tasks', '1tasks', 'tasks tab', 'tasks_tab', 'a'.repeat(33), '-tasks']) {
      expect(RecordTabDeclarationSchema.safeParse({ id, labelKey: 'recordTab.label' }).success, id).toBe(false);
    }
    expect(RecordTabDeclarationSchema.safeParse({ id: 'tasks', labelKey: 'tasks.recordTab.label' }).success).toBe(true);
    expect(RecordTabDeclarationSchema.safeParse({ id: 'tasks', labelKey: 'Record tab' }).success).toBe(false);
    expect(
      RecordTabDeclarationSchema.safeParse({ id: 'tasks', labelKey: 'recordTab.label', countLabelKey: '{label}' }).success,
    ).toBe(false);
  });
});

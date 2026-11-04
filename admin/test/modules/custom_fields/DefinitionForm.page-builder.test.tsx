import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-002, research R-4):
 * the generic custom-field definition form never offers the `page_builder`
 * value type. It is admissible only on product attributes, which the catalogue
 * defines on its own screen; this pins the form's hand-kept type list so a
 * future "offer every type" refactor cannot leak it.
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [] },
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false, carryTargets: [] },
];

const EXISTING: CustomFieldDefinitionDto = {
  id: '00000000-0000-4000-8000-00000000cf72',
  entityType: 'organization',
  key: 'po_number',
  label: {},
  labelDefault: 'PO number',
  valueType: 'text',
  required: false,
  audience: 'customer',
  sortOrder: 0,
  config: {},
  listFilter: false,
  carryTo: [],
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) => (entityType === 'organization' ? [EXISTING] : []),
    get: async () => EXISTING,
    create: async () => ({}),
    update: async () => EXISTING,
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { VALUE_TYPES } = await import(
  '../../../../packages/modules/custom_fields/src/admin/components/DefinitionForm'
);

describe('DefinitionForm — no Page Builder type (feature 172, FR-002)', () => {
  it('keeps page_builder out of the offered value types', () => {
    expect(VALUE_TYPES).not.toContain('page_builder');
  });

  it('offers no Page Builder type in the create dialog, for any record type', async () => {
    renderWithI18n(
      <StrictMode>
        <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
          <CustomFieldsPage />
        </AuthProvider>
      </StrictMode>,
      { custom_fields: en as Record<string, string>, core: coreEn as Record<string, string> },
    );
    await screen.findByText('po_number');
    fireEvent.click(screen.getByRole('button', { name: 'New field' }));
    const dialog = await screen.findByRole('dialog', { name: 'New field' });
    for (const recordType of ['organization', 'order']) {
      fireEvent.change(within(dialog).getByLabelText('Record type'), { target: { value: recordType } });
      const offered = Array.from(
        (within(dialog).getByLabelText('Type') as HTMLSelectElement).options,
        (option) => option.value,
      );
      expect(offered.length).toBeGreaterThan(0);
      expect(offered).not.toContain('page_builder');
      expect(offered.join(' ')).not.toMatch(/page.?builder/i);
    }
  });
});

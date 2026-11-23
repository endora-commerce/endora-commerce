import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderCustomFieldsRoutes } from './routes-harness';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';

/**
 * The page never offers a type before the server says it is offered
 * (`specs/157-custom-fields-list-filters/` FR-005a).
 *
 * A Quote Request type follows `quote_requests`: while that module is off the
 * server leaves it out of `GET …/entity-types`. The list the page renders
 * before that answer arrives must therefore not hold it either — otherwise an
 * operator could pick a type the server would refuse.
 */

type EntityTypeRow = { entityType: string; labelKey: string; listFilter: boolean };

let resolveEntityTypes: (rows: EntityTypeRow[]) => void = () => undefined;
const pendingEntityTypes = new Promise<EntityTypeRow[]>((resolve) => {
  resolveEntityTypes = resolve;
});

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: () => pendingEntityTypes,
    list: async () => [],
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { CustomFieldEditorPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldEditorPage'
);

const BUNDLE = { custom_fields: en };

describe('CustomFieldsPage — the entity types offered before the server answers', () => {
  it('offers no Quote request until entity-types answers with it, and Order throughout', async () => {
    renderCustomFieldsRoutes({ CustomFieldsPage, CustomFieldEditorPage }, { bundle: BUNDLE });
    const select = (await screen.findByLabelText('Record type')) as HTMLSelectElement;
    const offered = () => within(select).getAllByRole('option').map((option) => option.textContent);

    expect(offered()).toContain('Order');
    expect(offered()).not.toContain('Quote request');

    await act(async () => {
      resolveEntityTypes([
        { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true },
        { entityType: 'quote_request', labelKey: 'customFields.entity.quoteRequest', listFilter: true },
      ]);
      await pendingEntityTypes;
    });

    await waitFor(() => expect(offered()).toContain('Quote request'));
    expect(offered()).toContain('Order');
  });
});

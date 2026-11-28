import type { ReactNode } from 'react';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  FulfilmentStrategyPicker,
  type FulfilmentStrategyValue,
  type FulfilmentWarehouseOption,
} from '@endora-commerce/admin-kit/components';
import { DeclaredFieldError, describedBy } from '../components/declared-field-notes.js';

/**
 * Organization-level fulfilment-strategy override (precedence: Product →
 * Organization → Sales Channel → platform default).
 *
 * **A section of the organization detail's one Save** (feature 180, WP-7;
 * `specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2). It
 * has no Save of its own any more: the value is the host's draft, and the
 * page's Save writes it in the host part's one `PATCH …/organizations/:id`,
 * under the organization's `expectedUpdatedAt`.
 */
export interface FulfilmentStrategyPanelProps {
  value: FulfilmentStrategyValue;
  onChange: (value: FulfilmentStrategyValue) => void;
  warehouses: FulfilmentWarehouseOption[];
  /** While the page's Save runs. */
  disabled?: boolean;
  /**
   * `specs/193-admin-form-extensions/` WP-E1 — the declared field's effective
   * label and help (`fulfilmentStrategy` on `organization.edit`): the section's
   * title and description. Absent, the section's own title and none.
   */
  title?: ReactNode;
  description?: ReactNode;
  /** A refused save's or a client rule's message for the strategy, tied to its select. */
  error?: string | undefined;
}

export function FulfilmentStrategyPanel({
  value,
  onChange,
  warehouses,
  disabled = false,
  title,
  description,
  error,
}: FulfilmentStrategyPanelProps): ReactNode {
  const t = useTranslation('core');
  return (
    // Issue #1515 — a section of the Commerce tab's card, not a card of its own.
    <EditorSection title={title ?? t('fulfilment.orgTitle')} {...(description === undefined ? {} : { description })}>
      <FulfilmentStrategyPicker
        value={value}
        onChange={onChange}
        warehouses={warehouses}
        allowInherit
        disabled={disabled}
        idPrefix="org-fulfilment"
        describedBy={describedBy('org-fulfilment', error)}
        invalid={error !== undefined}
      />
      <DeclaredFieldError id="org-fulfilment" error={error} />
    </EditorSection>
  );
}

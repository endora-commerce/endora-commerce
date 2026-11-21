import type { ReactNode } from 'react';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  FulfilmentStrategyPicker,
  type FulfilmentStrategyValue,
  type FulfilmentWarehouseOption,
} from '@endora-commerce/admin-kit/components';

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
}

export function FulfilmentStrategyPanel({
  value,
  onChange,
  warehouses,
  disabled = false,
}: FulfilmentStrategyPanelProps): ReactNode {
  const t = useTranslation('core');
  return (
    // Issue #1515 — a section of the Commerce tab's card, not a card of its own.
    <EditorSection title={t('fulfilment.orgTitle')}>
      <FulfilmentStrategyPicker
        value={value}
        onChange={onChange}
        warehouses={warehouses}
        allowInherit
        disabled={disabled}
        idPrefix="org-fulfilment"
      />
    </EditorSection>
  );
}

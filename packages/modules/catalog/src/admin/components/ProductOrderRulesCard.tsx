import type { ReactNode } from 'react';
import { isOrderMinimumEligibleType } from '@endora-commerce/contracts';
import { ScopedFieldGrid } from '@endora-commerce/admin-kit/components';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { EditorField } from './editor/editor-context.js';
import { BooleanControl, NumberControl } from './editor/scoped-controls.js';

/**
 * Feature 155 (US1, US5; FR-001, FR-003, FR-004) — the product's order rules in the Inventory
 * tab: "Returnable" for every product type and the pieces minimum for simple and configurable
 * products only (D5 — the server refuses it on other types, so a line says why instead).
 *
 * Feature 174 (T100; `contracts/editor-ui.md` §4) — both are scoped values at Global or per
 * sales channel ({G, C}), rendered as `ScopedField`s and saved with the editor's one Save; the
 * card's own Saves, the returnable auto-save and the per-channel table are retired. At
 * Channel × language they show the channel's value with "Set per channel".
 *
 * Issue #1488 (UX audit CAT-06): a section of the Inventory tab's card, not a card inside it.
 */
export function ProductOrderRulesCard({ productType }: { productType: string }): ReactNode {
  const t = useTranslation('catalog');
  const minimumEligible = isOrderMinimumEligibleType(productType);
  return (
    <EditorSection id="product-order-rules" title={t('orderRules.title')}>
      <ScopedFieldGrid>
        {minimumEligible ? (
          <EditorField<number>
            fieldPath="minOrderQuantity"
            label={t('orderRules.minimum.label')}
            emptyMeaning={t('orderRules.minimum.emptyMeaning')}
            render={(p): ReactNode => <NumberControl {...p} min={1} />}
          />
        ) : null}
        <EditorField<boolean>
          fieldPath="returnable"
          label={t('orderRules.returnable.label')}
          note={t('orderRules.returnable.help')}
          help={t('orderRules.returnable.helpTip')}
          render={(p): ReactNode => (
            <BooleanControl {...p} trueLabel={t('orderRules.returnable.yes')} falseLabel={t('orderRules.returnable.no')} />
          )}
        />
      </ScopedFieldGrid>
      {!minimumEligible ? <p className="text-xs text-muted-foreground">{t('orderRules.minimum.notApplicable')}</p> : null}
    </EditorSection>
  );
}

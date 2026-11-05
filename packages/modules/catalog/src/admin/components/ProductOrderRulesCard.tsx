import type { ReactNode } from 'react';
import { isOrderMinimumEligibleType } from '@endora-commerce/contracts';
import { ScopedFieldGrid } from '@endora-commerce/admin-kit/components';
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
 */
export function ProductOrderRulesCard({ productType }: { productType: string }): ReactNode {
  const t = useTranslation('catalog');
  const minimumEligible = isOrderMinimumEligibleType(productType);
  return (
    <section className="b2b-card" aria-labelledby="product-order-rules-heading">
      <div className="b2b-card__head">
        <h2 id="product-order-rules-heading">{t('orderRules.title')}</h2>
      </div>
      <div className="b2b-card__body">
        <ScopedFieldGrid>
          {minimumEligible ? (
            <EditorField<number>
              fieldPath="minOrderQuantity"
              label={t('orderRules.minimum.label')}
              emptyMeaning={t('orderRules.minimum.emptyMeaning')}
              note={t('orderRules.minimum.help')}
              render={(p): ReactNode => <NumberControl {...p} min={1} />}
            />
          ) : null}
          <EditorField<boolean>
            fieldPath="returnable"
            label={t('orderRules.returnable.label')}
            note={t('orderRules.returnable.help')}
            render={(p): ReactNode => (
              <BooleanControl {...p} trueLabel={t('orderRules.returnable.yes')} falseLabel={t('orderRules.returnable.no')} />
            )}
          />
        </ScopedFieldGrid>
        {!minimumEligible ? <p className="b2b-help">{t('orderRules.minimum.notApplicable')}</p> : null}
      </div>
    </section>
  );
}

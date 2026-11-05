import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminProductContentLanguageStatus } from '@endora-commerce/contracts';
import { Badge, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The languages a content value is edited in: always offered, then any other
 * language the stored content carries (FR-021). The card and the product
 * content screen read the same list, so they cannot disagree about a language.
 */
export const PRODUCT_CONTENT_LANGUAGES = ['en-US', 'pl-PL'] as const;

/**
 * Why a content card offers no **Edit content** link, or `null` when it does
 * (contracts/admin-surfaces.md §4).
 *
 * - `saveFirst` — the product is being created; there is nothing to attach
 *   content to yet (FR-026).
 * - `saveSetFirst` — the Details tab chose another attribute set than the one
 *   saved; the content screen judges membership against the saved set.
 * - `noEditor` — nothing contributes a Page Builder (the CMS is off, or the
 *   operator lacks its read code); the status stays visible (FR-050).
 */
export type ProductContentCardBlocker = 'saveFirst' | 'saveSetFirst' | 'noEditor' | null;

export interface ProductContentCardProps {
  productId: string | null | undefined;
  attributeKey: string;
  label: string;
  /** The editing languages, then any other stored one. */
  languages: readonly string[];
  /** The stored languages' summaries — never the documents (research R-3). */
  stored: readonly AdminProductContentLanguageStatus[];
  /** The language whose summary is shown first, when it is filled. */
  preferredLanguage: string;
  blocker: ProductContentCardBlocker;
}

/**
 * One Page Builder content attribute on the product's Attributes tab (feature
 * 172, FR-020): its label, a filled/empty chip per language, a one-line summary
 * of what is stored, and **Edit content**, which opens the product content
 * screen. Never an input and never an inline canvas — a document is edited on a
 * page of its own.
 */
export function ProductContentCard({
  productId,
  attributeKey,
  label,
  languages,
  stored,
  preferredLanguage,
  blocker,
}: ProductContentCardProps): ReactNode {
  const t = useTranslation('catalog');
  const byLanguage = new Map(stored.map((status) => [status.language, status]));
  const shown = byLanguage.get(preferredLanguage) ?? stored[0];

  return (
    <section
      data-content-attribute={attributeKey}
      aria-label={label}
      className="rounded-md border p-4"
      style={{ gridColumn: '1 / -1' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">
            {label} <span className="b2b-mono" style={{ opacity: 0.6 }}>({attributeKey})</span>
          </h3>
          <ul className="flex flex-wrap gap-2" aria-label={t('productContent.card.languages')}>
            {languages.map((language) => (
              <li key={language}>
                <Badge variant={byLanguage.has(language) ? 'success' : 'outline'}>
                  {t(byLanguage.has(language) ? 'productContent.card.filled' : 'productContent.card.empty', {
                    language,
                  })}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {shown
              ? t('productContent.card.summary', { blocks: shown.blocks, excerpt: shown.excerpt ?? '' })
              : t('productContent.card.emptySummary')}
          </p>
          {blocker ? <p className="text-sm text-muted-foreground">{t(`productContent.card.${blocker}`)}</p> : null}
        </div>
        {blocker === null && productId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/catalog/products/${productId}/content/${attributeKey}`}>{t('productContent.card.edit')}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

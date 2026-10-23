import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ListOrdered } from 'lucide-react';
import type { PrecedenceView as PrecedenceViewData } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Card, CardContent } from '@endora-commerce/admin-kit/ui';
import { cellLabel } from '../lib/cell-labels.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/** The anchor the grid's precedence note links to (`PriceBookGrid`, T086a). */
export const PRECEDENCE_ANCHOR = 'precedence';

/**
 * The price precedence in force, read-only (feature 161, T084; US6; FR-025).
 *
 * The active preset by name, the twelve buyer cells in the order in force —
 * each named as everywhere else (`cell-labels`) and with an example sentence —
 * which of a category line and an attribute value line wins, and, for the
 * nearest-organization-first depth, that a buyer's own organization comes
 * before its parents. It renders **no** control: changing the precedence is
 * P3, and the server refuses every write (`PRECEDENCE_CHANGE_UNAVAILABLE`).
 *
 * The order is the server's (`GET …/precedence`), never a list of this file's,
 * so a deployment whose precedence differs from HY reads its own.
 *
 * Reached from the grid's note through `#precedence`: a client-side navigation
 * does not scroll to a fragment, so the section does, once it has content, and
 * takes focus so a keyboard user lands where the link said.
 */
export function PrecedenceView(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<PrecedenceViewData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      setView(await api.precedence());
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const targeted = location.hash === `#${PRECEDENCE_ANCHOR}`;
  useEffect(() => {
    if (!targeted || view === null || sectionRef.current === null) return;
    sectionRef.current.scrollIntoView({ block: 'start' });
    sectionRef.current.focus({ preventScroll: true });
  }, [targeted, view]);

  const titleId = `${PRECEDENCE_ANCHOR}-title`;
  return (
    <section
      ref={sectionRef}
      id={PRECEDENCE_ANCHOR}
      aria-labelledby={titleId}
      tabIndex={-1}
      className="mt-4 outline-none"
    >
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-4" aria-hidden="true" />
            <h2 id={titleId} className="text-base font-semibold">
              {t('settings.precedence.title')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('settings.precedence.description')}</p>
          {failed ? (
            <div className="flex items-center gap-3 text-sm">
              <span>{t('settings.precedence.error')}</span>
              <Button type="button" variant="outline" size="sm" onClick={(): void => void load()}>
                {t('priceBooks.common.retry')}
              </Button>
            </div>
          ) : view === null ? (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              {t('settings.precedence.loading')}
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-medium">
                  {view.preset ? t(`settings.precedence.preset.${view.preset}`) : t('settings.precedence.preset.custom')}
                </span>{' '}
                <span className="text-muted-foreground">
                  · {t('settings.precedence.version', { version: view.version })}
                </span>
              </p>
              <ol aria-label={t('settings.precedence.listLabel')} className="list-decimal space-y-1 pl-6 text-sm">
                {view.cells.map((cell) => (
                  <li key={cell}>
                    <span className="font-medium">{cellLabel(t, cell)}</span>
                    <span className="text-muted-foreground"> — {t(`settings.precedence.example.${cell}`)}</span>
                  </li>
                ))}
              </ol>
              <p className="text-sm">
                {view.categoryBeforeAttribute
                  ? t('settings.precedence.categoryFirst')
                  : t('settings.precedence.attributeFirst')}
              </p>
              {view.depthMode === 'nearest_organization_first' ? (
                <p className="text-sm">{t('settings.precedence.nearestOrganizationFirst')}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">{t('settings.precedence.later')}</p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

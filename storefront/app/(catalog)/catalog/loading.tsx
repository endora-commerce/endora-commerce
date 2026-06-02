import type { ReactNode } from 'react';

/**
 * Catalog listing skeleton — matches the real grid (4 columns desktop,
 * collapses on mobile via `.industria-product-grid`), so when the real
 * data lands the layout doesn't shift.
 */
export default function CatalogLoading(): ReactNode {
  const placeholders = Array.from({ length: 8 });
  return (
    <>
      <div className="b2b-progress" aria-hidden="true" />
      <div className="mx-auto max-w-[1360px] px-[24px]" style={{ padding: '24px 24px 48px' }}>
        <div
          className="b2b-skel b2b-skel--line b2b-skel-card__line--short"
          style={{ height: 28, marginBottom: 18 }}
        />
        <ul className="industria-product-grid" style={{ marginTop: 12 }}>
          {placeholders.map((_, i) => (
            <li key={i}>
              <div className="b2b-skel-card">
                <div className="b2b-skel-card__media b2b-skel" />
                <div className="b2b-skel-card__body">
                  <div className="b2b-skel b2b-skel--text b2b-skel-card__line--short" />
                  <div className="b2b-skel b2b-skel--line b2b-skel-card__line--long" />
                  <div className="b2b-skel b2b-skel--line b2b-skel-card__line--mid" />
                  <div className="b2b-skel-card__foot">
                    <div className="b2b-skel b2b-skel--line b2b-skel-card__line--short" style={{ width: '35%' }} />
                    <div className="b2b-skel b2b-skel--text" style={{ width: '25%' }} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

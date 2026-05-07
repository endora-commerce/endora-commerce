import type { ReactNode } from 'react';

/**
 * Product detail skeleton — two columns (gallery on the left, info on
 * the right) collapsing to one on narrow screens, matching the real
 * PDP layout so the swap is visually quiet.
 */
export default function ProductLoading(): ReactNode {
  return (
    <>
      <div className="b2b-progress" aria-hidden="true" />
      <div className="container" style={{ padding: '24px 24px 48px' }}>
        <div
          className="b2b-skel b2b-skel--text"
          style={{ width: '40%', marginBottom: 18 }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
            gap: 32,
          }}
        >
          <div>
            <div className="b2b-skel" style={{ aspectRatio: '1 / 1', borderRadius: 'var(--r-lg)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="b2b-skel" style={{ aspectRatio: '1 / 1' }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="b2b-skel b2b-skel--text b2b-skel-card__line--short" />
            <div className="b2b-skel b2b-skel--line b2b-skel-card__line--long" style={{ height: 28 }} />
            <div className="b2b-skel b2b-skel--line b2b-skel-card__line--mid" />
            <div className="b2b-skel b2b-skel--line b2b-skel-card__line--long" />
            <div className="b2b-skel b2b-skel--line" style={{ height: 36, width: '60%', marginTop: 12 }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <div className="b2b-skel b2b-skel--line" style={{ height: 44, width: 160, borderRadius: 'var(--r-md)' }} />
              <div className="b2b-skel b2b-skel--line" style={{ height: 44, width: 120, borderRadius: 'var(--r-md)' }} />
            </div>
            <div className="b2b-skel b2b-skel--block" style={{ minHeight: 200, marginTop: 16 }} />
          </div>
        </div>
      </div>
    </>
  );
}

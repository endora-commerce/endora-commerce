import type { ReactNode } from 'react';

/**
 * Default route-level loading UI shown by Next.js while the next
 * page's RSC payload streams. Renders the top progress bar and a
 * neutral content skeleton so the chrome (Header / Footer / Megamenu)
 * stays static and only the page content visibly transitions.
 */
export default function Loading(): ReactNode {
  return (
    <>
      <div className="b2b-progress" aria-hidden="true" />
      <div className="mx-auto max-w-[1360px] px-[24px] py-[32px]">
        <div className="b2b-skel b2b-skel--text b2b-skel-card__line--short mb-[14px]" />
        <div className="b2b-skel b2b-skel--line b2b-skel-card__line--mid mb-[24px] h-[24px]" />
        <div className="b2b-skel b2b-skel--block min-h-[320px]" />
      </div>
    </>
  );
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  COMPARE_MAX_ITEMS,
  readCompareSlugs,
  subscribeCompare,
  toggleCompare,
} from '../lib/compare/store';

/**
 * Small client-side toggle that lets the customer add a product to the
 * comparison list. Renders inert SSR-side so non-JS visitors never see a
 * non-functional control (Constitution Principle VII).
 */
export function CompareToggle(props: { slug: string; locale: string }): ReactNode {
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const refresh = (): void => setActive(readCompareSlugs().includes(props.slug));
    refresh();
    setHydrated(true);
    return subscribeCompare(refresh);
  }, [props.slug]);

  if (!hydrated) return null;

  return (
    <button
      type="button"
      className={`b2b-compare-toggle${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={(): void => {
        toggleCompare(props.slug);
      }}
      title={
        active
          ? 'Remove from comparison'
          : `Add to comparison (max ${COMPARE_MAX_ITEMS})`
      }
    >
      {active ? '✓ Compared' : 'Compare'}
    </button>
  );
}

export function CompareCounterLink(props: { href: string }): ReactNode {
  const [size, setSize] = useState(0);
  useEffect(() => {
    const refresh = (): void => setSize(readCompareSlugs().length);
    refresh();
    return subscribeCompare(refresh);
  }, []);
  if (size === 0) return null;
  return (
    <a href={props.href} className="b2b-compare-counter">
      Compare ({size})
    </a>
  );
}

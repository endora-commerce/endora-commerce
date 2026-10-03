'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { BlockPresence } from '@endora-commerce/page-builder-core/contributions';

/**
 * What every Page Builder tree on one page shares: which modules the backend
 * reports as not present, and the content language of the request.
 */
export interface BlockRenderScopeValue {
  readonly presence: BlockPresence;
  readonly language: string;
}

const BlockRenderScopeContext = createContext<BlockRenderScopeValue | null>(null);

/** The scope above this component, or `null` when none is mounted. */
export function useBlockRenderScope(): BlockRenderScopeValue | null {
  return useContext(BlockRenderScopeContext);
}

/**
 * Mounted once, by the root layout, with what `getServerContext()` resolved
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §7).
 *
 * A scope rather than a prop on every render site, because Page Builder content
 * is rendered from places with no server context of their own — a megamenu
 * panel inside a client drawer, a consent message — and threading presence to
 * each would be a prop drilled through components that have no use for it. A
 * render site may still pass its own `presence` or `language`: a page that
 * resolved `?lang=` differently from the layout does.
 */
export function BlockRenderScope({
  presence,
  language,
  children,
}: {
  presence: BlockPresence;
  language: string;
  children: ReactNode;
}): ReactNode {
  const absentKey = presence.absent.join(',');
  const value = useMemo(
    (): BlockRenderScopeValue => ({ presence: { absent: absentKey === '' ? [] : absentKey.split(',') }, language }),
    [absentKey, language],
  );
  return <BlockRenderScopeContext.Provider value={value}>{children}</BlockRenderScopeContext.Provider>;
}

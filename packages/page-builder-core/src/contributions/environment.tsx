'use client';

// The render environment a host provides around a Page Builder tree
// (`contracts/block-renderers.md` §2). A context rather than a prop: Puck owns
// the props a block receives, and they are the stored document's.

import { createContext, useContext, type ReactNode } from 'react';

import type { BlockRenderEnvironment } from './types.js';

const DEFAULT_ENVIRONMENT: BlockRenderEnvironment = { language: 'en', preview: false };

const BlockRenderEnvironmentContext = createContext<BlockRenderEnvironment>(DEFAULT_ENVIRONMENT);

export function BlockRenderEnvironmentProvider({
  value,
  children,
}: {
  value: BlockRenderEnvironment;
  children: ReactNode;
}): ReactNode {
  return (
    <BlockRenderEnvironmentContext.Provider value={value}>
      {children}
    </BlockRenderEnvironmentContext.Provider>
  );
}

/**
 * The language and preview flag of the tree being rendered. Outside a provider
 * it answers English, not in preview — a renderer never has to guard for it.
 */
export function useBlockRenderEnvironment(): BlockRenderEnvironment {
  return useContext(BlockRenderEnvironmentContext);
}

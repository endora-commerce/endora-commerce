'use client';

import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import type { ReactNode } from 'react';

export interface BadgeProps {
  readonly text?: string;
  readonly explode?: string | boolean;
}

/**
 * The renderer's one built-in string — a label that is not operator content —
 * shipped in both languages inside the layer and chosen by the request's
 * content language, with English as the fallback. The storefront's own
 * catalogue belongs to the storefront's owner.
 */
const LABEL: Readonly<Record<string, string>> = { en: 'Badge', pl: 'Odznaka' };

/**
 * Synchronous, reads no browser global, and draws the same output on the
 * server and on hydration for the same props: it is part of the
 * server-rendered HTML.
 */
export function Badge({ text, explode }: BadgeProps): ReactNode {
  const { language } = useBlockRenderEnvironment();
  if (explode === true || explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
  const label = LABEL[language.slice(0, 2).toLowerCase()] ?? LABEL['en'];
  return (
    <span className="acceptance_blocks-badge" title={label}>
      {`acceptance-badge:${String(text ?? '')}`}
    </span>
  );
}

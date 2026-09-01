'use client';

import type { ReactElement, ReactNode } from 'react';
import type { Plugin } from '@measured/puck';
import { PageBuilderOutline } from '@endora-commerce/page-builder-core/editor';

/**
 * Email builder plugin — Outline like CMS, without CMS viewport / responsive field wiring.
 */
export function createEmailBuilderEditorPlugin(): Plugin {
  return {
    overrides: {
      outline: ({ children }: { children: ReactNode }): ReactElement => (
        <PageBuilderOutline>{children}</PageBuilderOutline>
      ),
    },
  };
}

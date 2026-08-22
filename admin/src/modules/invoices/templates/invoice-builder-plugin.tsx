'use client';

import type { ReactElement, ReactNode } from 'react';
import type { Plugin } from '@measured/puck';
import { PageBuilderOutline } from '@endora-commerce/page-builder-core/editor';

/** Invoice builder plugin — Outline like CMS/email, without viewport fields. */
export function createInvoiceBuilderEditorPlugin(): Plugin {
  return {
    overrides: {
      outline: ({ children }: { children: ReactNode }): ReactElement => (
        <PageBuilderOutline>{children}</PageBuilderOutline>
      ),
    },
  };
}

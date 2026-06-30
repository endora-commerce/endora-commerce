// Email Page Builder embeds context (feature 047).
//
// The `EmailInsertBlock` / `EmailInsertTemplate` components reference a reusable
// block / template by code. On the authoring canvas we want to render that
// referenced content inline rather than just printing its code. This React
// context lets the host editor supply pre-rendered previews keyed by code;
// when absent, the components fall back to a labelled placeholder.

import { createContext, useContext, type ReactNode } from 'react';

export interface EmailEmbeds {
  /** Rendered preview node per referenced block code. */
  blocks: Record<string, ReactNode>;
  /** Rendered preview node per referenced template code. */
  templates: Record<string, ReactNode>;
}

const EmailEmbedsContext = createContext<EmailEmbeds>({ blocks: {}, templates: {} });

export const EmailEmbedsProvider = EmailEmbedsContext.Provider;

/** Read the embed previews supplied by the host editor (empty by default). */
export function useEmailEmbeds(): EmailEmbeds {
  return useContext(EmailEmbedsContext);
}

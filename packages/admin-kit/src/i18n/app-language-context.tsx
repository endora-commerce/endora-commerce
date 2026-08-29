// Tiny context shared between App and ProfilePage so the user's
// language selector in Profile flips the whole admin tree without
// going through React-Query / global state. Feature 019.

import { createContext, useContext } from 'react';
import type { SupportedAdminLanguage } from './types.js';

export interface AppLanguageContextValue {
  language: SupportedAdminLanguage;
  setLanguage(next: SupportedAdminLanguage): void;
}

export const AppLanguageContext = createContext<AppLanguageContextValue | null>(
  null,
);

export function useAppLanguage(): AppLanguageContextValue {
  const ctx = useContext(AppLanguageContext);
  if (!ctx) {
    throw new Error(
      'useAppLanguage must be used inside <AppLanguageContext.Provider>; check App.tsx wiring.',
    );
  }
  return ctx;
}

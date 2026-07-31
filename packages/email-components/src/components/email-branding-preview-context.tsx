// Branding preview for EmailLogo on the authoring canvas.

import { createContext, useContext } from 'react';

export interface EmailBrandingPreview {
  /** Resolved absolute logo URL for the current scope, or empty. */
  logoUrl: string;
}

const EmailBrandingPreviewContext = createContext<EmailBrandingPreview>({ logoUrl: '' });

export const EmailBrandingPreviewProvider = EmailBrandingPreviewContext.Provider;

export function useEmailBrandingPreview(): EmailBrandingPreview {
  return useContext(EmailBrandingPreviewContext);
}

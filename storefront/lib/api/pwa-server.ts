// Server-side PWA config fetch (feature 046). Used by the manifest route and the
// same-origin `/pwa/config` route handler. Never throws — returns platform
// defaults when the backend is unreachable, so the storefront stays a working
// website even without PWA config (graceful degradation, US1 scenario 3).

import type { PwaPublicConfig } from '@endora-commerce/contracts';
import { backendBaseUrl } from '../env.mjs';

const DEFAULT_CONFIG: PwaPublicConfig = {
  appName: process.env['NEXT_PUBLIC_APP_NAME'] ?? 'B2B Platform',
  shortName: process.env['NEXT_PUBLIC_APP_SHORT_NAME'] ?? 'B2B',
  themeColor: '#1d4ed8',
  backgroundColor: '#fafafa',
  displayMode: 'standalone',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  cachingEnabled: false,
  pushEnabled: false,
  vapidPublicKey: '',
};

export async function fetchPwaConfig(channelCode?: string): Promise<PwaPublicConfig> {
  const baseUrl = backendBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/storefront/pwa/config`, {
      headers: channelCode ? { 'X-Sales-Channel': channelCode } : {},
      // Bounded propagation (FR-009) without hammering the backend per request.
      next: { revalidate: 60 },
    });
    if (!res.ok) return DEFAULT_CONFIG;
    return (await res.json()) as PwaPublicConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

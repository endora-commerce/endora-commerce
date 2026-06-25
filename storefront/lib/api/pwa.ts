// Client-side PWA helpers (feature 046). Talk to same-origin Next route handlers
// (`/pwa/config`, `/pwa/subscriptions`) which proxy to the backend.

import type { PwaPublicConfig } from '@b2b/contracts';

export async function getPwaConfig(): Promise<PwaPublicConfig | null> {
  try {
    const res = await fetch('/pwa/config', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as PwaPublicConfig;
  } catch {
    return null;
  }
}

/** base64url VAPID key → Uint8Array for PushManager.subscribe. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeToPush(vapidPublicKey: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: the DOM lib types applicationServerKey as BufferSource; the generic
      // Uint8Array<ArrayBufferLike> is a compatible view.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));
  const json = subscription.toJSON();
  const res = await fetch('/pwa/subscriptions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
      userAgent: navigator.userAgent,
    }),
  });
  return res.ok;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch('/pwa/subscriptions', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

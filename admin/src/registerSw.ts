/**
 * Registers the admin service worker (feature 046, US6) for installability +
 * asset caching. Fire-and-forget; disabled in dev and on unsupported browsers
 * so the admin degrades to a plain SPA. No push (FR-025).
 */
export function registerAdminServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  const version = (import.meta.env['VITE_BUILD_ID'] as string | undefined) ?? 'v1';
  navigator.serviceWorker
    .register(`/admin-service-worker.js?v=${encodeURIComponent(version)}`)
    .catch(() => {
      // Swallow — the admin still works as a normal SPA.
    });
}

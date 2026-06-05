import { useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Warn the user before they navigate away from a form that has unsaved edits.
 *
 * The admin mounts a component `<BrowserRouter>` (not a data router), so React
 * Router v7's `useBlocker` is unavailable here. This hook covers the two real
 * "lose my changes" vectors instead:
 *
 *   1. Browser-level unload (reload, tab close, typing a new URL, clicking an
 *      external link) via the native `beforeunload` confirmation dialog.
 *   2. In-app SPA navigation via clicks on same-origin `<a>` / `<Link>`
 *      elements (e.g. the left nav) — intercepted in the capture phase and
 *      confirmed with the user *before* React Router handles the click.
 *
 * Programmatic `navigate()` calls (e.g. right after an explicit Save) are not
 * intercepted; callers should make sure `when` is false by the time they
 * navigate themselves (typically by reloading/snapshotting after a save).
 *
 * @param when    Whether the form currently has unsaved changes.
 * @param message Optional override for the confirmation text. Defaults to the
 *                shared `core` namespace string.
 */
export function useUnsavedChangesPrompt(when: boolean, message?: string): void {
  const t = useTranslation('core');
  const confirmMessage = message ?? t('form.unsavedChanges.confirm');

  // 1. Browser-level unload.
  useEffect(() => {
    if (!when) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return (): void => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  // 2. In-app link clicks (capture phase, before React Router).
  useEffect(() => {
    if (!when) return undefined;
    const onClickCapture = (e: MouseEvent): void => {
      // Respect anything already handled, non-primary clicks, and
      // new-tab / modified clicks (those don't discard the current view).
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // Absolute / external URLs (scheme: or //) navigate the browser away,
      // which already triggers `beforeunload` — skip to avoid a double prompt.
      if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return;

      const url = new URL(href, window.location.origin);
      const current = window.location.pathname + window.location.search;
      if (url.pathname + url.search === current) return; // same route / in-page anchor

      if (!window.confirm(confirmMessage)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return (): void =>
      document.removeEventListener('click', onClickCapture, true);
  }, [when, confirmMessage]);
}

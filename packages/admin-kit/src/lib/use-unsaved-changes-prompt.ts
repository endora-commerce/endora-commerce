import { useContext, useEffect, useRef, type RefObject } from 'react';
import { UNSAFE_DataRouterContext, type Blocker, type BlockerFunction } from 'react-router-dom';
import { useTranslation } from '../i18n/useTranslation.js';

/**
 * Warn the user before they navigate away from a form that has unsaved edits.
 *
 * It covers the real "lose my changes" vectors:
 *
 *   1. Browser-level unload (reload, tab close, typing a new URL, clicking an
 *      external link) via the native `beforeunload` confirmation dialog.
 *   2. In-app SPA navigation via clicks on same-origin `<a>` / `<Link>`
 *      elements (e.g. the left nav) — intercepted in the capture phase and
 *      confirmed with the user *before* React Router handles the click.
 *   3. Optionally, a `role="tab"` outside a given element (`guardTabsOutside`).
 *   4. The browser's Back / Forward to another screen (issue #1605) — through
 *      React Router's blocker, which needs a data router: `AdminRoot` mounts
 *      `createBrowserRouter`. Under a component router (a project composing
 *      its own `<BrowserRouter>`, a test's `<MemoryRouter>`) there is no
 *      blocker and this vector is skipped. A history step that changes only
 *      the query stays on the screen and is the screen's to handle (the
 *      product editor's scope switch asks about it itself).
 *
 * Programmatic `navigate()` calls (e.g. right after an explicit Save) are not
 * intercepted; callers should make sure `when` is false by the time they
 * navigate themselves (typically by reloading/snapshotting after a save), or
 * ask first through `useUnsavedChangesGuard().confirm`.
 *
 * This is the minimal form — the browser's own `confirm()`, leave or stay. A
 * screen with a Save button uses `useUnsavedChangesGuard` from
 * `@endora-commerce/admin-kit/components` instead, which runs the same
 * interception and asks Save / Discard / Stay in the admin's own dialog
 * (issue #1446, DS-13).
 *
 * @param when    Whether the form currently has unsaved changes.
 * @param message Optional override for the confirmation text. Defaults to the
 *                shared `core` namespace string.
 */
export interface UnsavedChangesPromptOptions {
  /**
   * Also ask before a `role="tab"` **outside** this element is activated
   * (feature 161, FR-020). For a panel contributed into a host's tabbed screen
   * — a zone in the product editor's Pricing tab — a host tab switch unmounts
   * the panel and its edits with it, and is neither a link nor an unload.
   */
  guardTabsOutside?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Decides whether an intercepted navigation may go ahead **now**. Returning
 * `true` lets it through; returning `false` cancels it, and `replay` re-runs
 * the very same navigation later (the dialog's Discard or Save) without asking
 * again. `cancel` must run when the operator stays instead: a blocked Back /
 * Forward holds the router's blocker until it is released.
 */
export type LeaveAsker = (replay: () => void, cancel: () => void) => boolean;

const noop = (): void => {};

/**
 * The interception both unsaved-changes primitives share — one implementation
 * for `useUnsavedChangesPrompt` (asks with `window.confirm`) and the kit's
 * `useUnsavedChangesGuard` (asks in a Save / Discard / Stay dialog). Not on the
 * `./lib` barrel: a screen names one of those two, never this.
 */
export function useLeaveInterception(when: boolean, ask: LeaveAsker, options: UnsavedChangesPromptOptions = {}): void {
  const askRef = useRef(ask);
  askRef.current = ask;
  /** Set while a replayed activation is in flight, so it is not asked about twice. */
  const bypassRef = useRef(false);

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
      if (bypassRef.current) return;
      // Respect anything already handled, non-primary clicks, and
      // new-tab / modified clicks (those don't discard the current view).
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      // A link whose screen runs its own unsaved-changes guard (the product editor's scope
      // links: Save / Discard / Stay) opts out, so the operator is not asked twice.
      if (anchor.closest('[data-own-unsaved-guard]')) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // Absolute / external URLs (scheme: or //) navigate the browser away,
      // which already triggers `beforeunload` — skip to avoid a double prompt.
      if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return;

      const url = new URL(href, window.location.origin);
      const current = window.location.pathname + window.location.search;
      if (url.pathname + url.search === current) return; // same route / in-page anchor

      const replay = (): void => {
        if (!anchor.isConnected) {
          window.location.assign(url.href);
          return;
        }
        bypassRef.current = true;
        try {
          anchor.click();
        } finally {
          bypassRef.current = false;
        }
      };
      if (!askRef.current(replay, noop)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return (): void => document.removeEventListener('click', onClickCapture, true);
  }, [when]);

  // 3. A host's tab outside the panel (opt-in, `guardTabsOutside`).
  const panel = options.guardTabsOutside;
  useEffect(() => {
    if (!when || !panel) return undefined;
    const onTabCapture = (e: MouseEvent): void => {
      if (bypassRef.current) return;
      if (e.defaultPrevented) return;
      const tab = (e.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]');
      if (!tab || panel.current?.contains(tab)) return;
      if (tab.getAttribute('aria-selected') === 'true') return;
      const replay = (): void => {
        if (!tab.isConnected) return;
        bypassRef.current = true;
        try {
          tab.click();
        } finally {
          bypassRef.current = false;
        }
      };
      if (!askRef.current(replay, noop)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onTabCapture, true);
    return (): void => document.removeEventListener('click', onTabCapture, true);
  }, [when, panel]);

  // 4. Browser Back / Forward to another screen — a data router's blocker, when there is one.
  //    `useBlocker` itself throws outside a data router, and a kit hook cannot know which router
  //    its screen is mounted under, so this registers on the router the context offers, as
  //    `useBlocker` does. Only POP is blocked: links and tabs are asked about above and replayed,
  //    and a screen's own `navigate()` goes through `confirm`.
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  useEffect(() => {
    if (!when || !router) return undefined;
    const key = `unsaved-changes-${++blockerSeq}`;
    const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation, historyAction }) =>
      historyAction === 'POP' && currentLocation.pathname !== nextLocation.pathname;
    let asked: Blocker | null = null;
    const onState = (blocker: Blocker | undefined): void => {
      if (blocker?.state !== 'blocked') {
        asked = null;
        return;
      }
      if (blocker === asked) return;
      asked = blocker;
      const proceed = (): void => blocker.proceed();
      const reset = (): void => blocker.reset();
      if (askRef.current(proceed, reset)) proceed();
    };
    router.getBlocker(key, shouldBlock);
    const unsubscribe = router.subscribe((state) => onState(state.blockers.get(key)));
    return (): void => {
      unsubscribe();
      router.deleteBlocker(key);
    };
  }, [when, router]);
}

let blockerSeq = 0;

export function useUnsavedChangesPrompt(when: boolean, message?: string, options: UnsavedChangesPromptOptions = {}): void {
  const t = useTranslation('core');
  const confirmMessage = message ?? t('form.unsavedChanges.confirm');
  useLeaveInterception(
    when,
    (_replay, cancel) => {
      if (window.confirm(confirmMessage)) return true;
      cancel();
      return false;
    },
    options,
  );
}

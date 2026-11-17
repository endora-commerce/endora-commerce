/**
 * Puck 0.23 starts a 500 ms timer when its canvas mounts
 * (`setTimeout(() => setShowLoader(true), 500)` in `@puckeditor/core`'s
 * `dist/chunk-55V3NZVF.mjs`) and never clears it on unmount. In a browser that
 * is harmless: React drops an update to an unmounted component, and `window`
 * is always there. Under vitest it is not: a file whose last Puck mount is
 * under 500 ms before its end lets the timer come due after jsdom has been torn
 * down but before the worker exits, and React's `dispatchSetState` then reads
 * `window` and throws `ReferenceError: window is not defined`. Vitest reports
 * that as an unhandled error and fails the run with every test green (PR #478,
 * issue #1035).
 *
 * The timer is a dependency's, so it cannot be cleared at its source; the test
 * setup outlives it instead, in files that mounted Puck and in no other.
 */
export const PUCK_LOADER_TIMER_MS = 500;

/** The class Puck's CSS module gives its root element (`_Puck_<hash>`). */
const PUCK_ROOT_SELECTOR = '[class*="_Puck_"]';

export interface PuckMountTracker {
  /** Whether a Puck root has been in the document since the tracker started. */
  readonly mounted: boolean;
  stop(): void;
}

function containsPuck(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches(PUCK_ROOT_SELECTOR) || node.querySelector(PUCK_ROOT_SELECTOR) !== null;
}

/**
 * Watches `document` for a Puck root being added.
 *
 * It watches insertions rather than looking at the DOM when asked, because by
 * the time anybody asks Puck may be gone: vitest runs `afterEach` hooks in
 * stack order, so a test file's own `afterEach(() => cleanup())` unmounts Puck
 * before the setup file's `afterEach` runs, and a look at that point found
 * nothing (issue #1035, `test/page-builder-admin/sidebar-field-layout.test.tsx`).
 */
export function trackPuckMounts(): PuckMountTracker {
  let mounted = false;
  if (typeof MutationObserver === 'undefined') return { mounted, stop: () => undefined };
  const scan = (records: readonly MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (containsPuck(node)) {
          mounted = true;
          observer.disconnect();
          return;
        }
      }
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document, { childList: true, subtree: true });
  return {
    get mounted(): boolean {
      // `takeRecords` hands back what the observer has not delivered yet: a
      // Puck added and removed within the current task is there, not yet seen.
      if (!mounted) scan(observer.takeRecords());
      return mounted;
    },
    stop: (): void => observer.disconnect(),
  };
}

/**
 * Waits out Puck's loader timer when Puck was mounted, so it fires while jsdom
 * is still there. Called from the setup file's `afterAll`, which runs after
 * every hook of the test file, so a timer armed by the file's last mount is
 * already counting when the wait starts.
 */
export async function outlivePuckLoaderTimer(tracker: PuckMountTracker): Promise<void> {
  if (!tracker.mounted) return;
  await new Promise((settle) => setTimeout(settle, PUCK_LOADER_TIMER_MS + 100));
}

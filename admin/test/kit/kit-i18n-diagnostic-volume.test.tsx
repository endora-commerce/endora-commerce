/**
 * The i18n runtime's two development diagnostics report each distinct fact once.
 *
 * ## The defect
 *
 * `test / test:frontend` could not report why it failed. Master pipeline 14265's
 * job 55801 ends in `Job's log exceeded limit of 4194304 bytes. Job execution
 * will continue but no more output will be collected.`, and vitest prints its
 * failure summary **last** — so the summary was past the cut, the job published
 * no junit report, and `projects/267/pipelines/14265/test_report` answered
 * `total: 0`. The failure was undiagnosable by every route at once. It is the
 * same shape as pipeline 13573 on `test:backend`, whose half is held by
 * `backend/test/unit/ci/junit-artifact.test.ts`.
 *
 * ## What blew the limit, measured
 *
 * One `pnpm --filter '!backend' run test`, green, on `f27aae82d`: **5 509 606
 * bytes**, 1.31x the ceiling. By category:
 *
 * | bytes | share | lines | category |
 * | --- | --- | --- | --- |
 * | 3 537 037 | 64.2% | 38 201 | `[i18n] missing en: <key> → fell back to …` |
 * | 1 261 154 | 22.9% | 6 750 | stack frames of the unstubbed-fetch `Error` |
 * | 301 791 | 5.5% | 1 334 | vitest's `stderr | <file> > <test>` headers |
 * | 178 319 | 3.2% | 1 023 | vitest's own per-file and per-test result lines |
 * | 145 368 | 2.6% | 673 | `[i18n] bundle fetch failed` message lines |
 * | 85 938 | 1.6% | 795 | everything else |
 *
 * So the **missing-key** warning is the bulk, not the fetch failure: 38 201
 * lines carrying **920 distinct** keys, `core.appShell.profileMenu.profile`
 * alone 3 240 times. One test — `ApiKeysPage.test.tsx`'s create-payload mirror —
 * emits 2 245 of them by itself, because a `userEvent` interaction re-renders
 * the tree and every render re-logs every key the passthrough bundle does not
 * carry.
 *
 * ## The mechanism, which is two different mechanisms
 *
 * **The missing-key warning genuinely fires per render**, and has to: `t()` is
 * called during render, `resolve()` returns a non-`requested` outcome for every
 * key the bundle lacks, and nothing in between remembers. The *call* is correct;
 * only the *log* repeats a fact it already stated.
 *
 * **The fetch warning does not.** 673 occurrences over 23 files and 249 tests,
 * median 2 per test and at most 14 — a count that tracks `<TranslationProvider>`
 * **mounts**, not renders: the module-owned-surface tests walk a module's screens
 * one mounted `<App/>` at a time, so a test that visits fourteen screens mounts
 * fourteen providers. That is what the boot effect already guarantees — a failure
 * changes no state, and the effect's deps (`language`, `fallbackBundle`) do not
 * change, so it never re-runs for a given mount. **There is therefore no re-fetch
 * defect to fix**; the volume is the per-occurrence *cost* (an `Error` with ten
 * source-mapped frames, ~2 090 bytes apiece), not the occurrence count.
 *
 * ## What this file holds
 *
 * That each distinct fact is reported once and repeats are dropped — the first
 * occurrence keeps its full form, stack frames included, because that is the
 * diagnostic and it is not what costs the bytes. De-duplication is by subject
 * rather than by call site, and it is deliberately **not** followed by a count:
 * "`core.appShell.nav.home` is missing" is the whole signal, and "it is missing
 * 1 065 times" adds nothing an author can act on.
 *
 * The scope of the memory is one module registry, which under vitest is one test
 * file, and in a browser one page load. That is the useful granularity in both
 * places: the log still says which file surfaced the key.
 */
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Keys no shipped bundle carries and no other test names, so the
 * process-wide memory this file asserts cannot have been primed elsewhere.
 */
const ABSENT_KEY = 'diagnosticVolume.absentKeyOne';
const OTHER_ABSENT_KEY = 'diagnosticVolume.absentKeyTwo';

function Consumer(props: { readonly keys: readonly string[] }): ReactElement {
  const t = useTranslation('core');
  return <span>{props.keys.map((key) => t(key)).join('|')}</span>;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/** Every `console.warn` argument list, flattened to one searchable string each. */
function warnings(): readonly string[] {
  return warn.mock.calls.map((call) =>
    call.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
  );
}

function matching(needle: string): readonly string[] {
  return warnings().filter((line) => line.includes(needle));
}

describe('the missing-translation diagnostic', () => {
  it('names a key once however many times the tree renders it', () => {
    const view = render(
      <TranslationProvider language="en" initialBundle={{}}>
        <Consumer keys={[ABSENT_KEY]} />
      </TranslationProvider>,
    );

    // Eight further renders of the same subtree. Each one calls `t()` again —
    // that is the product behaviour this does not change — and each one would
    // print another line before the repair.
    for (let i = 0; i < 8; i += 1) {
      view.rerender(
        <TranslationProvider language="en" initialBundle={{}}>
          <Consumer keys={[ABSENT_KEY]} />
        </TranslationProvider>,
      );
    }

    expect(matching(ABSENT_KEY)).toHaveLength(1);
    // The one line that survives is the whole diagnostic, not a truncation of it.
    expect(matching(ABSENT_KEY)[0]).toContain('fell back to placeholder');
  });

  it('still names a second, distinct key', () => {
    render(
      <TranslationProvider language="en" initialBundle={{}}>
        <Consumer keys={[ABSENT_KEY, OTHER_ABSENT_KEY]} />
      </TranslationProvider>,
    );

    expect(matching(OTHER_ABSENT_KEY)).toHaveLength(1);
    // The first key was already reported by the test above, in this same
    // process, and is correctly silent here — de-duplication is by subject, and
    // the subject outlives the render that surfaced it.
    expect(matching(ABSENT_KEY)).toHaveLength(0);
  });
});

describe('the bundle-fetch diagnostic', () => {
  it('reports one failing endpoint once, across repeated provider mounts', async () => {
    // No `initialBundle`: the provider issues its boot fetch, which
    // `admin/test/setup.ts`'s unstubbed-network guard rejects — the exact
    // production-shaped failure the CI trace carried 673 copies of.
    for (let i = 0; i < 5; i += 1) {
      const view = render(
        <TranslationProvider language="en">
          <span>mounted</span>
        </TranslationProvider>,
      );
      // Let the boot effect's rejected promise settle inside this mount.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      view.unmount();
    }

    const reported = matching('bundle fetch failed');
    expect(reported).toHaveLength(1);
    // And it still names the collaborator, which is the only reason it is printed.
    expect(reported[0]).toContain('unstubbed network call');
  });
});

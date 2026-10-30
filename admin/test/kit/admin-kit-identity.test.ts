/**
 * The kit's bindings and the admin's re-export shims are **one object**
 * (feature 091, Phase 1b).
 *
 * ## The defect this file exists for
 *
 * `contracts/admin-kit-surface.md` R4 was withdrawn because the façade it
 * described could not be built: a `tsc` re-export escaping the package is
 * TS6059, and dropping `rootDir` to make it compile emits a **second copy** of
 * every component into the kit's `dist`. The shape that replaced it — the
 * implementations move into the package and `admin/src` keeps a one-line
 * re-export shim at each old path — has the same hazard in a different place:
 * if a shim ever stopped forwarding and started re-implementing, or if the
 * admin resolved the kit twice (source in one place, `dist` in another), the
 * tree would still compile, every prop would still be the right shape and every
 * screen would still render.
 *
 * It is what `check:singleton-identity` refuses on the backend, and there is no
 * frontend instrument for it at all. So the assertion is here, and it is
 * **reference equality**: `toBe`, never `toEqual`. A second `createContext()`
 * has the same shape as the first, a second `class ApiError` has the same
 * fields, and a second copy of `PAGE_SIZE_OPTIONS` holds the same numbers —
 * every one of those passes a structural comparison while being a different
 * object, which for a React context means a provider in one copy and a consumer
 * in the other, i.e. `null` at runtime with no type error (D-108 records the
 * same hazard for `page-builder-core`).
 *
 * ## Why a React context is named specifically
 *
 * `AppLanguageContext` is the case with no fallback: `useAppLanguage` throws
 * when the context is `null`, so a duplicated context is a blank screen rather
 * than a subtle wrong answer. `ApiError` is the second shape — identity there
 * is `instanceof`, which is how every `catch` in this application decides
 * whether it is looking at an HTTP failure.
 *
 * ## The shims are gone, and so are their cases
 *
 * Issue #97 removed the last of `@endora-commerce/admin-shell`'s re-export
 * shims: the shell names `@endora-commerce/admin-kit/*` directly, and its tests
 * mock that same specifier. With no second spelling left, every case that
 * compared a shim with the barrel would compare the barrel with itself, so they
 * went with the shims — the reasoning this file recorded for each earlier
 * removal, applied to the rest. What stays is the one comparison that crosses a
 * package seam that still exists: the kit's page-size options against the
 * contracts array the server validates with.
 */
import { describe, expect, it } from 'vitest';

import * as kitLib from '@endora-commerce/admin-kit/lib';
import { ADMIN_LIST_PAGE_SIZE_OPTIONS } from '@endora-commerce/contracts';

describe('@endora-commerce/admin-kit — one binding across the seam', () => {
  it('serves the contracts array itself, so the server validates against the same options (feature 164, R-2)', () => {
    // The server refuses a page size that is not an option; it can import
    // `@endora-commerce/contracts` and not the kit. One array, so the kit's
    // dropdown and the server's validation cannot drift apart.
    expect(kitLib.PAGE_SIZE_OPTIONS).toBe(ADMIN_LIST_PAGE_SIZE_OPTIONS);
  });
});

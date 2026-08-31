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
 */
import { describe, expect, it } from 'vitest';
import { createContext } from 'react';

import * as kitUi from '@endora-commerce/admin-kit/ui';
import * as kitLib from '@endora-commerce/admin-kit/lib';
import * as kitI18n from '@endora-commerce/admin-kit/i18n';
import * as kitComponents from '@endora-commerce/admin-kit/components';

import { Button } from '@/components/ui/button';
import { Table } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/lib/api-client';
import { PAGE_SIZE_OPTIONS } from '@/lib/use-page-size-preference';
import { useTranslation } from '@/i18n/useTranslation';
import { AppLanguageContext } from '@/i18n/app-language-context';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { EChart } from '@/components/charts/echart';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { CmsBlockPicker } from '@/components/cms-picker/CmsBlockPicker';
import { CmsPagePicker } from '@/components/cms-picker/CmsPagePicker';
import { OrganizationPicker, OrganizationStatusBadge } from '@/components/organization-picker';
import { OrganizationPickerMulti } from '@/components/organization-picker/OrganizationPickerMulti';

describe('@endora-commerce/admin-kit — the shims forward, they do not copy', () => {
  it('serves the same function object through both spellings', () => {
    expect(cn).toBe(kitLib.cn);
    expect(useTranslation).toBe(kitI18n.useTranslation);
  });

  it('serves the same component object through both spellings', () => {
    expect(Button).toBe(kitUi.Button);
    expect(Table).toBe(kitUi.Table);
    expect(ResponsiveTable).toBe(kitComponents.ResponsiveTable);
    expect(EChart).toBe(kitComponents.EChart);
  });

  it('serves the three P2 pickers through both spellings, directory index included', () => {
    // Feature 091's P2 published `sales-channel-picker`, `cms-picker` and
    // `organization-picker` — the three Phase 1b left in `admin/src` because
    // they fetched from another module's admin client. Two of the five reaches
    // below go through a **directory `index.ts`**, which is a shim of a shape
    // the other entries here do not cover: a barrel forwarding four names at
    // once is the file most likely to be "helpfully" re-implemented.
    expect(SalesChannelPicker).toBe(kitComponents.SalesChannelPicker);
    expect(CmsBlockPicker).toBe(kitComponents.CmsBlockPicker);
    expect(CmsPagePicker).toBe(kitComponents.CmsPagePicker);
    expect(OrganizationPicker).toBe(kitComponents.OrganizationPicker);
    expect(OrganizationPickerMulti).toBe(kitComponents.OrganizationPickerMulti);
    expect(OrganizationStatusBadge).toBe(kitComponents.OrganizationStatusBadge);
  });

  it('serves the same API client singleton, and the same error class', () => {
    expect(apiClient).toBe(kitLib.apiClient);
    expect(ApiError).toBe(kitLib.ApiError);
    // The consequence, spelled out: a second class would fail this while
    // passing every field-by-field comparison.
    const envelope = {
      error: { code: 'TEST', message: 'test', requestId: 'r', details: undefined },
    } as unknown as ConstructorParameters<typeof kitLib.ApiError>[1];
    expect(new kitLib.ApiError(500, envelope)).toBeInstanceOf(ApiError);
  });

  it('serves the same React context object — the case with no fallback', () => {
    expect(AppLanguageContext).toBe(kitI18n.AppLanguageContext);
    // The control: a context of the identical shape is a different object, so
    // `toBe` above is discriminating rather than trivially true. `toEqual`
    // would not be — which is the whole reason this file uses `toBe`.
    const lookalike = createContext<unknown>(null);
    expect(lookalike).not.toBe(kitI18n.AppLanguageContext);
    expect(Object.keys(lookalike).sort()).toEqual(
      Object.keys(kitI18n.AppLanguageContext).sort(),
    );
  });

  it('serves the same constant array, so the dropdown and the validation cannot disagree', () => {
    // `PAGE_SIZE_OPTIONS` is the one binding this change split out of a module
    // that stayed behind: `usePageSizePreference` reads the signed-in admin's
    // id and is the admin application's, the list of numbers is the kit's, and
    // the hook re-exports it. Identity is what makes that a split rather than a
    // fork.
    expect(PAGE_SIZE_OPTIONS).toBe(kitLib.PAGE_SIZE_OPTIONS);
  });
});

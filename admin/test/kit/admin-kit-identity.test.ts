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
import { PAGE_SIZE_OPTIONS, usePageSizePreference } from '@/lib/use-page-size-preference';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ModulePresenceProvider, useModulePresence, getModulePresence } from '@/lib/module-presence';
import { isSurfaceVisible, satisfiesPermission, useSurfaceVisibility } from '@/lib/surface-visibility';
import { useTranslation } from '@/i18n/useTranslation';
import { AppLanguageContext } from '@/i18n/app-language-context';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { EChart } from '@/components/charts/echart';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { CmsBlockPicker } from '@/components/cms-picker/CmsBlockPicker';
import { CmsPagePicker } from '@/components/cms-picker/CmsPagePicker';
import { OrganizationPicker, OrganizationStatusBadge } from '@/components/organization-picker';
import { OrganizationPickerMulti } from '@/components/organization-picker/OrganizationPickerMulti';
import { AssetFieldPicker } from '@/components/asset-picker/AssetFieldPicker';

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

  it('serves the asset field picker through both spellings', () => {
    // Feature 091's P4c published the asset cluster on the terms P2 set: the
    // components rebuild their own requests from `apiClient` / `apiBaseUrl` and
    // the contract types, so nothing about them is `assets_library`' code any
    // more. `AssetFieldPicker` is the one of the three that keeps a shim, four
    // modules naming it at its old host path; `AssetPicker`, `AssetUploader`
    // and `toAbsoluteAssetUrl` were reached from module directories only, so
    // their consumers name the subpath directly and there is no old path left
    // to forward.
    expect(AssetFieldPicker).toBe(kitComponents.AssetFieldPicker);
  });

  // **`CustomFieldValuesPanel` had a case here and no longer has a shim to
  // compare.** P4e published the panel into the kit and kept a forwarder at
  // `admin/src/modules/custom_fields/CustomFieldValuesPanel.tsx` *"for the
  // owner's own screens"*; feature 091's batch 9 moved those screens into
  // `@endora-commerce/mod-custom-fields/admin`, where a `@/` specifier does not
  // resolve at all, and no other file in the tree named the old path — its four
  // consumers already name the subpath. The forwarder went with the directory.
  // What the panel still has is `admin/test/kit/kit-custom-field-values.test.tsx`,
  // which drives the published component itself; what is gone is a second
  // spelling of it, which is the thing this file exists to compare.

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

  it('serves the session cluster through both spellings, directory index included', () => {
    // Feature 091's P3. `useSurfaceVisibility` reads `useAuth` and
    // `useModulePresence` **inside** the package now, so a second copy of
    // either context reached through the shim would be a predicate answering
    // about a provider nobody mounted — and `useAuth` throws on a null context,
    // so it is a blank screen rather than a wrong answer. `module-presence` is
    // a directory `index.ts` forwarding four names at once, the shim shape most
    // likely to be "helpfully" re-implemented.
    expect(useAuth).toBe(kitLib.useAuth);
    expect(AuthProvider).toBe(kitLib.AuthProvider);
    expect(useModulePresence).toBe(kitLib.useModulePresence);
    expect(ModulePresenceProvider).toBe(kitLib.ModulePresenceProvider);
    expect(getModulePresence).toBe(kitLib.getModulePresence);
    expect(useSurfaceVisibility).toBe(kitLib.useSurfaceVisibility);
    expect(isSurfaceVisible).toBe(kitLib.isSurfaceVisible);
    expect(satisfiesPermission).toBe(kitLib.satisfiesPermission);
    expect(usePageSizePreference).toBe(kitLib.usePageSizePreference);
  });

  it('serves the same constant array, so the dropdown and the validation cannot disagree', () => {
    // `PAGE_SIZE_OPTIONS` was the one binding Phase 1b split out of a module
    // that stayed behind, because `usePageSizePreference` reads the signed-in
    // admin's id. P3 published the hook too, so the two are one package's again
    // and the shim forwards both. Identity is what made it a split rather than
    // a fork, and it is what keeps the forwarding honest now.
    expect(PAGE_SIZE_OPTIONS).toBe(kitLib.PAGE_SIZE_OPTIONS);
  });
});

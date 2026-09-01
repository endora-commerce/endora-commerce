import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CmsColorPaletteEntry,
  CmsPageBuilderDescriptor,
  PutCmsColorPaletteRequest,
} from '@endora-commerce/contracts';

/**
 * The two page-builder configuration calls the colour palette makes, rebuilt on
 * the published `apiClient` — the **client exit**
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * Z1.2, which is P2's clarification of R6 and needs no new rule).
 *
 * `ColorPaletteProvider` reached `cms`' own `cmsClient` for these, which is the
 * one kind of module knowledge a published component may carry and rebuild: an
 * HTTP path plus a contract type. `CmsColorPaletteEntry`,
 * `CmsPageBuilderDescriptor` and `PutCmsColorPaletteRequest` are all
 * `@endora-commerce/contracts`', so nothing here is a copy of a `cms` type.
 *
 * **The exposure is carried across unchanged and is recorded rather than
 * solved** (Z1.2). The endpoint is `cms`', so an operator who switches `cms` off
 * gets a 503 here — as they did before this package existed. The call site
 * degrades to an empty palette and the builder still opens, which is honest.
 * Whether a colour palette belongs to `cms` at all or to the platform is a
 * question for whoever next touches
 * `GET /api/v1/admin/cms/page-builder/config`, and it is not P5's.
 */
const CONFIG_PATH = '/api/v1/admin/cms/page-builder/config';
const PALETTE_PATH = '/api/v1/admin/cms/page-builder/color-palette';

/** The saved palette, or an empty one for a descriptor that carries none. */
export async function getPageBuilderColorPalette(): Promise<CmsColorPaletteEntry[]> {
  const out = await apiClient.get<{ data: CmsPageBuilderDescriptor }>(CONFIG_PATH);
  return out.data.colorPalette ?? [];
}

/** Replace the palette wholesale; the server answers with what it stored. */
export async function putPageBuilderColorPalette(
  body: PutCmsColorPaletteRequest,
): Promise<{ entries: CmsColorPaletteEntry[] }> {
  const out = await apiClient.put<{ data: { entries: CmsColorPaletteEntry[] } }>(
    PALETTE_PATH,
    body,
  );
  return out.data;
}

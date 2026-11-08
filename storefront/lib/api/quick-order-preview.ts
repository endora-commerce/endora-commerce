import { StorefrontApiError } from './client';
import { apiGetAuthed, apiMutate } from './mutations';
import type { RecognizedQuickOrderItem, RejectedQuickOrderItem, QuickOrderImportSummary } from './quick-order';

/**
 * Issue #809 — the buyer's quick-order preview, between the import and the build.
 *
 * The backend keeps it (`quick_order`, `GET` / `PUT` / `DELETE /api/v1/quick-order/preview`), one
 * per buyer session, scoped to the buyer's Organization, for an hour after it was last written. It
 * used to sit in the storefront's own cookie (#805), which the reverse proxy's header budget held
 * to a few dozen lines; nothing about it is in a cookie or a URL any more. The session the call
 * forwards is what names the preview — there is no id to pass.
 */

/**
 * The preview as the page reads and writes it — `quickOrderPreviewSchema` in
 * `@endora-commerce/contracts`, mirrored the way `./quick-order` mirrors the import's shapes.
 */
export interface QuickOrderPreview {
  recognized: Array<
    RecognizedQuickOrderItem & {
      /**
       * After a partial cart build: why the cart did not take this line (feature 155, FR-011 (b)),
       * with the build's product and unit names cut to `REPORT_NAME_MAX`. The server action
       * writes them here; they never travel in a URL (issue #790).
       */
      notAdded?: {
        kind: 'pieces' | 'packaging_unit';
        minimum: number;
        productName: string;
        packagingUnitName?: string;
      };
    }
  >;
  rejected: RejectedQuickOrderItem[];
  summary: QuickOrderImportSummary;
}

const PATH = '/api/v1/quick-order/preview';

/** The buyer session's preview, or `null` when there is none — never written, or expired. */
export async function readQuickOrderPreview(sessionCookie: string): Promise<QuickOrderPreview | null> {
  return apiGetAuthed<QuickOrderPreview | null>({ path: PATH, sessionCookie });
}

/**
 * Replaces the buyer session's preview. `false` when the backend will not keep it because it is
 * too long — over the line cap (`422 too_many_lines`) or the size cap (413) — and nothing was
 * written; any other refusal throws.
 */
export async function writeQuickOrderPreview(sessionCookie: string, preview: QuickOrderPreview): Promise<boolean> {
  try {
    await apiMutate<QuickOrderPreview>({ method: 'PUT', path: PATH, body: preview, sessionCookie });
    return true;
  } catch (err) {
    if (isTooLong(err)) return false;
    throw err;
  }
}

/** Drops the buyer session's preview. */
export async function clearQuickOrderPreview(sessionCookie: string): Promise<void> {
  await apiMutate<never>({ method: 'DELETE', path: PATH, sessionCookie });
}

function isTooLong(err: unknown): boolean {
  if (!(err instanceof StorefrontApiError)) return false;
  if (err.status === 413) return true;
  const details = err.details as { code?: unknown } | undefined;
  return err.status === 422 && err.code === 'VALIDATION_FAILED' && details?.code === 'too_many_lines';
}

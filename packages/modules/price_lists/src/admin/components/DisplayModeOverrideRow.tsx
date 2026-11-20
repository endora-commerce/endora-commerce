import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { upsertDisplayModeOverrideRequestSchema, type DisplayMode, type EditorSaveSessionHandle } from '@endora-commerce/contracts';
import {
  ApiError,
  apiClient,
  useAuth,
  useSaveParticipant,
  type ParticipantIssues,
  type SaveParticipantHandlers,
} from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Label, Select } from '@endora-commerce/admin-kit/ui';

type Scope = 'organization' | 'category' | 'product';
type Mode = DisplayMode | 'inherit';

const overrideUrl = (scope: Scope, targetId: string): string =>
  `/api/v1/admin/pricing/display-mode-overrides/${scope}/${encodeURIComponent(targetId)}`;

/**
 * Per-entity display-mode override row (feature 011, US7 / T089 + T090).
 *
 * Reads the current override (if any) from
 * `/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` and writes it
 * with a `PUT`. `inherit` removes the override and reverts the entity to its
 * parent in the resolution chain.
 *
 * ## What moved with it, and what did not (feature 091, P7a)
 *
 * The file used to live at `admin/src/modules/price_lists/`, imported by path
 * from `catalog`'s category editor and `organizations`' detail screen — two of
 * the admin keys the boundary ledger recorded. It is this module's control, so
 * it lives in this module's package and reaches its consumers through zone
 * contributions instead.
 *
 * **`label` and `inheritHint` did not come with it.** Both hosts passed their
 * own copy for this module's control (`categories.priceDisplayMode.label`,
 * `organizations.detail.pricingLabel`), which a zone cannot do: a host cannot
 * hand copy to a contributor it does not know. The row renders
 * `priceLists.displayMode.rowLabel` and its own hint, in every place it appears.
 *
 * The copy stays in the `core` namespace rather than moving to this module's
 * own. That is the larger population
 * `contracts/admin-component-contribution.md` §9.2 measured and deliberately
 * did **not** rule on — 62 files under the admin's module root render out of
 * `core` — and neither P7a nor P7b is the merge request that answers it.
 *
 * **P7b deleted the second copy.** One stood at
 * `admin/src/modules/price_lists/DisplayModeOverrideRow.tsx` for the length of
 * P7a, keeping the two props because `organizations`' detail screen still
 * passed them; that screen is a zone mount now, nothing imported the file, and
 * it is gone. Nothing in this estate compares two copies of one component, so
 * the shorter that state lasts the better — which is why the retiring condition
 * was written into this block rather than left to be remembered.
 *
 * ## Under a page Save (feature 180, WP-6 and WP-7)
 *
 * The row is the part `display-mode` of its host's one Save
 * (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §1–§2, FR-050, FR-060):
 * the select stages the mode, the host's Save writes it through the same `PUT`, and the host's
 * Save reports the outcome. Validation is the contracts request schema; the server adds no rule
 * beyond it (research R20). An operator without `price_lists:write` never stages.
 *
 * Both hosts — the category editor and the organization detail — hand it their session, so the
 * save-on-change branch it kept for the organization detail until WP-7 is gone, and with it the
 * "saved" suffix. A host that mounts it outside a session hands it `INERT_SAVE_SESSION`, and the
 * row then keeps a local choice that is written nowhere.
 */
export function DisplayModeOverrideRow(props: {
  scope: Scope;
  targetId: string;
  /** Hide the icon when embedding inside an existing labelled row. */
  withoutIcon?: boolean;
  /** The host editor's save session (feature 180): the host's Save writes the mode. */
  saveSession: EditorSaveSessionHandle;
}): ReactNode {
  const t = useTranslation('core');
  const tl = useTranslation('price_lists');
  const { scope, targetId, withoutIcon, saveSession } = props;
  // FR-028 (feature 161, Checkpoint 10 ruling): a reader sees the value and
  // no control; the select is only for an operator who may write it.
  const mayWrite = useAuth().hasPermission('price_lists:write');
  const MODE_LABEL: Record<Mode, string> = {
    inherit: t('priceLists.displayMode.inherit'),
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  // The stored mode; `null` while the read is in flight or after it failed, so a row that could
  // not load takes no part in its host's Save.
  const [loaded, setLoaded] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ data: { mode: DisplayMode } }>(overrideUrl(scope, targetId))
      .then((res) => {
        if (!cancelled) setLoaded(res.data.mode);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 means "no override yet — inherits"; anything else is an error.
        if (err instanceof ApiError && err.status === 404) setLoaded('inherit');
        else setError(err instanceof ApiError ? err.envelope.error.message : tl('displayModeRow.error.load'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [scope, targetId, tl]);

  // Feature 180 — the part this row plays in its host's Save. Pure of component state: the
  // session may run it after the row has unmounted.
  const handlers = useMemo<SaveParticipantHandlers<Mode>>(
    () => ({
      changeCount: (draft, baseline) => (draft === baseline ? 0 : 1),
      validate: async (draft): Promise<ParticipantIssues> =>
        upsertDisplayModeOverrideRequestSchema.safeParse({ mode: draft }).success
          ? { fields: {} }
          : { fields: {}, message: tl('displayModeRow.error.save') },
      save: async (draft): Promise<Mode> => {
        await apiClient.put(overrideUrl(scope, targetId), { mode: draft });
        return draft;
      },
    }),
    [scope, targetId, tl],
  );
  const participant = useSaveParticipant<Mode>(
    saveSession,
    { key: 'display-mode', label: tl('displayModeRow.partLabel'), writable: mayWrite, loaded },
    handlers,
  );
  const mode: Mode = participant.draft ?? loaded ?? 'inherit';
  const shownError = participant.error ?? participant.issues?.message ?? error;

  const selectId = `dm-${scope}-${targetId}`;
  const helpId = `${selectId}-help`;
  const errorId = `${selectId}-error`;
  // Issue #1492 (CAT-17): kit `Label` / `Select` and Tailwind instead of the legacy field
  // classes and inline px styles. The help line is now tied to the select, so it
  // is read with it, and the error keeps its link on top.
  return (
    <div className="flex flex-col gap-1">
      <Label className="flex items-center gap-1.5" {...(mayWrite ? { htmlFor: selectId } : {})}>
        {!withoutIcon ? <Eye size={12} aria-hidden="true" /> : null}
        {t('priceLists.displayMode.rowLabel')}
      </Label>
      {mayWrite ? (
        <Select
          id={selectId}
          value={mode}
          disabled={loading || loaded === null || participant.status === 'saving'}
          aria-invalid={shownError !== null ? true : undefined}
          aria-describedby={shownError !== null ? `${errorId} ${helpId}` : helpId}
          onChange={(e): void => participant.setDraft(e.target.value as Mode)}
        >
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </Select>
      ) : (
        <p className="m-0 text-sm">{loading ? '…' : MODE_LABEL[mode]}</p>
      )}
      <p id={helpId} className="m-0 text-xs text-muted-foreground">
        {/* Checkpoint 11 ruling 3: the module's bundle, not an English literal. */}
        {mode === 'inherit'
          ? tl('displayModeRow.help.inherit')
          : mode === 'none'
            ? tl('displayModeRow.help.none')
            : tl('displayModeRow.help.format', { mode: MODE_LABEL[mode] })}
      </p>
      {shownError ? (
        <p id={errorId} className="m-0 text-xs text-destructive">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Info } from 'lucide-react';
import { ApiError, apiClient, cn } from '@endora-commerce/admin-kit/lib';
import { CategoryTreePicker, ModalDialog } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { lookupProductLabels, type ProductLabel } from '../lib/product-labels.js';
import { unchangedResultCount } from '../lib/bulk-result-outcome.js';

/**
 * Feature 022 — Products Bulk Edit dialog.
 *
 * Rendered as a fixed-overlay panel on top of the products list when the
 * admin clicks "Bulk Edit" from the selection toolbar. Each field-group
 * starts in an "untouched" state — only modified fields are sent to the
 * backend. Attributes flagged `mass_editable=true` are fetched once on
 * open via `/attributes/by-flag?flag=isMassEditable`.
 *
 * Feature 155 (US5; FR-003, FR-004, FR-034) — a "Returnable" group sets the flag on every
 * selected product. Products are not returnable until marked, existing ones included, so
 * the group carries a standing hint saying so: this is where an operator fixes that.
 *
 * Bulk **Archive** / **Restore** (feature 163). The request carries `fields.archived`
 * and nothing else — the route refuses it beside any other field — so it is not one
 * of the "touched" field groups that Apply combines: it is its own action below them,
 * confirmed in a second step, offered only while no field is touched. The host passes the one that changes something for the
 * selection (`archiveAction`), or `null` for an operator without `catalog:write`.
 * `initialStep="confirmArchive"` opens the dialog on that confirmation (the Archived
 * tab's own Restore button): there is no form behind it, so its Back reads Cancel.
 *
 * **Status in one channel** (feature 163, US5; FR-050–FR-052). One channel, optionally
 * one of its languages, and Active, Inactive or Use inherited — sent as
 * `fields.scopedStatus`. The route refuses it beside `fields.status`, so each of the two
 * groups is disabled while the other is touched, with the reason beside it. The result
 * names the products skipped as not in the channel (`scope_invalid`, never added to it)
 * or refused by the completeness check (`completeness_gate`), and those switched on with
 * values missing (`warn` mode: a succeeded row carrying `details.code = 'SCOPE_INCOMPLETE'`).
 *
 * **On the kit's controls** (issue #1492, UX audit slice S14). `Button`, `Checkbox`,
 * `Select`, `Input`, `Alert` and `Table`, and Tailwind utilities, where the legacy
 * `b2b-*` classes and inline styles were. Three controls changed shape, because the old
 * one said its state by colour alone: *Add* / *Replace* is a radio group, a sales
 * channel is a labelled checkbox, and the result tiles carry their tone in a border
 * beside a label rather than in the number's colour. Visibility reads in words.
 */

const VISIBILITY_OPTIONS: readonly BulkVisibility[] = ['public', 'logged_in_only', 'organization_restricted'];

type BulkStatus = 'active' | 'inactive';
type ScopedStatusValue = 'active' | 'inactive' | 'inherit';
export type BulkArchiveAction = 'archive' | 'restore';
type BulkVisibility = 'public' | 'logged_in_only' | 'organization_restricted';
type BulkMode = 'add' | 'replace';

interface AdminAttributeSummary {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
}

interface SalesChannel {
  id: string;
  code: string;
  name: Record<string, string> | string;
}

function channelLabel(c: SalesChannel): string {
  return typeof c.name === 'string' ? c.name : (c.name['en-US'] ?? c.name['pl-PL'] ?? c.code);
}

/** A channel's languages, loaded when it is chosen: the list endpoint does not carry them. */
type ChannelLanguages = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; codes: string[] };

/** The scope a scoped-status request named, kept to say it in the result. */
interface SentScope {
  channelName: string;
  languageCode: string | null;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  slug: string;
  name: Record<string, string>;
  sortOrder: number;
}

interface AttributeSetSummary {
  id: string;
  code: string;
  name: Record<string, string>;
}

interface BulkUpdateResultRow {
  productId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  reason?: string;
  details?: { code?: string; message?: string; attribute?: string };
  changedFields?: string[];
}

interface BulkUpdateSyncData {
  bulkOperationId: string;
  summary: { succeeded: number; skipped: number; failed: number; total: number };
  results: BulkUpdateResultRow[];
}

interface BulkUpdateQueuedData {
  queued: true;
  bulkOperationId: string;
  total: number;
}

interface BulkUpdateResponse {
  data: BulkUpdateSyncData | BulkUpdateQueuedData;
}

function isQueued(data: BulkUpdateSyncData | BulkUpdateQueuedData): data is BulkUpdateQueuedData {
  return 'queued' in data && data.queued === true;
}

export interface ProductsBulkEditDialogProps {
  productIds: string[];
  /** Feature 033 — whether ids came from page-only or full filtered collection. */
  selectionScope?: 'page' | 'collection';
  onClose: () => void;
  /** Invoked after a successful apply so the parent can refresh the list. */
  onApplied?: () => void;
  /** The archive action offered for this selection; `null`/absent offers none. */
  archiveAction?: BulkArchiveAction | null;
  /** Open on the archive action's confirmation instead of the form. */
  initialStep?: 'form' | 'confirmArchive';
  /**
   * Names and SKUs the caller already holds (the page's rows), by product id. A reported
   * product missing here — a "select all N" selection — is looked up (D3).
   */
  productLabels?: Readonly<Record<string, ProductLabel>>;
}

/** A result row the summary lists: not succeeded, or succeeded with values missing. */
export function isReportedResult(r: BulkUpdateResultRow): boolean {
  return r.status !== 'succeeded' || r.details?.code === 'SCOPE_INCOMPLETE';
}

export function ProductsBulkEditDialog(props: ProductsBulkEditDialogProps): ReactNode {
  const t = useTranslation('catalog');
  const {
    productIds,
    selectionScope,
    onClose,
    onApplied,
    archiveAction = null,
    initialStep = 'form',
    productLabels,
  } = props;
  const openedOnConfirm = initialStep === 'confirmArchive' && archiveAction !== null;
  const formId = useId();
  const returnableRadioName = `${formId}-returnable`;
  const returnableHintId = `${formId}-returnable-hint`;
  const archiveHintId = `${formId}-archive-hint`;
  const archiveConfirmBodyId = `${formId}-archive-confirm`;

  // Touched flags — a field is sent to the backend only when its touched
  // flag is true. Default values are placeholders that are NOT sent.
  const [touchStatus, setTouchStatus] = useState(false);
  const [status, setStatus] = useState<BulkStatus>('active');

  const [touchScoped, setTouchScoped] = useState(false);
  const [scopedChannelId, setScopedChannelId] = useState('');
  // '' = every language of the channel: the channel-level override.
  const [scopedLanguage, setScopedLanguage] = useState('');
  // D19 — no default value: the operator chooses one ('' = not chosen yet).
  const [scopedValue, setScopedValue] = useState<ScopedStatusValue | ''>('');
  const [scopedChannelMissing, setScopedChannelMissing] = useState(false);
  const [scopedValueMissing, setScopedValueMissing] = useState(false);
  const scopedValueRef = useRef<HTMLSelectElement | null>(null);
  const [languagesByChannel, setLanguagesByChannel] = useState<Record<string, ChannelLanguages>>({});
  const scopedChannelRef = useRef<HTMLSelectElement | null>(null);

  const [touchVisibility, setTouchVisibility] = useState(false);
  const [visibility, setVisibility] = useState<BulkVisibility>('public');

  const [touchChannels, setTouchChannels] = useState(false);
  const [channelsMode, setChannelsMode] = useState<BulkMode>('add');
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const [touchCategories, setTouchCategories] = useState(false);
  const [categoriesMode, setCategoriesMode] = useState<BulkMode>('add');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [touchReturnable, setTouchReturnable] = useState(false);
  // Defaults to "returnable": marking products returnable is what the group is for.
  const [returnable, setReturnable] = useState(true);

  const [touchAttributeSet, setTouchAttributeSet] = useState(false);
  // '' represents "no attribute set" (cleared); a uuid assigns that set.
  const [attributeSetId, setAttributeSetId] = useState<string>('');

  const [attributeValues, setAttributeValues] = useState<Record<string, unknown>>({});
  const [touchedAttrs, setTouchedAttrs] = useState<Set<string>>(new Set());

  // Catalog metadata fetched on open.
  const [attrs, setAttrs] = useState<AdminAttributeSummary[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [attributeSets, setAttributeSets] = useState<AttributeSetSummary[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUpdateSyncData | null>(null);
  const [queued, setQueued] = useState<BulkUpdateQueuedData | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(openedOnConfirm);
  const [sentScope, setSentScope] = useState<SentScope | null>(null);
  // What the result on screen came from — the archive summary also names the
  // products that were already in the requested state.
  const [sentArchive, setSentArchive] = useState<BulkArchiveAction | null>(null);
  // D3 — the result names each reported product by name and SKU: what the caller holds,
  // and a lookup of the rest.
  const [labels, setLabels] = useState<Readonly<Record<string, ProductLabel>>>(() => productLabels ?? {});
  useEffect(() => {
    if (!result) return undefined;
    const missing = [...new Set(result.results.filter(isReportedResult).map((r) => r.productId))].filter(
      (id) => !labels[id],
    );
    if (missing.length === 0) return undefined;
    let cancelled = false;
    void lookupProductLabels(missing).then((found) => {
      if (!cancelled && Object.keys(found).length > 0) setLabels((prev) => ({ ...prev, ...found }));
    });
    return (): void => {
      cancelled = true;
    };
    // `labels` is read, not followed: a lookup runs once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // The control that started the request unmounts with its step, so focus moves
  // to the outcome's heading rather than falling to the page.
  const outcomeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (result || queued) outcomeHeadingRef.current?.focus();
  }, [result, queued]);

  // Load mass-editable attributes + channel / category metadata on mount.
  useEffect(() => {
    let cancelled = false;
    // Fire-and-forget: the body catches its own errors.
    void (async (): Promise<void> => {
      try {
        const [attrRes, chRes, catRes, setRes] = await Promise.all([
          apiClient.get<{ data: { items: AdminAttributeSummary[] } }>(
            '/api/v1/admin/catalog/attributes/by-flag?flag=isMassEditable',
          ),
          // The sales-channels list endpoint returns `{ items }` (not `{ data }`);
          // accept either shape so an unexpected envelope can never leave the
          // state holding `undefined` (which would crash the render at
          // `channels.map`).
          apiClient
            .get<{ items?: SalesChannel[]; data?: SalesChannel[] }>('/api/v1/admin/sales-channels')
            .catch((): { items?: SalesChannel[]; data?: SalesChannel[] } => ({ items: [] })),
          apiClient
            .get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories')
            .catch(() => ({ data: [] as AdminCategory[] })),
          apiClient
            .get<{ data: AttributeSetSummary[] }>('/api/v1/admin/catalog/attribute-sets')
            .catch(() => ({ data: [] as AttributeSetSummary[] })),
        ]);
        if (cancelled) return;
        setAttrs(attrRes.data?.items ?? []);
        setChannels(chRes.items ?? chRes.data ?? []);
        setCategories(catRes.data ?? []);
        setAttributeSets(setRes.data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.envelope.error.message : String(e));
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const chooseScopedChannel = useCallback(
    (channelId: string): void => {
      setScopedChannelId(channelId);
      setScopedLanguage('');
      setScopedChannelMissing(false);
      const channel = channels.find((c) => c.id === channelId);
      if (!channel || languagesByChannel[channelId]) return;
      setLanguagesByChannel((prev) => ({ ...prev, [channelId]: { state: 'loading' } }));
      apiClient
        .get<{ languages?: string[] }>(`/api/v1/admin/sales-channels/${encodeURIComponent(channel.code)}`)
        .then((detail): void => {
          setLanguagesByChannel((prev) => ({
            ...prev,
            [channelId]: { state: 'ready', codes: [...(detail.languages ?? [])].sort() },
          }));
        })
        .catch((): void => {
          setLanguagesByChannel((prev) => ({ ...prev, [channelId]: { state: 'failed' } }));
        });
    },
    [channels, languagesByChannel],
  );

  const anyTouched = useMemo(
    () =>
      touchStatus ||
      touchScoped ||
      touchVisibility ||
      touchChannels ||
      touchCategories ||
      touchReturnable ||
      touchAttributeSet ||
      touchedAttrs.size > 0,
    [
      touchStatus,
      touchScoped,
      touchVisibility,
      touchChannels,
      touchCategories,
      touchReturnable,
      touchAttributeSet,
      touchedAttrs,
    ],
  );

  const send = useCallback(
    async (fields: Record<string, unknown>): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await apiClient.post<BulkUpdateResponse>(
          '/api/v1/admin/catalog/products/bulk-update',
          { productIds, fields },
        );
        if (isQueued(res.data)) {
          setQueued(res.data);
        } else {
          setResult(res.data);
        }
        onApplied?.();
        return true;
      } catch (e) {
        if (e instanceof ApiError) {
          const code = e.envelope.error.code;
          if (code === 'ATTRIBUTE_NOT_MASS_EDITABLE') {
            const details = e.envelope.error.details as { attribute?: string } | undefined;
            setError(
              t('productsList.bulkEdit.error.attribute_not_mass_editable', {
                attribute: details?.attribute ?? '?',
              }),
            );
          } else if (code === 'BULK_TOO_LARGE') {
            const details = e.envelope.error.details as
              | { maxBatchSize?: number }
              | undefined;
            setError(
              t('productsList.bulkEdit.error.bulk_too_large', {
                total: productIds.length,
                maxBatchSize: details?.maxBatchSize ?? 200,
              }),
            );
          } else {
            setError(e.envelope.error.message);
          }
        } else {
          setError(String(e));
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [productIds, onApplied, t],
  );

  const submitArchive = useCallback(async (): Promise<void> => {
    if (archiveAction === null) return;
    // `archived` travels alone (R30.3): never combined with a touched field.
    // A failure keeps the confirmation open with its message and a second try.
    if (await send({ archived: archiveAction === 'archive' })) {
      setSentArchive(archiveAction);
      setConfirmingArchive(false);
    }
  }, [archiveAction, send]);

  const submit = useCallback(async (): Promise<void> => {
    if (!anyTouched) {
      setError(t('productsList.bulkEdit.empty'));
      return;
    }
    const fields: Record<string, unknown> = {};
    if (touchStatus) fields.status = status;
    let scope: SentScope | null = null;
    if (touchScoped) {
      if (scopedChannelId === '') {
        setScopedChannelMissing(true);
        scopedChannelRef.current?.focus();
        return;
      }
      if (scopedValue === '') {
        setScopedValueMissing(true);
        scopedValueRef.current?.focus();
        return;
      }
      const languageCode = scopedLanguage === '' ? null : scopedLanguage;
      fields.scopedStatus = { channelId: scopedChannelId, languageCode, value: scopedValue };
      const channel = channels.find((c) => c.id === scopedChannelId);
      scope = { channelName: channel ? channelLabel(channel) : scopedChannelId.slice(0, 8), languageCode };
    }
    if (touchVisibility) fields.visibility = visibility;
    if (touchChannels) {
      fields.salesChannels = { mode: channelsMode, channelIds };
    }
    if (touchCategories) {
      fields.categories = { mode: categoriesMode, categoryIds };
    }
    if (touchReturnable) fields.returnable = returnable;
    if (touchAttributeSet) {
      // '' clears the set (null); a uuid assigns it.
      fields.attributeSetId = attributeSetId === '' ? null : attributeSetId;
    }
    if (touchedAttrs.size > 0) {
      const av: Record<string, unknown> = {};
      for (const k of touchedAttrs) av[k] = attributeValues[k];
      fields.attributeValues = av;
    }
    if (await send(fields)) setSentScope(scope);
  }, [
    anyTouched,
    touchStatus,
    status,
    touchScoped,
    scopedChannelId,
    scopedLanguage,
    scopedValue,
    channels,
    touchVisibility,
    visibility,
    touchChannels,
    channelsMode,
    channelIds,
    touchCategories,
    categoriesMode,
    categoryIds,
    touchReturnable,
    returnable,
    touchAttributeSet,
    attributeSetId,
    touchedAttrs,
    attributeValues,
    send,
    t,
  ]);

  const confirming = confirmingArchive && archiveAction !== null && !result && !queued;
  const editing = !confirming && !result && !queued;
  const editFooter = (
    <>
      <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
        {t('productsList.bulkEdit.action.cancel')}
      </Button>
      <Button
        type="button"
        onClick={(): void => {
          void submit();
        }}
        disabled={submitting || !anyTouched}
        aria-busy={submitting || undefined}
      >
        {t('productsList.bulkEdit.action.apply')}
      </Button>
    </>
  );
  const confirmFooter =
    archiveAction !== null ? (
      <>
        {/* Opened on the confirmation, there is no form to go back to. */}
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={openedOnConfirm ? onClose : (): void => setConfirmingArchive(false)}
        >
          {openedOnConfirm ? t('productsList.bulkEdit.action.cancel') : t('productsList.bulkEdit.action.back')}
        </Button>
        <Button
          type="button"
          disabled={submitting}
          aria-busy={submitting || undefined}
          onClick={(): void => {
            void submitArchive();
          }}
        >
          {t(`productsList.bulkEdit.${archiveAction}.confirm`, { count: productIds.length })}
        </Button>
      </>
    ) : null;

  // One modal root: the archive confirmation is a second step of this dialog, not
  // a dialog over it. Escape on that step goes back to the form, not out of it.
  return (
    <ModalDialog
      title={
        confirming && archiveAction !== null
          ? t(`productsList.bulkEdit.${archiveAction}.confirmTitle`, { count: productIds.length })
          : t('productsList.bulkEdit.title', { count: productIds.length })
      }
      onClose={confirming && !openedOnConfirm ? (): void => setConfirmingArchive(false) : onClose}
      busy={submitting}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      {...(confirming ? { 'aria-describedby': archiveConfirmBodyId } : {})}
      {...(editing ? { footer: editFooter } : confirming && confirmFooter ? { footer: confirmFooter } : {})}
    >
      {selectionScope && editing ? (
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">
          {selectionScope === 'collection'
            ? t('productsList.selection.scopeCollection')
            : t('productsList.selection.scopePage')}
        </p>
      ) : null}

      {/* While confirming, the error is said once, inside the step, as an alert. */}
      {error && !confirming ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {queued ? (
        <BulkEditQueuedAck
          queued={queued}
          archiveAction={sentArchive}
          headingRef={outcomeHeadingRef}
          onClose={onClose}
          t={t}
        />
      ) : result ? (
        <BulkEditSummary
          result={result}
          archiveAction={sentArchive}
          scope={sentScope}
          labels={labels}
          headingRef={outcomeHeadingRef}
          onClose={onClose}
          t={t}
        />
      ) : confirming && archiveAction !== null ? (
        <div>
          <p id={archiveConfirmBodyId} className="text-sm leading-normal">
            {t(`productsList.bulkEdit.${archiveAction}.confirmBody`)}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
          <div className="flex flex-col gap-5">
            <FieldGroup
              label={t('productsList.bulkEdit.section.status')}
              touched={touchStatus}
              onToggle={setTouchStatus}
              disabledReason={touchScoped ? t('productsList.bulkEdit.scopedStatus.notWithScoped') : null}
              t={t}
            >
              <Select
                className="max-w-xs"
                aria-label={t('productsList.bulkEdit.section.status')}
                disabled={!touchStatus}
                value={status}
                onChange={(e): void => setStatus(e.target.value as BulkStatus)}
              >
                <option value="active">{t('productsList.status.active')}</option>
                <option value="inactive">{t('productsList.status.inactive')}</option>
              </Select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.scopedStatus')}
              touched={touchScoped}
              onToggle={(next): void => {
                setTouchScoped(next);
                if (!next) {
                  setScopedChannelMissing(false);
                  setScopedValueMissing(false);
                }
              }}
              disabledReason={touchStatus ? t('productsList.bulkEdit.scopedStatus.notWithStatus') : null}
              asGroup
              t={t}
            >
              <ScopedStatusFields
                idPrefix={formId}
                disabled={!touchScoped}
                channels={channels}
                channelId={scopedChannelId}
                onChannel={chooseScopedChannel}
                channelMissing={scopedChannelMissing}
                channelRef={scopedChannelRef}
                languages={scopedChannelId ? (languagesByChannel[scopedChannelId] ?? null) : null}
                language={scopedLanguage}
                onLanguage={setScopedLanguage}
                value={scopedValue}
                onValue={(next): void => {
                  setScopedValue(next);
                  setScopedValueMissing(false);
                }}
                valueMissing={scopedValueMissing}
                valueRef={scopedValueRef}
                t={t}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.visibility')}
              touched={touchVisibility}
              onToggle={setTouchVisibility}
              t={t}
            >
              <Select
                className="max-w-xs"
                aria-label={t('productsList.bulkEdit.section.visibility')}
                disabled={!touchVisibility}
                value={visibility}
                onChange={(e): void => setVisibility(e.target.value as BulkVisibility)}
              >
                {/* The product editor's words for the same three values, not the stored codes. */}
                {VISIBILITY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`productEditor.visibility.${value}`)}
                  </option>
                ))}
              </Select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.salesChannels')}
              touched={touchChannels}
              onToggle={setTouchChannels}
              t={t}
            >
              <ModePicker
                section={t('productsList.bulkEdit.section.salesChannels')}
                mode={channelsMode}
                onChange={setChannelsMode}
                disabled={!touchChannels}
                t={t}
              />
              <ChannelChecklist
                label={t('productsList.bulkEdit.section.salesChannels')}
                options={channels.map((c) => ({ id: c.id, label: channelLabel(c) }))}
                selected={channelIds}
                onChange={setChannelIds}
                disabled={!touchChannels}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.categories')}
              touched={touchCategories}
              onToggle={setTouchCategories}
              t={t}
            >
              <ModePicker
                section={t('productsList.bulkEdit.section.categories')}
                mode={categoriesMode}
                onChange={setCategoriesMode}
                disabled={!touchCategories}
                t={t}
              />
              <CategoryTreePicker
                categories={categories}
                selectedIds={categoryIds}
                onChange={setCategoryIds}
                disabled={!touchCategories}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.returnable')}
              touched={touchReturnable}
              onToggle={setTouchReturnable}
              t={t}
            >
              <div
                role="radiogroup"
                aria-label={t('productsList.bulkEdit.section.returnable')}
                aria-describedby={returnableHintId}
                className="flex flex-wrap gap-4"
              >
                {([true, false] as const).map((value) => (
                  <label
                    key={String(value)}
                    className={cn(
                      'flex min-h-8 items-center gap-1.5 text-sm',
                      touchReturnable ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <input
                      type="radio"
                      name={returnableRadioName}
                      checked={returnable === value}
                      disabled={!touchReturnable}
                      onChange={(): void => setReturnable(value)}
                    />
                    {value
                      ? t('productsList.bulkEdit.returnable.yes')
                      : t('productsList.bulkEdit.returnable.no')}
                  </label>
                ))}
              </div>
              <p id={returnableHintId} className="text-xs text-muted-foreground">
                {t('productsList.bulkEdit.returnable.hint')}
              </p>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.attributeSet')}
              touched={touchAttributeSet}
              onToggle={setTouchAttributeSet}
              t={t}
            >
              <Select
                className="max-w-xs"
                aria-label={t('productsList.bulkEdit.section.attributeSet')}
                disabled={!touchAttributeSet}
                value={attributeSetId}
                onChange={(e): void => setAttributeSetId(e.target.value)}
              >
                <option value="">{t('productsList.bulkEdit.attributeSet.none')}</option>
                {attributeSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name['en-US'] ?? s.name['pl-PL'] ?? Object.values(s.name)[0] ?? s.code}
                  </option>
                ))}
              </Select>
            </FieldGroup>

            {attrs.length > 0 ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2 p-0 text-sm font-semibold">
                  {t('productsList.bulkEdit.section.attributes')}
                </legend>
                <div className="flex flex-col gap-2.5">
                  {attrs.map((a) => {
                    const touched = touchedAttrs.has(a.key);
                    const label = a.label['en-US'] ?? a.labelDefault;
                    return (
                      <div key={a.id} className="flex items-center gap-2.5 rounded-md bg-muted p-2.5">
                        {/* The label wraps its checkbox, so the name is a target too (Fitts). */}
                        <label className="flex min-h-8 min-w-36 cursor-pointer items-center gap-2.5 text-sm">
                          <Checkbox
                            checked={touched}
                            onChange={(): void => {
                              setTouchedAttrs((prev) => {
                                const next = new Set(prev);
                                if (next.has(a.key)) {
                                  next.delete(a.key);
                                } else {
                                  next.add(a.key);
                                }
                                return next;
                              });
                            }}
                          />
                          <span>{label}</span>
                        </label>
                        <Input
                          type="text"
                          aria-label={label}
                          disabled={!touched}
                          className="flex-1 bg-background"
                          value={(attributeValues[a.key] as string | undefined) ?? ''}
                          onChange={(e): void =>
                            setAttributeValues((prev) => ({ ...prev, [a.key]: e.target.value }))
                          }
                          placeholder={a.valueType}
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {archiveAction !== null ? (
              <section aria-labelledby={`${formId}-archive-title`} className="border-t pt-3.5">
                <h3 id={`${formId}-archive-title`} className="mb-1 text-sm font-semibold">
                  {t(`productsList.bulkEdit.${archiveAction}.title`)}
                </h3>
                <p id={archiveHintId} className="mb-2 text-xs text-muted-foreground">
                  {anyTouched
                    ? t('productsList.bulkEdit.archiveAlone')
                    : t(`productsList.bulkEdit.${archiveAction}.hint`)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-describedby={archiveHintId}
                  disabled={anyTouched || submitting}
                  onClick={(): void => setConfirmingArchive(true)}
                >
                  {archiveAction === 'archive' ? (
                    <Archive aria-hidden="true" />
                  ) : (
                    <ArchiveRestore aria-hidden="true" />
                  )}
                  {t(`productsList.bulkEdit.${archiveAction}.action`, { count: productIds.length })}
                </Button>
              </section>
            ) : null}
          </div>
      )}
    </ModalDialog>
  );
}

interface FieldGroupProps {
  label: string;
  touched: boolean;
  onToggle: (next: boolean) => void;
  t: ReturnType<typeof useTranslation>;
  children: ReactNode;
  /** Why the group cannot be touched now; the checkbox is disabled and described by it. */
  disabledReason?: string | null;
  /** Render as a `fieldset` named by its checkbox label (a group of several controls). */
  asGroup?: boolean;
}

function FieldGroup(props: FieldGroupProps): ReactNode {
  const reasonId = useId();
  const blocked = Boolean(props.disabledReason) && !props.touched;
  const header = (
    <label
      className={cn(
        'mb-1.5 flex min-h-8 items-center gap-2 text-sm font-semibold',
        blocked ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <Checkbox
        checked={props.touched}
        disabled={blocked}
        {...(blocked ? { 'aria-describedby': reasonId } : {})}
        onChange={(e): void => props.onToggle(e.target.checked)}
      />
      {props.label}
      {!props.touched ? (
        <span className="text-xs font-normal text-muted-foreground">
          {props.t('productsList.bulkEdit.untouched')}
        </span>
      ) : null}
    </label>
  );
  const body = (
    <div className="flex flex-col gap-1.5 pl-6">
      {blocked ? (
        <p id={reasonId} className="m-0 text-xs text-muted-foreground">
          {props.disabledReason}
        </p>
      ) : null}
      {props.children}
    </div>
  );
  if (props.asGroup) {
    return (
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="p-0">{header}</legend>
        {body}
      </fieldset>
    );
  }
  return (
    <div>
      {header}
      {body}
    </div>
  );
}

interface ScopedStatusFieldsProps {
  idPrefix: string;
  disabled: boolean;
  channels: SalesChannel[];
  channelId: string;
  onChannel: (channelId: string) => void;
  channelMissing: boolean;
  channelRef: RefObject<HTMLSelectElement | null>;
  /** The chosen channel's languages; `null` before a channel is chosen. */
  languages: ChannelLanguages | null;
  language: string;
  onLanguage: (code: string) => void;
  value: ScopedStatusValue | '';
  onValue: (value: ScopedStatusValue | '') => void;
  /** Set when Apply was pressed without a value (D19). */
  valueMissing: boolean;
  valueRef: RefObject<HTMLSelectElement | null>;
  t: ReturnType<typeof useTranslation>;
}

/**
 * Channel first, because the languages depend on it; then the language, which defaults to
 * the whole channel; then the value. Three labelled native selects (Jakob), one help line
 * saying what switching on checks, so a gate result is not a surprise.
 */
function ScopedStatusFields(props: ScopedStatusFieldsProps): ReactNode {
  const { idPrefix, t } = props;
  const channelId = `${idPrefix}-scoped-channel`;
  const channelErrorId = `${idPrefix}-scoped-channel-error`;
  const languageId = `${idPrefix}-scoped-language`;
  const languageHelpId = `${idPrefix}-scoped-language-help`;
  const valueId = `${idPrefix}-scoped-value`;
  const valueErrorId = `${idPrefix}-scoped-value-error`;
  const gateHelpId = `${idPrefix}-scoped-gate-help`;
  const loadingLanguages = props.languages?.state === 'loading';
  const codes = props.languages?.state === 'ready' ? props.languages.codes : [];
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={channelId} className="text-xs">
          {t('productsList.bulkEdit.scopedStatus.channel')}
        </Label>
        <Select
          id={channelId}
          ref={props.channelRef}
          disabled={props.disabled}
          value={props.channelId}
          aria-invalid={props.channelMissing || undefined}
          {...(props.channelMissing ? { 'aria-describedby': channelErrorId } : {})}
          onChange={(e): void => props.onChannel(e.target.value)}
        >
          <option value="">{t('productsList.bulkEdit.scopedStatus.channelPlaceholder')}</option>
          {props.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {channelLabel(c)}
            </option>
          ))}
        </Select>
        {props.channelMissing ? (
          <p id={channelErrorId} role="alert" className="m-0 text-xs text-destructive">
            {t('productsList.bulkEdit.scopedStatus.channelRequired')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={languageId} className="text-xs">
          {t('productsList.bulkEdit.scopedStatus.language')}
        </Label>
        <Select
          id={languageId}
          disabled={props.disabled || props.channelId === '' || loadingLanguages}
          aria-busy={loadingLanguages || undefined}
          aria-describedby={languageHelpId}
          value={props.language}
          onChange={(e): void => props.onLanguage(e.target.value)}
        >
          <option value="">{t('productsList.bulkEdit.scopedStatus.allLanguages')}</option>
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
        <p id={languageHelpId} className="m-0 text-xs text-muted-foreground">
          {props.languages?.state === 'failed'
            ? t('productsList.bulkEdit.scopedStatus.languagesFailed')
            : loadingLanguages
              ? t('productsList.bulkEdit.scopedStatus.languagesLoading')
              : t('productsList.bulkEdit.scopedStatus.languageHelp')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={valueId} className="text-xs">
          {t('productsList.bulkEdit.scopedStatus.value')}
        </Label>
        <Select
          id={valueId}
          ref={props.valueRef}
          disabled={props.disabled}
          aria-describedby={props.valueMissing ? `${valueErrorId} ${gateHelpId}` : gateHelpId}
          aria-invalid={props.valueMissing || undefined}
          value={props.value}
          onChange={(e): void => props.onValue(e.target.value as ScopedStatusValue | '')}
        >
          <option value="" disabled>
            {t('productsList.bulkEdit.scopedStatus.valuePlaceholder')}
          </option>
          <option value="active">{t('productsList.status.active')}</option>
          <option value="inactive">{t('productsList.status.inactive')}</option>
          <option value="inherit">{t('productsList.bulkEdit.scopedStatus.inherit')}</option>
        </Select>
        {props.valueMissing ? (
          <p id={valueErrorId} role="alert" className="m-0 text-xs text-destructive">
            {t('productsList.bulkEdit.scopedStatus.valueRequired')}
          </p>
        ) : null}
      </div>
      <p id={gateHelpId} className="col-span-full m-0 text-xs text-muted-foreground">
        {t('productsList.bulkEdit.scopedStatus.gateHelp')}
      </p>
    </div>
  );
}

interface ModePickerProps {
  /** The group's section label, which names the choice ("Sales channels: add or replace"). */
  section: string;
  mode: BulkMode;
  onChange: (next: BulkMode) => void;
  disabled: boolean;
  t: ReturnType<typeof useTranslation>;
}

/**
 * *Add* or *Replace* — one choice of two, so a radio group (Jakob): it was two buttons,
 * the chosen one filled, which said the mode by colour alone (WCAG 1.4.1).
 */
function ModePicker(props: ModePickerProps): ReactNode {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={props.t('productsList.bulkEdit.mode.label', { section: props.section })}
      className="flex flex-wrap gap-4"
    >
      {(['add', 'replace'] as const).map((m) => (
        <label
          key={m}
          className={cn('flex min-h-8 items-center gap-1.5 text-sm', props.disabled ? 'cursor-default' : 'cursor-pointer')}
        >
          <input
            type="radio"
            name={name}
            checked={props.mode === m}
            disabled={props.disabled}
            onChange={(): void => props.onChange(m)}
          />
          {props.t(`productsList.bulkEdit.mode.${m}`)}
        </label>
      ))}
    </div>
  );
}

interface ChannelChecklistProps {
  /** Names the group of checkboxes. */
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * The sales channels as labelled checkboxes — the shape `CategoryTreePicker` beside it
 * already has (Similarity). They were buttons whose chosen state was only a fill.
 */
function ChannelChecklist(props: ChannelChecklistProps): ReactNode {
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-x-4 gap-y-1">
      {props.options.map((o) => {
        const checked = props.selected.includes(o.id);
        return (
          <label
            key={o.id}
            className={cn('flex min-h-8 items-center gap-2 text-sm', props.disabled ? 'cursor-default' : 'cursor-pointer')}
          >
            <Checkbox
              checked={checked}
              disabled={props.disabled}
              onChange={(): void => {
                props.onChange(checked ? props.selected.filter((x) => x !== o.id) : [...props.selected, o.id]);
              }}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

interface BulkEditQueuedAckProps {
  queued: BulkUpdateQueuedData;
  archiveAction: BulkArchiveAction | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

function BulkEditQueuedAck(props: BulkEditQueuedAckProps): ReactNode {
  const prefix = props.archiveAction ? `productsList.bulkEdit.${props.archiveAction}` : 'productsList.bulkEdit';
  return (
    <div className="flex flex-col gap-3.5">
      <Alert>
        <Info aria-hidden="true" />
        <div>
          <h3 ref={props.headingRef} tabIndex={-1} className="text-sm font-semibold">
            {props.t(`${prefix}.queued.title`)}
          </h3>
          <AlertDescription className="mt-1">
            {props.t(`${prefix}.queued.body`, { total: props.queued.total })}
          </AlertDescription>
        </div>
      </Alert>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="flex flex-wrap gap-2">
          {/* A queued run is persisted: its page holds the per-product record and Undo. */}
          <Button asChild variant="outline">
            <Link to={`/catalog/bulk-operations/${props.queued.bulkOperationId}`} onClick={props.onClose}>
              {props.t('productsList.bulkEdit.viewOperation')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/catalog/bulk-operations" onClick={props.onClose}>
              {props.t('productsList.bulkEdit.queued.viewAll')}
            </Link>
          </Button>
        </span>
        <Button type="button" onClick={props.onClose}>
          {props.t('productsList.bulkEdit.action.close')}
        </Button>
      </div>
    </div>
  );
}

interface BulkEditSummaryProps {
  result: BulkUpdateSyncData;
  /** Set when the result is a bulk Archive / Restore. */
  archiveAction: BulkArchiveAction | null;
  /** Set when the result is a status in one channel. */
  scope: SentScope | null;
  /** Names and SKUs by product id; an id missing here is shown shortened. */
  labels: Readonly<Record<string, ProductLabel>>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

/**
 * Products already in the requested state succeed with nothing changed; the archive
 * summary says how many, so "Succeeded" is not read as "all of them moved".
 */
export function unchangedArchiveCount(results: readonly BulkUpdateResultRow[]): number {
  return unchangedResultCount(results);
}

function BulkEditSummary(props: BulkEditSummaryProps): ReactNode {
  const { summary, results } = props.result;
  const unchanged = props.archiveAction ? unchangedArchiveCount(results) : 0;
  const reported = results.filter(isReportedResult);
  const savedIncomplete = results.filter((r) => r.status === 'succeeded' && r.details?.code === 'SCOPE_INCOMPLETE').length;
  const t = props.t;
  const scopeName = props.scope
    ? props.scope.languageCode
      ? t('productsList.bulkEdit.scopedStatus.scopeLanguage', {
          channel: props.scope.channelName,
          language: props.scope.languageCode,
        })
      : t('productsList.bulkEdit.scopedStatus.scopeChannel', { channel: props.scope.channelName })
    : null;
  const reasonText = (r: BulkUpdateResultRow): string => {
    if (r.status === 'succeeded') return t('productsList.bulkEdit.result.savedIncomplete');
    return r.reason ? t(`productsList.bulkEdit.reason.${r.reason}`) : '';
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 ref={props.headingRef} tabIndex={-1} className="text-sm font-semibold">
          {props.archiveAction
            ? props.t(`productsList.bulkEdit.${props.archiveAction}.done`, {
                count: summary.succeeded - unchanged,
              })
            : scopeName
              ? t('productsList.bulkEdit.scopedStatus.done', { scope: scopeName })
              : props.t('productsList.bulkEdit.summary.title')}
        </h3>
        {props.archiveAction && unchanged > 0 ? (
          <p className="text-xs text-muted-foreground">
            {props.t(`productsList.bulkEdit.${props.archiveAction}.unchanged`, { count: unchanged })}
          </p>
        ) : null}
        {savedIncomplete > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('productsList.bulkEdit.result.savedIncompleteCount', { count: savedIncomplete })}
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label={props.t('productsList.bulkEdit.summary.succeeded')} count={summary.succeeded} tone="success" />
        <SummaryTile label={props.t('productsList.bulkEdit.summary.skipped')} count={summary.skipped} tone="warning" />
        <SummaryTile label={props.t('productsList.bulkEdit.summary.failed')} count={summary.failed} tone="destructive" />
        <SummaryTile label={props.t('productsList.bulkEdit.summary.total')} count={summary.total} tone="neutral" />
      </dl>

      {reported.length > 0 ? (
        // The rows scroll inside a bounded frame, so the dialog keeps its Close in view.
        <div className="max-h-64 overflow-auto rounded-md border">
          <Table aria-label={t('productsList.bulkEdit.result.caption')}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('productsList.bulkEdit.result.product')}</TableHead>
                <TableHead scope="col">{t('productsList.bulkEdit.result.status')}</TableHead>
                <TableHead scope="col">{t('productsList.bulkEdit.result.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reported.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell>
                    {/* A scoped-status row opens where the product's scopes are edited. */}
                    <Link
                      to={`/catalog/products/${r.productId}${props.scope ? '?scopeMap=1' : ''}`}
                      className="text-primary hover:underline"
                    >
                      {props.labels[r.productId]?.name || `${r.productId.slice(0, 8)}…`}
                    </Link>
                    {props.labels[r.productId] ? (
                      <div className="font-mono text-xs text-muted-foreground">{props.labels[r.productId]!.sku}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{t(`productsList.bulkEdit.summary.${r.status}`)}</TableCell>
                  <TableCell>
                    {reasonText(r)}
                    {r.details?.attribute ? ` (${r.details.attribute})` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* An inline run is not persisted as an operation, so there is no page to link. */}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={props.onClose}>
          {props.t('productsList.bulkEdit.action.close')}
        </Button>
      </div>
    </div>
  );
}

type SummaryTone = 'success' | 'warning' | 'destructive' | 'neutral';

/** The tone is a border beside a label, not the number's colour: a yellow numeral fails contrast. */
const SUMMARY_TONE: Record<SummaryTone, string> = {
  success: 'border-l-[var(--success)]',
  warning: 'border-l-[var(--warn)]',
  destructive: 'border-l-destructive',
  neutral: 'border-l-border',
};

function SummaryTile(props: { label: string; count: number; tone: SummaryTone }): ReactNode {
  return (
    <div className={cn('rounded-md border-l-4 bg-muted px-3 py-2.5', SUMMARY_TONE[props.tone])}>
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{props.count}</dd>
    </div>
  );
}

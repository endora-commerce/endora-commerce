import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import {
  feedOutputFormatSchema,
  isTabularFeedFormat,
  type FeedFieldSourceCatalogue,
  type FeedFieldSourceKind,
  type FeedOutputFormat,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { useViewportTier } from '@/components/hooks/useViewportTier';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import {
  productFeedsClient,
  type FeedTemplateDetail,
  type TemplatePreview,
  type TemplateSaveWarning,
} from './api';
import {
  draftFromTemplate,
  newDraftField,
  nextFieldId,
  problemsByField,
  toWriteFields,
  validateDraft,
  type DraftField,
  type TemplateDraft,
} from './template-draft';
import { NeedsAttentionBar } from './components/NeedsAttentionBar';
import { TemplateFieldInspector } from './components/TemplateFieldInspector';
import { TemplateFieldList } from './components/TemplateFieldList';
import {
  PreviewCallToAction,
  TemplatePreviewController,
  TemplatePreviewVerdict,
  type PreviewSelection,
} from './components/TemplatePreviewController';

/**
 * The template structure editor — ux-design §2.7, FR-067–FR-076.
 *
 * The product owner's requirement, in their words, was that "modifying and
 * building a template must be simple and understandable" for a marketing
 * person. The answer is **not** a canvas: a feed is a flat, ordered list of
 * named columns and has no second dimension to arrange anything in. So the
 * editor is an ordered list of field rows, a single-field inspector, and — the
 * part that actually does the teaching — a live preview column showing the real
 * value a real product would send, next to every field.
 *
 * Everything else here follows from two rules:
 *
 *  - **the operator never sees the file's mechanics** (FR-075). No XML, no
 *    namespaces, no delimiters, no escaping, ever.
 *  - **`Save` is never disabled for validation reasons** (§3.6). Problems are
 *    surfaced continuously; pressing `Save` with problems sends no request,
 *    selects the first offender and says so out loud.
 */

const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Sources no one-cell-per-field format can express.
 *
 * A repeated element is an XML shape. CSV, TSV, TXT and XLSX all lay one item
 * across fixed columns, so a field that resolves to a list has nowhere to go —
 * the constraint is about the row model, not about the delimiter, which is why
 * the workbook format is subject to it too.
 */
const TABULAR_UNSUPPORTED: FeedFieldSourceKind[] = ['additional_image_link'];

export function FeedTemplateEditorPage(): ReactNode {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useTranslation('product_feeds');
  const { hasPermission } = useAuth();
  const tier = useViewportTier();

  const canWrite = hasPermission('product_feeds:write');
  const [template, setTemplate] = useState<FeedTemplateDetail | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [catalogue, setCatalogue] = useState<FeedFieldSourceCatalogue | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /**
   * The import flow lands here with the needs-attention filter already on
   * (ux-design §2.9, step 3): the fields it could not bind are the operator's
   * remaining task, and an editor that opened on the full list would hide them
   * behind a scroll.
   */
  const [showOnlyProblems, setShowOnlyProblems] = useState(
    (location.state as { showOnlyProblems?: boolean } | null)?.showOnlyProblems === true,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<TemplateSaveWarning[] | null>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeq = useRef(0);

  const readOnly = !canWrite || (template?.isSystem ?? false);
  const disabledTitle = !canWrite ? t('permission.needWrite') : undefined;

  // --- Load ----------------------------------------------------------------

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [loaded, sources] = await Promise.all([
          productFeedsClient.getTemplate(templateId),
          productFeedsClient.listFieldSources(),
        ]);
        if (cancelled) return;
        setTemplate(loaded.data);
        setDraft(draftFromTemplate(loaded.data));
        setSelectedFieldId(loaded.data.fields[0]?.id ?? null);
        setCatalogue(sources.data);
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError ? err.envelope.error.message : t('builder.loadFailed'),
        );
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [templateId, t]);

  // --- Validation (continuous, never only on save) -------------------------

  const knownSourceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of catalogue?.groups ?? []) {
      for (const source of group.sources) if (source.sourceKey) keys.add(source.sourceKey);
    }
    return keys;
  }, [catalogue]);

  const problems = useMemo(() => {
    if (!draft) return [];
    return validateDraft(draft, {
      outputFormat: draft.outputFormat,
      itemGranularity: draft.itemGranularity,
      taxonomyProviderCode: draft.taxonomyProviderCode,
      unsupportedSourceKinds: new Set(
        isTabularFeedFormat(draft.outputFormat) ? TABULAR_UNSUPPORTED : [],
      ),
      knownSourceKeys,
      providerLabel: providerLabel(draft.providerCode),
    });
  }, [draft, knownSourceKeys]);

  const problemMap = useMemo(() => problemsByField(problems), [problems]);

  // --- Preview (the draft on screen, debounced) ----------------------------

  useEffect(() => {
    if (!draft || !previewSelection) {
      setPreview(null);
      return;
    }
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await productFeedsClient.previewTemplate({
            ...(templateId ? { baseTemplateId: templateId } : {}),
            draft: {
              providerCode: draft.providerCode,
              outputFormat: draft.outputFormat,
              itemGranularity: draft.itemGranularity,
              taxonomyProviderCode: draft.taxonomyProviderCode,
              fields: toWriteFields(draft.fields),
            },
            productId: previewSelection.productId,
            ...(previewSelection.variantId ? { variantId: previewSelection.variantId } : {}),
          });
          if (previewSeq.current !== seq) return;
          setPreview(res.data);
          setPreviewError(null);
        } catch (err: unknown) {
          if (previewSeq.current !== seq) return;
          setPreview(null);
          setPreviewError(
            err instanceof ApiError ? err.envelope.error.message : t('builder.preview.failed'),
          );
        } finally {
          if (previewSeq.current === seq) setPreviewLoading(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return (): void => window.clearTimeout(timer);
  }, [draft, previewSelection, templateId, t]);

  // --- Editing -------------------------------------------------------------

  const patchDraft = useCallback((over: Partial<TemplateDraft>): void => {
    setSaved(false);
    setDraft((current) => (current ? { ...current, ...over } : current));
  }, []);

  const updateField = useCallback(
    (next: DraftField): void => {
      setSaved(false);
      setDraft((current) =>
        current
          ? {
              ...current,
              fields: current.fields.map((field) => (field.id === next.id ? next : field)),
            }
          : current,
      );
    },
    [],
  );

  const addField = (): void => {
    if (!draft) return;
    const field = newDraftField(uniqueName(draft.fields, t('builder.newFieldName')));
    patchDraft({ fields: [...draft.fields, field] });
    setSelectedFieldId(field.id);
  };

  const duplicateField = (fieldId: string): void => {
    if (!draft) return;
    const source = draft.fields.find((field) => field.id === fieldId);
    if (!source) return;
    const copy: DraftField = {
      ...source,
      id: nextFieldId(),
      outputName: uniqueName(draft.fields, source.outputName),
    };
    const index = draft.fields.indexOf(source);
    const fields = [...draft.fields];
    fields.splice(index + 1, 0, copy);
    patchDraft({ fields });
    setSelectedFieldId(copy.id);
  };

  const removeField = (fieldId: string): void => {
    if (!draft) return;
    const field = draft.fields.find((entry) => entry.id === fieldId);
    if (!field) return;
    if (field.providerRequired) {
      // FR-074 — never silently, never hard-blocked: the consequence is named
      // and the safe button holds focus.
      setPendingRemoval([{ code: 'provider_required_field_removed', outputName: field.outputName }]);
      setSelectedFieldId(fieldId);
      return;
    }
    patchDraft({ fields: draft.fields.filter((entry) => entry.id !== fieldId) });
  };

  const confirmRemoval = (): void => {
    if (!draft || !pendingRemoval) return;
    const names = new Set(pendingRemoval.map((warning) => warning.outputName));
    patchDraft({ fields: draft.fields.filter((field) => !names.has(field.outputName)) });
    setPendingRemoval(null);
  };

  // --- Save ----------------------------------------------------------------

  const save = async (options: { acknowledgeWarnings?: boolean } = {}): Promise<void> => {
    if (!draft || !template) return;
    if (problems.length > 0) {
      // No request is sent; the first offender is selected instead, and the
      // live region says how many there are (ux-design §3.6).
      const first = problems[0]!;
      setSelectedFieldId(first.fieldId);
      setShowOnlyProblems(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await productFeedsClient.updateTemplate(
        template.id,
        template.version,
        {
          // Trimmed to match how the contract validates it, so a stray space
          // does not become part of the stored name.
          name: draft.name.trim(),
          description: draft.description,
          providerCode: draft.providerCode,
          outputFormat: draft.outputFormat,
          itemGranularity: draft.itemGranularity,
          taxonomyProviderCode: draft.taxonomyProviderCode,
          fields: toWriteFields(draft.fields),
        },
        options,
      );
      setTemplate(res.data);
      setDraft(draftFromTemplate(res.data));
      setSaved(true);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
        // Silent last-write-wins is forbidden by the spec; silently losing
        // fifteen minutes of work is forbidden by everything else (FR-076).
        setConflict(true);
      } else if (
        err instanceof ApiError &&
        err.envelope.error.code === 'PRODUCT_FEED_CONFIRMATION_REQUIRED'
      ) {
        const details = err.envelope.error.details as
          | { warnings?: TemplateSaveWarning[] }
          | undefined;
        setPendingRemoval(details?.warnings ?? []);
      } else {
        setSaveError(
          err instanceof ApiError ? err.envelope.error.message : t('builder.error.saveFailed'),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const saveAsNewTemplate = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      const created = await productFeedsClient.createTemplate({
        name: t('templates.copySuffix', { name: draft.name }),
        description: draft.description,
        providerCode: draft.providerCode,
        outputFormat: draft.outputFormat,
        itemGranularity: draft.itemGranularity,
        taxonomyProviderCode: draft.taxonomyProviderCode,
        fields: toWriteFields(draft.fields),
      });
      navigate(`/product-feeds/templates/${created.data.id}`);
    } catch (err: unknown) {
      setSaveError(
        err instanceof ApiError ? err.envelope.error.message : t('builder.error.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  // --- Render --------------------------------------------------------------

  if (loadError !== null) {
    return (
      <div>
        <PageHeader
          title={t('templates.title')}
          back={{ label: t('templates.title'), to: '/product-feeds/templates' }}
        />
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!draft || !template) {
    return (
      <div>
        <PageHeader
          title={t('builder.title')}
          back={{ label: t('templates.title'), to: '/product-feeds/templates' }}
        />
        <p className="b2b-help">{t('feeds.criteria.counting')}</p>
      </div>
    );
  }

  const visibleFields = showOnlyProblems
    ? draft.fields.filter((field) => (problemMap[field.id] ?? []).length > 0 || field.unbound)
    : draft.fields;
  const selectedField = draft.fields.find((field) => field.id === selectedFieldId) ?? null;
  const removed = pendingRemoval;

  return (
    <div>
      <PageHeader
        title={draft.name}
        description={t('builder.summary', {
          format: draft.outputFormat.toUpperCase(),
          granularity: t(`builder.granularity.${draft.itemGranularity}`),
        })}
        back={{ label: t('templates.title'), to: '/product-feeds/templates' }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TemplatePreviewController
              selection={previewSelection}
              onSelect={setPreviewSelection}
            />
            {/* FR-012 — the portability document, as a plain download. An
                anchor rather than a fetch, so the filename comes from the
                server's `Content-Disposition` and nothing is held in memory. */}
            <a
              href={productFeedsClient.templateExportUrl(template.id)}
              className="b2b-btn b2b-btn--ghost inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm underline-offset-2 hover:underline"
            >
              {t('templates.export')}
            </a>
            <Button
              type="button"
              disabled={saving || readOnly}
              title={readOnly ? (disabledTitle ?? t('templates.systemTemplate.notice')) : undefined}
              aria-busy={saving}
              onClick={(): void => void save()}
            >
              {saving ? t('builder.saving') : saved ? t('builder.saved') : t('builder.save')}
            </Button>
          </div>
        }
      />

      {template.isSystem ? (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('templates.systemTemplate.notice')}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canWrite}
              title={disabledTitle}
              onClick={(): void => {
                void productFeedsClient
                  .duplicateTemplate(template.id, t('templates.copySuffix', { name: template.name }))
                  .then((created) => navigate(`/product-feeds/templates/${created.data.id}`));
              }}
            >
              {t('templates.duplicate')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {conflict ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-col gap-2">
            <strong>{t('builder.conflict.title')}</strong>
            <span>{t('builder.conflict.body')}</span>
            <span className="flex gap-2">
              <Button type="button" size="sm" onClick={(): void => void saveAsNewTemplate()}>
                {t('builder.conflict.saveAsNew')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(): void => window.location.reload()}
              >
                {t('builder.conflict.discard')}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {saveError !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <NeedsAttentionBar
        problems={problems}
        fields={draft.fields}
        showOnlyProblems={showOnlyProblems}
        onToggleShowOnly={(): void => setShowOnlyProblems((only) => !only)}
        onFocusField={(fieldId): void => setSelectedFieldId(fieldId)}
      />

      {/* The preview verdict belongs to the page body, not to the header's
          action row — see TemplatePreviewVerdict. */}
      <div className="mb-4 empty:mb-0">
        <TemplatePreviewVerdict
          selection={previewSelection}
          preview={preview}
          loading={previewLoading}
          error={previewError}
        />
      </div>

      {/* What the template *is*, as opposed to what it carries: name,
          description and output format all describe the whole template rather
          than any one column, so they share one card above the field list.
          None of the three had a control before — a rename meant duplicating
          the template, and the format was fixed at creation, which meant an
          operator who needed a marketplace's flat file rebuilt everything. */}
      <div className="b2b-card mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">{t('builder.name')}</Label>
            <Input
              id="template-name"
              value={draft.name}
              maxLength={200}
              disabled={readOnly}
              title={readOnly ? (disabledTitle ?? t('templates.systemTemplate.notice')) : undefined}
              aria-invalid={draft.name.trim() === ''}
              onChange={(event): void => patchDraft({ name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-description">{t('builder.description')}</Label>
            <Input
              id="template-description"
              value={draft.description ?? ''}
              maxLength={500}
              disabled={readOnly}
              title={readOnly ? (disabledTitle ?? t('templates.systemTemplate.notice')) : undefined}
              aria-describedby="template-description-hint"
              onChange={(event): void =>
                patchDraft({
                  // Empty means "no description", which the contract spells
                  // `null`; an empty string would persist as one.
                  description: event.target.value.trim() === '' ? null : event.target.value,
                })
              }
            />
            <p id="template-description-hint" className="b2b-help">
              {t('builder.description.hint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-output-format">{t('builder.settings.outputFormat')}</Label>
            <Select
              id="template-output-format"
              value={draft.outputFormat}
              disabled={readOnly}
              title={readOnly ? (disabledTitle ?? t('templates.systemTemplate.notice')) : undefined}
              onChange={(event): void =>
                patchDraft({ outputFormat: event.target.value as FeedOutputFormat })
              }
            >
              {feedOutputFormatSchema.options.map((format) => (
                <option key={format} value={format}>
                  {t(`builder.outputFormat.${format}`)}
                </option>
              ))}
            </Select>
            {/* Changing the format re-runs validation immediately, which is
                what surfaces a field the new format cannot carry. */}
            <p className="b2b-help">{t('builder.outputFormat.hint')}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">
              {t('builder.fields', { count: draft.fields.length })}
            </h2>
            <span className="b2b-input-wrap ml-auto">
              <Search size={14} className="lead" aria-hidden="true" />
              <Input
                className="h-8"
                placeholder={t('builder.search')}
                value={search}
                onChange={(event): void => setSearch(event.target.value)}
              />
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly}
              title={readOnly ? (disabledTitle ?? t('templates.systemTemplate.notice')) : undefined}
              onClick={addField}
            >
              <Plus size={14} aria-hidden="true" />
              {t('builder.addField')}
            </Button>
          </div>

          {previewSelection === null ? <PreviewCallToAction /> : null}

          <TemplateFieldList
            fields={visibleFields}
            selectedFieldId={selectedFieldId}
            onSelect={setSelectedFieldId}
            onChange={(next): void => patchDraft({ fields: next })}
            onRemove={removeField}
            onDuplicate={duplicateField}
            search={search}
            preview={preview}
            previewLoading={previewLoading}
            problems={problemMap}
            sourceLabels={sourceLabels(draft.fields, catalogue, t)}
            glosses={glosses(draft.fields, t)}
            disabled={readOnly}
            disabledTitle={disabledTitle}
          />
        </div>

        {/* Below 1280 px the inspector is a drawer opened by selecting a row;
            here it is the right-hand pane. */}
        {tier === 'desktop' && selectedField ? (
          <aside className="rounded-md border border-border p-3">
            <TemplateFieldInspector
              field={selectedField}
              catalogue={catalogue}
              outputFormat={draft.outputFormat}
              taxonomyProviderCode={draft.taxonomyProviderCode}
              providerLabel={providerLabel(draft.providerCode)}
              problems={problemMap[selectedField.id] ?? []}
              preview={
                preview?.fields.find((entry) => entry.outputName === selectedField.outputName) ??
                null
              }
              previewSku={previewSelection?.sku ?? null}
              disabled={readOnly}
              disabledTitle={disabledTitle}
              onChange={updateField}
            />
          </aside>
        ) : null}
      </div>

      {tier !== 'desktop' && selectedField ? (
        <>
          <div className="b2b-scrim" onClick={(): void => setSelectedFieldId(null)} />
          <aside
            className="b2b-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('builder.inspector.title')}
          >
            <div className="b2b-drawer__head">
              <div className="b2b-drawer__title">{selectedField.outputName}</div>
            </div>
            <div className="b2b-drawer__body">
              <TemplateFieldInspector
                field={selectedField}
                catalogue={catalogue}
                outputFormat={draft.outputFormat}
                taxonomyProviderCode={draft.taxonomyProviderCode}
                providerLabel={providerLabel(draft.providerCode)}
                problems={problemMap[selectedField.id] ?? []}
                preview={
                  preview?.fields.find((entry) => entry.outputName === selectedField.outputName) ??
                  null
                }
                previewSku={previewSelection?.sku ?? null}
                disabled={readOnly}
                disabledTitle={disabledTitle}
                onChange={updateField}
                onClose={(): void => setSelectedFieldId(null)}
              />
            </div>
          </aside>
        </>
      ) : null}

      {removed !== null ? (
        <RemoveRequiredDialog
          warnings={removed}
          providerLabel={providerLabel(draft.providerCode)}
          onKeep={(): void => setPendingRemoval(null)}
          onRemove={(): void => {
            const draftHasThem = draft.fields.some((field) =>
              removed.some((warning) => warning.outputName === field.outputName),
            );
            if (draftHasThem) confirmRemoval();
            else void save({ acknowledgeWarnings: true });
            setPendingRemoval(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** `role="alertdialog"`, and the **safe** button holds initial focus. */
function RemoveRequiredDialog(props: {
  warnings: TemplateSaveWarning[];
  providerLabel: string;
  onKeep: () => void;
  onRemove: () => void;
}): ReactNode {
  const t = useTranslation('product_feeds');
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  const names = props.warnings.map((warning) => warning.outputName).join(', ');

  return (
    <>
      <div className="b2b-scrim" onClick={props.onKeep} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-required-title"
        aria-describedby="remove-required-body"
        className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
      >
        <h2 id="remove-required-title" className="text-base font-medium">
          {t('builder.confirm.removeRequired.title', {
            provider: props.providerLabel,
            name: names,
          })}
        </h2>
        <p id="remove-required-body" className="mt-2 text-sm text-muted-foreground">
          {t('builder.confirm.removeRequired.body', { provider: props.providerLabel })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={keepRef} type="button" variant="outline" onClick={props.onKeep}>
            {t('builder.confirm.removeRequired.keep')}
          </Button>
          <Button type="button" variant="destructive" onClick={props.onRemove}>
            {t('builder.confirm.removeRequired.remove')}
          </Button>
        </div>
      </div>
    </>
  );
}

/** "Google", "Meta" — the name the operator would use for the provider. */
function providerLabel(providerCode: string): string {
  switch (providerCode) {
    case 'google_merchant':
      return 'Google';
    case 'meta':
      return 'Meta';
    case 'amazon':
      return 'Amazon';
    case 'ebay':
      return 'eBay';
    case 'allegro':
      return 'Allegro';
    default:
      return 'The provider';
  }
}

/** A name no other field is already using — duplicates are refused on save. */
function uniqueName(fields: DraftField[], base: string): string {
  const taken = new Set(fields.map((field) => field.outputName));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function sourceLabels(
  fields: DraftField[],
  catalogue: FeedFieldSourceCatalogue | null,
  t: Translate,
): Record<string, string> {
  const byKey = new Map<string, string>();
  for (const group of catalogue?.groups ?? []) {
    for (const source of group.sources) {
      const label = source.label ?? (source.labelKey ? t(source.labelKey) : source.sourceKind);
      byKey.set(source.sourceKey ? `${source.sourceKind}:${source.sourceKey}` : source.sourceKind, label);
    }
  }
  const out: Record<string, string> = {};
  for (const field of fields) {
    const key = field.sourceKey ? `${field.sourceKind}:${field.sourceKey}` : field.sourceKind;
    out[field.id] = byKey.get(key) ?? field.sourceKind;
  }
  return out;
}

/**
 * The gloss layer (ux-design §3.3): one plain sentence, shipped with the
 * predefined templates. Operator-invented fields get none — the platform must
 * not invent meaning it does not have — and an unknown key renders as no gloss
 * rather than as a raw key.
 */
function glosses(fields: DraftField[], t: Translate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!field.helpKey) continue;
    const resolved = t(field.helpKey);
    if (resolved && resolved !== field.helpKey) out[field.id] = resolved;
  }
  return out;
}

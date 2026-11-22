import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import type { DocumentTemplateSummary, DocumentTypeSummary } from '@endora-commerce/contracts';
import { ApiError, cn, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, Badge, Button, EmptyState, InlineStatus, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  clearDefaultTemplate,
  createTemplate,
  deleteTemplate,
  getDocumentType,
  listDocumentTypes,
  listSalesChannels,
  listTemplates,
  previewDocument,
  setDefaultTemplate,
} from '../api.js';
import { NewTemplateDialog, type NewTemplateValues } from '../components/NewTemplateDialog.js';
import { PdfPreviewDialog, usePdfPreview } from '../components/PdfPreviewDialog.js';

/**
 * *Document templates* (`specs/152-compare-pdf-template/contracts/admin-ui.md` §2).
 *
 * One section per available document type — a type whose module is switched
 * off is not offered (FR-051). In each: the built-in layout, which applies while
 * no template is the default and is where a new template starts (FR-002), then
 * the type's templates — all channels first — with the default of each scope
 * marked (FR-001). `?type=<code>` opens on that type's section and preselects it
 * in *New template* (the comparisons screen's *PDF template* button and the
 * invoices tab use it).
 *
 * Issue #1535 (UX audit CONTENT-18) — the kit list page. **One** primary
 * *New template* in the header, which asks for the document type in its dialog,
 * instead of a filled *New template* in every type's card (Von Restorff); the
 * template's name is the link to its editor, and a row's other actions are a
 * `RowActionMenu` — Delete last, apart and confirmed — instead of four outline
 * buttons per row (Hick, Fitts). The result of an action is an `InlineStatus`
 * beside the header's action, where focus returns.
 *
 * Without `document_templates:write` every mutating control is absent; preview
 * and the read-only editor stay.
 */

interface TypeState {
  readonly type: DocumentTypeSummary;
  readonly templates: readonly DocumentTemplateSummary[];
}

type Row =
  | { readonly kind: 'built_in'; readonly type: DocumentTypeSummary }
  | { readonly kind: 'template'; readonly template: DocumentTemplateSummary };

interface NewDialogState {
  /** The type preselected; fixed when `typeFixed`. */
  readonly type: string;
  readonly typeFixed: boolean;
  readonly source: string | null;
}

const templateId = (template: DocumentTemplateSummary): string => template.id;
const rowKey = (row: Row): string => (row.kind === 'built_in' ? `built-in:${row.type.code}` : row.template.id);

/** All channels first, then the channels by name: the scope a default applies to reads top-down. */
function byScope(templates: readonly DocumentTemplateSummary[]): DocumentTemplateSummary[] {
  return [...templates].sort((a, b) => {
    const scoped = Number(a.salesChannelId !== null) - Number(b.salesChannelId !== null);
    if (scoped !== 0) return scoped;
    return (a.salesChannelName ?? '').localeCompare(b.salesChannelName ?? '') || a.name.localeCompare(b.name);
  });
}

export function DocumentTemplatesPage(): ReactNode {
  const t = useTranslation('document_templates');
  const { language } = useTranslationContext();
  const { t: translateIn } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('document_templates:write');
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const focusType = search.get('type');
  const { confirm, confirmDialog } = useConfirmDialog();
  const status = useInlineStatus();
  const pdf = usePdfPreview();

  const [types, setTypes] = useState<TypeState[] | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<NewDialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorText = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const code = err.envelope.error.code;
        const translated = t(`errors.${code}`);
        return translated === `document_templates.errors.${code}` ? err.envelope.error.message : translated;
      }
      return t('page.actionError');
    },
    [t],
  );

  /** Reads every type with its templates. A reload keeps the rows on screen, so focus stays where it is. */
  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const listed = await listDocumentTypes();
      const withTemplates = await Promise.all(
        listed.map(async (type) => ({ type, templates: byScope(await listTemplates(type.code)) })),
      );
      setTypes(withTemplates);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void listSalesChannels().then(setChannels);
  }, [load]);

  useEffect(() => {
    if (!focusType || !types) return;
    document.getElementById(`document-type-${focusType}`)?.scrollIntoView?.({ block: 'start' });
  }, [focusType, types]);

  const allTemplates = useMemo(() => (types ?? []).flatMap((entry) => entry.templates), [types]);
  const removalFocus = useRemovalFocus(allTemplates, templateId, types !== null);

  const typeLabel = useCallback(
    (type: DocumentTypeSummary): string => translateIn(type.moduleId, type.labelKey),
    [translateIn],
  );

  const toggleDefault = useCallback(
    async (template: DocumentTemplateSummary): Promise<void> => {
      setBusy(true);
      setActionError(null);
      status.clear();
      try {
        if (template.isDefault) await clearDefaultTemplate(template.id, template.version);
        else await setDefaultTemplate(template.id, template.version);
        await load();
        status.show(t(template.isDefault ? 'page.defaultCleared' : 'page.defaultSet', { name: template.name }));
      } catch (err) {
        setActionError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [load, errorText, status, t],
  );

  const askDelete = useCallback(
    async (template: DocumentTemplateSummary): Promise<void> => {
      setActionError(null);
      status.clear();
      const deleted = await confirm({
        title: t('dialog.deleteTitle', { name: template.name }),
        message: template.isDefault
          ? t(template.salesChannelId ? 'dialog.deleteDefaultChannel' : 'dialog.deleteDefaultGlobal')
          : t('dialog.deleteBody'),
        confirmLabel: t('page.delete'),
        cancelLabel: t('dialog.cancel'),
        destructive: true,
        action: () => deleteTemplate(template.id, template.version, template.isDefault),
        describeError: errorText,
        returnFocusTo: removalFocus.returnFocusTo(template),
      });
      if (!deleted) return;
      // Removed in place rather than reloaded, so the row focus moved to is still there.
      setTypes((current) =>
        (current ?? []).map((entry) => ({ ...entry, templates: entry.templates.filter((row) => row.id !== template.id) })),
      );
      status.show(t('page.deleted', { name: template.name }));
    },
    [confirm, errorText, removalFocus, status, t],
  );

  const previewBuiltIn = useCallback(
    async (type: DocumentTypeSummary): Promise<void> => {
      setActionError(null);
      status.show(t('editor.previewing'), 'info');
      try {
        const detail = await getDocumentType(type.code);
        const previewLanguage = Object.keys(detail.builtInContent.languages)[0] ?? 'en-US';
        const blob = await previewDocument(type.code, previewLanguage, detail.builtInContent.languages[previewLanguage]);
        status.clear();
        pdf.show(blob, t('editor.previewTitle', { name: `${t('page.builtIn')} — ${typeLabel(type)}` }));
      } catch {
        status.clear();
        setActionError(t('editor.previewError'));
      }
    },
    [pdf, status, t, typeLabel],
  );

  const submitNew = useCallback(
    async (values: NewTemplateValues): Promise<void> => {
      setBusy(true);
      setDialogError(null);
      try {
        const created = await createTemplate({
          documentType: values.documentType,
          name: values.name,
          salesChannelId: values.salesChannelId,
          source: values.sourceTemplateId ? { kind: 'template', templateId: values.sourceTemplateId } : { kind: 'built_in' },
          setDefault: values.setDefault,
        });
        setDialog(null);
        navigate(`/document-templates/${created.id}`);
      } catch (err) {
        setDialogError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [navigate, errorText],
  );

  const openNew = (state: NewDialogState): void => {
    setDialogError(null);
    setDialog(state);
  };

  /** Each built-in row's menu is named after its type: "Actions for Built-in layout" twice names nothing. */
  const builtInName = (type: DocumentTypeSummary): string => `${t('page.builtIn')} (${typeLabel(type)})`;

  const columns: ResponsiveColumn<Row>[] = [
    {
      id: 'name',
      header: t('page.column.name'),
      primary: true,
      render: (row) =>
        row.kind === 'built_in' ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{t('page.builtIn')}</span>
            <Badge variant="secondary">{t('page.builtInBadge')}</Badge>
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link
              ref={removalFocus.targetRef(row.template)}
              className="font-medium underline-offset-2 hover:underline"
              to={`/document-templates/${row.template.id}`}
            >
              {row.template.name}
            </Link>
            {row.template.isDefault ? <Badge>{t('page.default')}</Badge> : null}
          </span>
        ),
    },
    {
      id: 'scope',
      header: t('page.column.scope'),
      render: (row) =>
        row.kind === 'built_in'
          ? '—'
          : (row.template.salesChannelName ?? row.template.salesChannelId ?? t('page.allChannels')),
    },
    {
      id: 'languages',
      header: t('page.column.languages'),
      render: (row) => (row.kind === 'built_in' ? '—' : row.template.languages.join(', ')),
    },
    {
      id: 'updated',
      header: t('page.column.updated'),
      hideOnMobile: true,
      render: (row) => (row.kind === 'built_in' ? '—' : formatDateTime(row.template.updatedAt, language)),
    },
  ];

  const renderActions = (row: Row): ReactNode => {
    if (row.kind === 'built_in') {
      return (
        <RowActionMenu label={t('page.rowActions', { name: builtInName(row.type) })}>
          <RowActionMenuItem onSelect={() => void previewBuiltIn(row.type)}>{t('editor.preview')}</RowActionMenuItem>
          {canWrite ? (
            <RowActionMenuItem disabled={busy} onSelect={() => openNew({ type: row.type.code, typeFixed: true, source: null })}>
              {t('page.createFromThis')}
            </RowActionMenuItem>
          ) : null}
        </RowActionMenu>
      );
    }
    // Read-only: the name opens the template, and there is nothing else to do with it.
    if (!canWrite) return null;
    const { template } = row;
    return (
      <RowActionMenu label={t('page.rowActions', { name: template.name })}>
        <RowActionMenuItem
          disabled={busy}
          onSelect={() => openNew({ type: template.documentType, typeFixed: true, source: template.id })}
        >
          {t('page.duplicate')}
        </RowActionMenuItem>
        <RowActionMenuItem disabled={busy} onSelect={() => void toggleDefault(template)}>
          {template.isDefault ? t('page.clearDefault') : t('page.setDefault')}
        </RowActionMenuItem>
        <RowActionMenuSeparator />
        <RowActionMenuItem destructive disabled={busy} onSelect={() => void askDelete(template)}>
          {t('page.delete')}
        </RowActionMenuItem>
      </RowActionMenu>
    );
  };

  const listLoad: ListPageLoad = loadError
    ? { kind: 'error', message: t('page.loadError') }
    : types === null
      ? { kind: 'loading' }
      : { kind: 'ready' };
  const hasTypes = (types?.length ?? 0) > 0;
  const preselected = types?.find((entry) => entry.type.code === focusType)?.type.code ?? types?.[0]?.type.code ?? '';
  const statusRegion = <InlineStatus {...status.props} data-testid="document-templates-status" />;

  return (
    <>
      <ListPage
        title={t('page.title')}
        description={t('page.description')}
        help={t('page.help')}
        actions={
          <>
            {statusRegion}
            {canWrite && hasTypes ? (
              <Button
                ref={(element: HTMLButtonElement | null) => {
                  removalFocus.createRef.current = element;
                }}
                disabled={busy}
                onClick={() => openNew({ type: preselected, typeFixed: false, source: null })}
              >
                <Plus aria-hidden="true" />
                {t('page.newTemplate')}
              </Button>
            ) : null}
          </>
        }
        load={listLoad}
        onRetry={() => void load()}
        notice={
          actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null
        }
      >
        {hasTypes ? (
          <div className="space-y-8">
            {(types ?? []).map(({ type, templates }) => {
              const headingId = `document-type-${type.code}-title`;
              const rows: Row[] = [{ kind: 'built_in', type }, ...templates.map((template): Row => ({ kind: 'template', template }))];
              return (
                <section
                  key={type.code}
                  id={`document-type-${type.code}`}
                  data-testid={`document-type-${type.code}`}
                  aria-labelledby={headingId}
                  className={cn(
                    'scroll-mt-24 space-y-2 rounded-md',
                    focusType === type.code && 'ring-2 ring-primary ring-offset-4 ring-offset-background',
                  )}
                >
                  <div>
                    <h2 id={headingId} className="text-base font-semibold">
                      {typeLabel(type)}
                    </h2>
                    {type.descriptionKey ? (
                      <p className="text-sm text-muted-foreground">{translateIn(type.moduleId, type.descriptionKey)}</p>
                    ) : null}
                  </div>
                  <ResponsiveTable columns={columns} data={rows} keyExtractor={rowKey} renderActions={renderActions} />
                  {templates.length === 0 ? <p className="text-sm text-muted-foreground">{t('page.noTemplates')}</p> : null}
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<FileText size={20} />} title={t('page.emptyTitle')} description={t('page.empty')} />
        )}
      </ListPage>
      {dialog && types ? (
        <NewTemplateDialog
          channels={channels}
          types={types.map((entry) => ({ code: entry.type.code, label: typeLabel(entry.type), templates: entry.templates }))}
          initialType={dialog.type}
          typeFixed={dialog.typeFixed}
          initialSource={dialog.source}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(values) => void submitNew(values)}
        />
      ) : null}
      <PdfPreviewDialog preview={pdf.preview} onClose={pdf.close} />
      {confirmDialog}
    </>
  );
}

export default DocumentTemplatesPage;

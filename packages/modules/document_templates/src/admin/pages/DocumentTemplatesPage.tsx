import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { DocumentTemplateSummary, DocumentTypeSummary } from '@endora-commerce/contracts';
import { ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
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

/**
 * *Document templates* (`specs/152-compare-pdf-template/contracts/admin-ui.md` §2).
 *
 * One card per available document type — a type whose module is switched off is
 * not offered (FR-051). In each card: the built-in layout, which applies while
 * no template is the default and is where a new template starts (FR-002), then
 * the type's templates grouped by scope — all channels first — with the default
 * of each scope marked (FR-001). `?type=<code>` opens on that type's card (the
 * comparisons screen's *PDF template* button and the invoices tab use it).
 *
 * Without `document_templates:write` every mutating control is absent; preview
 * and the read-only editor stay.
 */

interface TypeState {
  readonly type: DocumentTypeSummary;
  readonly templates: readonly DocumentTemplateSummary[];
}

type DialogState =
  | { readonly kind: 'new'; readonly type: string; readonly source: string | null }
  | { readonly kind: 'delete'; readonly template: DocumentTemplateSummary };

export function DocumentTemplatesPage(): ReactNode {
  const t = useTranslation('document_templates');
  const { t: translateIn } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('document_templates:write');
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const focusType = search.get('type');

  const [types, setTypes] = useState<TypeState[] | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
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

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const listed = await listDocumentTypes();
      const withTemplates = await Promise.all(
        listed.map(async (type) => ({ type, templates: await listTemplates(type.code) })),
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

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        await load();
        return true;
      } catch (err) {
        setActionError(errorText(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, errorText],
  );

  const previewBuiltIn = useCallback(
    async (code: string): Promise<void> => {
      setActionError(null);
      try {
        const detail = await getDocumentType(code);
        const language = Object.keys(detail.builtInContent.languages)[0] ?? 'en-US';
        const blob = await previewDocument(code, language, detail.builtInContent.languages[language]);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        setActionError(t('editor.previewError'));
      }
    },
    [t],
  );

  const submitNew = useCallback(
    async (type: string, values: NewTemplateValues): Promise<void> => {
      let createdId: string | null = null;
      const ok = await run(async () => {
        const created = await createTemplate({
          documentType: type,
          name: values.name,
          salesChannelId: values.salesChannelId,
          source: values.sourceTemplateId ? { kind: 'template', templateId: values.sourceTemplateId } : { kind: 'built_in' },
          setDefault: values.setDefault,
        });
        createdId = created.id;
      });
      if (ok) {
        setDialog(null);
        if (createdId) navigate(`/document-templates/${createdId}`);
      }
    },
    [run, navigate],
  );

  const typeLabel = (type: DocumentTypeSummary): string => translateIn(type.moduleId, type.labelKey);

  const scopeGroups = (templates: readonly DocumentTemplateSummary[]): [string, DocumentTemplateSummary[]][] => {
    const groups = new Map<string, DocumentTemplateSummary[]>();
    for (const template of [...templates].sort((a, b) => Number(a.salesChannelId !== null) - Number(b.salesChannelId !== null))) {
      const key = template.salesChannelName ?? (template.salesChannelId ? template.salesChannelId : t('page.allChannels'));
      groups.set(key, [...(groups.get(key) ?? []), template]);
    }
    return [...groups.entries()];
  };

  return (
    <>
      <PageHeader title={t('page.title')} description={t('page.description')} help={t('page.help')} />
      {actionError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {loadError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription className="flex items-center gap-2">
            {t('page.loadError')}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('page.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {types === null && !loadError ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('page.loading')}
        </p>
      ) : null}
      {types !== null && types.length === 0 ? <p className="text-sm text-muted-foreground">{t('page.empty')}</p> : null}
      <div className="space-y-6">
        {(types ?? []).map(({ type, templates }) => (
          <Card
            key={type.code}
            id={`document-type-${type.code}`}
            data-testid={`document-type-${type.code}`}
            className={focusType === type.code ? 'ring-2 ring-primary' : undefined}
          >
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>{typeLabel(type)}</CardTitle>
                  {type.descriptionKey ? (
                    <CardDescription>{translateIn(type.moduleId, type.descriptionKey)}</CardDescription>
                  ) : null}
                </div>
                {canWrite ? (
                  <Button size="sm" disabled={busy} onClick={() => setDialog({ kind: 'new', type: type.code, source: null })}>
                    {t('page.newTemplate')}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 font-medium">{t('page.column.name')}</th>
                    <th className="py-2 font-medium">{t('page.column.languages')}</th>
                    <th className="py-2 font-medium">{t('page.column.updated')}</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">{t('page.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-testid="built-in-row" className="border-t">
                    <td className="py-2">
                      {t('page.builtIn')} <Badge variant="secondary">{t('page.builtInBadge')}</Badge>
                    </td>
                    <td className="py-2">—</td>
                    <td className="py-2">—</td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => void previewBuiltIn(type.code)}>
                          {t('editor.preview')}
                        </Button>
                        {canWrite ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'new', type: type.code, source: null })}>
                            {t('page.createFromThis')}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {scopeGroups(templates).map(([scope, rows]) => [
                    <tr key={`scope-${scope}`} className="border-t bg-muted/40">
                      <th colSpan={4} scope="colgroup" className="py-1 text-left text-xs font-semibold uppercase text-muted-foreground">
                        {scope}
                      </th>
                    </tr>,
                    ...rows.map((template) => (
                      <tr key={template.id} className="border-t" data-testid={`template-row-${template.id}`}>
                        <td className="py-2">
                          <Link className="font-medium underline-offset-2 hover:underline" to={`/document-templates/${template.id}`}>
                            {template.name}
                          </Link>{' '}
                          {template.isDefault ? <Badge>{t('page.default')}</Badge> : null}
                        </td>
                        <td className="py-2">{template.languages.join(', ')}</td>
                        <td className="py-2">{formatDateTime(template.updatedAt)}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/document-templates/${template.id}`}>{canWrite ? t('page.edit') : t('page.open')}</Link>
                            </Button>
                            {canWrite ? (
                              <>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'new', type: type.code, source: template.id })}>
                                  {t('page.duplicate')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() =>
                                      template.isDefault
                                        ? clearDefaultTemplate(template.id, template.version)
                                        : setDefaultTemplate(template.id, template.version),
                                    )
                                  }
                                >
                                  {template.isDefault ? t('page.clearDefault') : t('page.setDefault')}
                                </Button>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'delete', template })}>
                                  {t('page.delete')}
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
              {templates.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('page.noTemplates')}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {dialog?.kind === 'new' ? (
        <NewTemplateDialog
          channels={channels}
          templates={types?.find((entry) => entry.type.code === dialog.type)?.templates ?? []}
          initialSource={dialog.source}
          busy={busy}
          error={actionError}
          onClose={() => setDialog(null)}
          onSubmit={(values) => void submitNew(dialog.type, values)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ModalDialog
          title={t('dialog.deleteTitle', { name: dialog.template.name })}
          onClose={() => setDialog(null)}
          busy={busy}
          footer={
            <>
              <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                {t('dialog.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(() => deleteTemplate(dialog.template.id, dialog.template.version, dialog.template.isDefault)).then(
                    (ok) => {
                      if (ok) setDialog(null);
                    },
                  )
                }
              >
                {t('page.delete')}
              </Button>
            </>
          }
        >
          <p>
            {dialog.template.isDefault
              ? t(dialog.template.salesChannelId ? 'dialog.deleteDefaultChannel' : 'dialog.deleteDefaultGlobal')
              : t('dialog.deleteBody')}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

export default DocumentTemplatesPage;

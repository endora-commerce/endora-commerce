import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Puck, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { PageBuilderHeaderActions } from '@endora-commerce/page-builder-admin';
import { PageBuilderOverlayBridge } from '@endora-commerce/page-builder-admin';
import { invoicePuckConfig } from './invoice-puck-config';
import { createInvoiceBuilderEditorPlugin } from './invoice-builder-plugin';

interface TemplateDetail {
  id: string;
  name: string;
  version: number;
  languages: string[];
  content: { languages?: Record<string, Data> };
}

const emptyData: Data = { root: { props: {} }, content: [] };
const LANGUAGE = 'pl-PL';
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
const invoiceBuilderPlugin = createInvoiceBuilderEditorPlugin();

/**
 * Fill missing props from each component's `defaultProps`. Persisted trees
 * (esp. older seeds) often only store `{ id }`, which leaves radio/select
 * fields unselected in the Puck sidebar even though canvas fallbacks work.
 */
function hydrateInvoiceDefaults(data: Data): Data {
  const components = invoicePuckConfig.components ?? {};
  const content = (data.content ?? []).map((node) => {
    const defaults = components[node.type]?.defaultProps as Record<string, unknown> | undefined;
    if (!defaults) return node;
    const props = node.props as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) merged[key] = value;
    }
    return { ...node, props: merged };
  });
  return { ...data, content };
}

/** Admin editor for an invoice PDF template (feature 047, US6). */
export function InvoiceTemplateEditor(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tpl, setTpl] = useState<TemplateDetail | null>(null);
  const [draft, setDraft] = useState<Data>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: TemplateDetail }>(`/api/v1/admin/invoice-templates/${id}`);
      setTpl(res.data);
      const tree = res.data.content.languages?.[LANGUAGE] ?? emptyData;
      setDraft(hydrateInvoiceDefaults(tree));
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load template.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyCanvasData = useCallback((next: Data): void => {
    setDraft(next);
    setCanvasEpoch((n) => n + 1);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!tpl) return false;
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.put<{ data: TemplateDetail }>(
        `/api/v1/admin/invoice-templates/${tpl.id}/content/${LANGUAGE}`,
        { version: tpl.version, data: draft },
      );
      setTpl((prev) => (prev ? { ...prev, version: res.data.version } : prev));
      setNotice(t('invoiceTemplates.saved'));
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to save.');
      return false;
    }
  }, [tpl, draft, t]);

  const saveAndExit = useCallback(async (): Promise<void> => {
    if (await save()) navigate('/invoices/templates');
  }, [save, navigate]);

  const previewPdf = useCallback(async (): Promise<void> => {
    if (!tpl) return;
    setPreviewBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE.replace(/\/+$/, '')}/api/v1/admin/invoice-templates/${tpl.id}/preview`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
          body: JSON.stringify({ data: draft }),
        },
      );
      if (!res.ok) {
        throw new Error(t('invoiceTemplates.previewError'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invoiceTemplates.previewError'));
    } finally {
      setPreviewBusy(false);
    }
  }, [tpl, draft, t]);

  return (
    <>
      <PageHeader
        title={tpl?.name ?? t('invoiceTemplates.editTitle')}
        description={t('invoiceTemplates.editDescription')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/invoices/templates">{t('common.action.back')}</Link>
            </Button>
            {tpl ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={previewBusy}
                onClick={() => void previewPdf()}
              >
                {previewBusy ? t('invoiceTemplates.previewLoading') : t('invoiceTemplates.preview')}
              </Button>
            ) : null}
            <SaveButtonGroup
              size="sm"
              onSave={() => void save()}
              onSaveAndExit={() => void saveAndExit()}
              saveLabel={t('common.action.save')}
              savingLabel={t('common.action.save')}
              saveAndExitLabel={t('common.action.saveAndExit')}
            />
          </div>
        }
      />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mb-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <div
            className={cn(
              'cms-page-builder space-y-3',
              fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4',
            )}
          >
            <div
              className={cn(
                'overflow-hidden rounded-md border',
                fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]',
              )}
            >
              {loaded ? (
                <Puck
                  key={`${id}:${LANGUAGE}:${canvasEpoch}`}
                  config={invoicePuckConfig}
                  data={draft}
                  onChange={setDraft}
                  plugins={[invoiceBuilderPlugin]}
                  overrides={{
                    headerActions: () => (
                      <PageBuilderHeaderActions
                        fullscreen={fullscreen}
                        onToggleFullscreen={(): void => setFullscreen((f) => !f)}
                        currentData={draft}
                        onClearCanvas={(): void => applyCanvasData(emptyData)}
                        t={t}
                      />
                    ),
                    componentOverlay: ({
                      children,
                      hover,
                      isSelected,
                      componentId,
                      componentType,
                    }) => (
                      <PageBuilderOverlayBridge
                        hover={hover}
                        isSelected={isSelected}
                        componentId={componentId}
                        componentType={componentType}
                      >
                        {children}
                      </PageBuilderOverlayBridge>
                    ),
                  }}
                />
              ) : (
                <div className="flex min-h-[560px] items-center justify-center text-sm text-muted-foreground">
                  {t('invoiceTemplates.loading')}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

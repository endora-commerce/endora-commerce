import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Puck, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { apiBaseUrl, apiClient, ApiError, cn } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader, SaveButtonGroup } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageBuilderHeaderActions } from '@endora-commerce/page-builder-admin';
import { PageBuilderOverlayBridge } from '@endora-commerce/page-builder-admin';
import { countBlockNames } from '@endora-commerce/page-builder-core';
import { invoicePuckConfig, invoicePuckPalette } from '../templates/invoice-puck-config.js';
import {
  withDescribedInvoiceBlocks,
  type DescribedBlockText,
  type InvoiceBuilderDescriptor,
} from '../templates/described-blocks.js';
import { createInvoiceBuilderEditorPlugin } from '../templates/invoice-builder-plugin.js';

interface TemplateDetail {
  id: string;
  name: string;
  version: number;
  languages: string[];
  content: { languages?: Record<string, Data> };
}

const emptyData: Data = { root: { props: {} }, content: [] };
const LANGUAGE = 'pl-PL';
/**
 * `apiBaseUrl` and not `import.meta.env`: this file compiles under `tsc` inside
 * its own package, where Vite's client types are not in scope, and the kit
 * publishes the resolved value — with this exact fallback — for exactly this
 * (feature 091).
 */
const API_BASE = apiBaseUrl;
const invoiceBuilderPlugin = createInvoiceBuilderEditorPlugin();

/**
 * This module's own config: the namespaced renderer map plus its one derived
 * section (feature 096, T303). The config Puck renders is this merged with the
 * served descriptor and the stored document's names
 * (`withDescribedInvoiceBlocks`, `specs/134-paid-module-extraction/` T138).
 */
const localConfig = { ...invoicePuckConfig, categories: invoicePuckPalette };

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
  /**
   * The served descriptor — `null` until it arrives or when it cannot be
   * fetched, in which case the editor keeps its own blocks and gives every
   * stored block it cannot render a placeholder; it never drops a node (T138).
   */
  const [descriptor, setDescriptor] = useState<InvoiceBuilderDescriptor | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ data: InvoiceBuilderDescriptor }>('/api/v1/admin/invoice-templates/page-builder/config')
      .then((res) => {
        if (!cancelled) setDescriptor(res.data);
      })
      .catch(() => {
        if (!cancelled) setDescriptor(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyed on the sorted set of stored names, as the CMS editor's merge is: a
  // keystroke moves the document, not the names, so typing does not rebuild
  // the Puck config.
  const storedNamesKey = [...countBlockNames(draft).keys()].sort().join('\n');
  const puckConfig = useMemo(() => {
    const text: DescribedBlockText = {
      standIn: ({ label, owner }) => t('invoiceTemplates.describedBlock.standIn', { label, owner }),
      placeholder: ({ owner, name }) =>
        owner === null
          ? t('invoiceTemplates.describedBlock.placeholderNoOwner', { name })
          : t('invoiceTemplates.describedBlock.placeholder', { owner }),
    };
    return withDescribedInvoiceBlocks(
      localConfig,
      descriptor,
      storedNamesKey === '' ? [] : storedNamesKey.split('\n'),
      text,
    );
  }, [descriptor, storedNamesKey, t]);

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
                  config={puckConfig}
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default InvoiceTemplateEditor;

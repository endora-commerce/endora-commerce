import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Puck, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { invoicePuckConfig } from './invoice-puck-config';

interface TemplateDetail {
  id: string;
  name: string;
  version: number;
  languages: string[];
  content: { languages?: Record<string, Data> };
}

const emptyData: Data = { root: { props: {} }, content: [] };
const LANGUAGE = 'pl-PL';

/** Admin editor for an invoice PDF template (feature 047, US6). */
export function InvoiceTemplateEditor(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams();
  const [tpl, setTpl] = useState<TemplateDetail | null>(null);
  const [draft, setDraft] = useState<Data>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

  // Fetch the rendered preview PDF through the authenticated (cookie) fetch
  // path and expose it as a same-origin blob URL. A direct <iframe src> to the
  // API origin is blocked by the backend's X-Frame-Options in the cross-origin
  // dev setup, so we proxy the bytes into a blob URL that frames cleanly.
  const loadPreview = useCallback(
    async (tplId: string): Promise<void> => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await fetch(`${baseUrl}/api/v1/admin/invoice-templates/${tplId}/preview`, {
          credentials: 'include',
          headers: { Accept: 'application/pdf' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      } catch {
        setPreviewError(t('invoiceTemplates.previewError'));
      } finally {
        setPreviewLoading(false);
      }
    },
    [baseUrl, t],
  );

  // Revoke the last object URL when the editor unmounts.
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  // Allow exiting fullscreen with Escape.
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
      setDraft(tree);
      void loadPreview(res.data.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load template.');
    }
  }, [id, loadPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    if (!tpl) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.put<{ data: TemplateDetail }>(
        `/api/v1/admin/invoice-templates/${tpl.id}/content/${LANGUAGE}`,
        { version: tpl.version, data: draft },
      );
      setTpl((prev) => (prev ? { ...prev, version: res.data.version } : prev));
      setNotice(t('invoiceTemplates.saved'));
      void loadPreview(tpl.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to save.');
    }
  }, [tpl, draft, t, loadPreview]);

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
              <Button asChild variant="outline" size="sm">
                <a
                  href={`${baseUrl}/api/v1/admin/invoice-templates/${tpl.id}/preview`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('invoiceTemplates.preview')}
                </a>
              </Button>
            ) : null}
            <Button size="sm" onClick={(): void => void save()}>
              {t('common.action.save')}
            </Button>
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
              'space-y-3',
              fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4',
            )}
          >
            <div
              className={cn(
                'overflow-hidden rounded-md border',
                fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]',
              )}
            >
              <Puck
                key={`${id}:${LANGUAGE}`}
                config={invoicePuckConfig}
                data={draft}
                onChange={setDraft}
                overrides={{
                  headerActions: () => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(): void => setFullscreen((f) => !f)}
                      aria-pressed={fullscreen}
                    >
                      {fullscreen ? (
                        <>
                          <Minimize2 className="mr-1 h-4 w-4" />
                          {t('invoiceTemplates.fullscreen.exit')}
                        </>
                      ) : (
                        <>
                          <Maximize2 className="mr-1 h-4 w-4" />
                          {t('invoiceTemplates.fullscreen.enter')}
                        </>
                      )}
                    </Button>
                  ),
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!fullscreen ? (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('invoiceTemplates.previewTitle')}</h2>
              {tpl ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={previewLoading}
                  onClick={(): void => void loadPreview(tpl.id)}
                >
                  {t('invoiceTemplates.previewRefresh')}
                </Button>
              ) : null}
            </div>
            {previewError ? (
              <Alert variant="destructive">
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            ) : previewUrl ? (
              <iframe
                title={t('invoiceTemplates.previewTitle')}
                src={previewUrl}
                className="h-[720px] w-full rounded-md border bg-white"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {previewLoading ? t('common.state.loading') : t('invoiceTemplates.previewEmpty')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

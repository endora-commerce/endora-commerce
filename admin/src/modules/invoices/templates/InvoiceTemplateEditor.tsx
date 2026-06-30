import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

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
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load template.');
    }
  }, [id]);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to save.');
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
            <div className="flex justify-end">
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
            </div>
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
                overrides={{ headerActions: () => <></> }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  API_DESCRIPTION_SCOPE,
  apiReferenceUrl,
  getApiDescription,
  summariseApiDescription,
  type ApiDescriptionDocument,
  type ApiDescriptionSummary,
} from './api-description.js';

/**
 * `/api-description` — the API description, for an administrator whose role
 * holds `platform.api_description.read`.
 *
 * The screen belongs to no module, like `/platform/modules`: the document
 * describes every module's routes. It fetches the document from
 * `GET /api/v1/admin/api-description` with the ordinary admin client, offers it
 * as a download, and links to the interactive reference the backend serves at
 * `/api/v1/_docs`. That page lives on the API's own address; the admin session
 * cookie is the API's and `SameSite=Lax`, so opening it from here in a new tab
 * carries the session, and the reference fetches the document with it.
 */
export function ApiDescriptionPage(): React.ReactElement {
  const t = useTranslation('core');
  const [document, setDocument] = useState<ApiDescriptionDocument | null>(null);
  const [summary, setSummary] = useState<ApiDescriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const doc = await getApiDescription();
      setDocument(doc);
      setSummary(summariseApiDescription(doc));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = useCallback((): void => {
    if (!document) return;
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = href;
    anchor.download = 'openapi.json';
    anchor.click();
    URL.revokeObjectURL(href);
  }, [document]);

  return (
    <>
      <PageHeader
        title={t('platform.apiDescription.title')}
        description={t('platform.apiDescription.description')}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('platform.apiDescription.reference.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('platform.apiDescription.reference.body')}
            </p>
            <Button asChild>
              <a href={apiReferenceUrl()} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('platform.apiDescription.reference.open')}
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('platform.apiDescription.document.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t('platform.apiDescription.document.loading')}
              </p>
            ) : summary ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  {t('platform.apiDescription.document.name')}
                </dt>
                <dd>{summary.title}</dd>
                <dt className="text-muted-foreground">
                  {t('platform.apiDescription.document.version')}
                </dt>
                <dd>{summary.version}</dd>
                <dt className="text-muted-foreground">
                  {t('platform.apiDescription.document.operations')}
                </dt>
                <dd>{summary.operations}</dd>
              </dl>
            ) : null}
            <Button variant="outline" onClick={download} disabled={!document}>
              <Download className="size-4" aria-hidden="true" />
              {t('platform.apiDescription.document.download')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('platform.apiDescription.access.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t('platform.apiDescription.access.administrators')}</p>
          <p>
            {t('platform.apiDescription.access.apiKeys')}{' '}
            <code className="font-mono text-foreground">{API_DESCRIPTION_SCOPE}</code>
          </p>
        </CardContent>
      </Card>
    </>
  );
}

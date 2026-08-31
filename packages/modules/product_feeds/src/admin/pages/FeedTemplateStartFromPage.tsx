import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Combobox, Input, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type FeedTemplateSummary } from '../api.js';

/**
 * "Start from" — ux-design §2.6, FR-006.
 *
 * Two choices and a link, not three buttons. Copying an existing template is
 * the recommended path and is preselected with the platform's own templates
 * first, because a merchandiser who starts from Google's twenty-three fields is
 * editing; a merchandiser who starts empty is authoring a provider spec from
 * memory. The layout should say which of those the platform expects.
 */

export function FeedTemplateStartFromPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // US6 AS-7 — write controls render disabled with the reason, never hidden.
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [templates, setTemplates] = useState<FeedTemplateSummary[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void productFeedsClient
      .listTemplates()
      .then((res) => {
        setTemplates(res.data);
        const recommended = res.data.find((template) => template.isSystem) ?? res.data[0];
        if (recommended) {
          setSourceId(recommended.id);
          setName(t('templates.copySuffix', { name: recommended.name }));
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.envelope.error.message : t('templates.loadFailed'));
      });
  }, [t]);

  const create = async (mode: 'copy' | 'scratch'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'copy' && sourceId) {
        const created = await productFeedsClient.duplicateTemplate(sourceId, name.trim());
        navigate(`/product-feeds/templates/${created.data.id}`);
        return;
      }
      const created = await productFeedsClient.createTemplate({
        name: name.trim() || t('templates.new'),
        fields: [],
      });
      navigate(`/product-feeds/templates/${created.data.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('builder.error.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('templates.startFrom.title')}
        description={t('templates.startFrom.subtitle')}
        back={{ label: t('templates.title'), to: '/product-feeds/templates' }}
      />

      {error !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('templates.startFrom.copy')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="b2b-help">{t('templates.startFrom.copy.hint')}</p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="start-from-source">{t('templates.startFrom.copy')}</Label>
            <Combobox<string>
              id="start-from-source"
              options={templates.map((template) => ({
                value: template.id,
                label: template.name,
                description: template.isSystem
                  ? template.fieldCount <= 7
                    ? t('templates.startingPoint')
                    : t('templates.readyToUse')
                  : t('templates.fields', { count: template.fieldCount }),
              }))}
              value={sourceId}
              clearable={false}
              onChange={(next): void => {
                setSourceId(next);
                const chosen = templates.find((template) => template.id === next);
                if (chosen) setName(t('templates.copySuffix', { name: chosen.name }));
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="start-from-name">{t('templates.startFrom.name')}</Label>
            <Input
              id="start-from-name"
              value={name}
              onChange={(event): void => setName(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={!canWrite || busy || sourceId === null || name.trim() === ''}
              title={writeTitle}
              onClick={(): void => void create('copy')}
            >
              {t('templates.startFrom.create')}
            </Button>
            {/* Almost nobody should take this path, and the layout says so. */}
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-2"
              disabled={!canWrite || busy}
              title={writeTitle}
              onClick={(): void => void create('scratch')}
            >
              {t('templates.startFrom.scratch')}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default FeedTemplateStartFromPage;

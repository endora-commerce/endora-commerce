import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Plus, Upload } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { productFeedsClient, type FeedTemplateSummary } from './api';
import { FeedSectionTabs } from './components/FeedSectionTabs';

/**
 * Feed templates — ux-design §2.5, FR-006–FR-008.
 *
 * Two labelled regions rather than one mixed table, because the two kinds
 * behave differently and things that look alike must act alike: a read-only
 * system row and an editable one must not be told apart only by trying.
 *
 * **FR-007's asymmetry is visible before the operator chooses.** Google and
 * Meta are complete and production-usable; the three marketplace templates
 * carry identity, price, availability, link and image only. Labelling them
 * "Ready to use" versus "Starting point" — icon and word, never colour — is
 * what stops someone pointing Amazon at a skeleton and concluding the platform
 * is broken.
 */

/** A skeleton carries only the seven core fields; anything richer is complete. */
const SKELETON_FIELD_CEILING = 7;

export function FeedTemplatesListPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');

  const [templates, setTemplates] = useState<FeedTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<{ name: string; feeds: string[] } | null>(null);

  const load = (): void => {
    setLoading(true);
    void productFeedsClient
      .listTemplates()
      .then((res) => {
        setTemplates(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.envelope.error.message : t('templates.loadFailed'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [t]);

  const duplicate = (template: FeedTemplateSummary): void => {
    void productFeedsClient
      .duplicateTemplate(template.id, t('templates.copySuffix', { name: template.name }))
      .then((created) => navigate(`/product-feeds/templates/${created.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.envelope.error.message : t('templates.loadFailed'));
      });
  };

  const remove = (template: FeedTemplateSummary): void => {
    if (!window.confirm(t('templates.delete.confirm'))) return;
    void productFeedsClient
      .removeTemplate(template.id, template.version)
      .then(load)
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          const details = err.envelope.error.details as
            | { reason?: string; feeds?: Array<{ name: string }> }
            | undefined;
          if (details?.reason === 'template_in_use') {
            // The operator needs the list of feeds to go and fix, not a verdict.
            setInUse({ name: template.name, feeds: (details.feeds ?? []).map((f) => f.name) });
            return;
          }
          setError(err.envelope.error.message);
        }
      });
  };

  const system = templates.filter((template) => template.isSystem);
  const mine = templates.filter((template) => !template.isSystem);

  const columns: ResponsiveColumn<FeedTemplateSummary>[] = [
    {
      id: 'name',
      header: t('builder.settings.name'),
      primary: true,
      render: (row) => (
        <Link to={`/product-feeds/templates/${row.id}`} className="font-medium">
          {row.name}
        </Link>
      ),
    },
    {
      id: 'format',
      header: t('builder.settings.outputFormat'),
      hideOnMobile: true,
      render: (row) => row.outputFormat.toUpperCase(),
    },
    {
      id: 'fields',
      header: t('templates.fields', { count: 0 }),
      render: (row) => t('templates.fields', { count: row.fieldCount }),
    },
    {
      id: 'usedBy',
      header: t('feeds.table.template'),
      render: (row) =>
        row.usedByFeedCount === 0
          ? t('templates.usedBy.none')
          : t('templates.usedBy', { count: row.usedByFeedCount }),
    },
    {
      id: 'actions',
      header: '',
      render: (row) => (
        <span className="flex justify-end gap-1">
          {/* An anchor, not a fetch: the export is a file the operator hands to
              another installation, so the browser's own download machinery —
              filename from `Content-Disposition`, nothing held in memory — is
              the right one. Read-only administrators may export (FR-051 gates
              the *artefact*, which carries prices; a template does not). */}
          <a
            href={productFeedsClient.templateExportUrl(row.id)}
            className="b2b-btn b2b-btn--ghost inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm underline-offset-2 hover:underline"
          >
            {t('templates.export')}
          </a>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canWrite}
            title={!canWrite ? t('permission.needWrite') : undefined}
            onClick={(): void => duplicate(row)}
          >
            {t('templates.duplicate')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canWrite}
            title={!canWrite ? t('permission.needWrite') : undefined}
            onClick={(): void => remove(row)}
          >
            {t('templates.delete')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.subtitle')}
        actions={
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canWrite}
              title={!canWrite ? t('permission.needWrite') : undefined}
              onClick={(): void => {
                navigate('/product-feeds/templates/import');
              }}
            >
              <Upload size={14} aria-hidden="true" />
              {t('import.action.import')}
            </Button>
            <Button
              type="button"
              disabled={!canWrite}
              title={!canWrite ? t('permission.needWrite') : undefined}
              onClick={(): void => {
                navigate('/product-feeds/templates/new');
              }}
            >
              <Plus size={14} aria-hidden="true" />
              {t('templates.new')}
            </Button>
          </span>
        }
      />

      <FeedSectionTabs />

      {error !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-2">
            {error}
            <Button type="button" size="sm" variant="outline" onClick={load}>
              {t('feeds.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {inUse !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-col gap-1">
            <strong>{t('templates.delete.inUse.title')}</strong>
            <span>{t('templates.delete.inUse.body', { feeds: inUse.feeds.join(', ') })}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={(): void => setInUse(null)}
            >
              {t('builder.inspector.close')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The operator's own templates come first: they are the working set,
          the ones they came here to edit. The platform's are a shelf to copy
          from once, so they sit underneath. */}
      <h2 className="mb-2 text-sm font-medium">{t('templates.mine')}</h2>
      <div className="mb-6">
        {loading ? (
          <p className="b2b-help">{t('feeds.criteria.counting')}</p>
        ) : mine.length === 0 ? (
          <div className="b2b-empty">
            <p className="b2b-empty__title">{t('templates.empty.mine.title')}</p>
            <p className="b2b-empty__sub">{t('templates.empty.mine.subtitle')}</p>
          </div>
        ) : (
          // The platform's templates below are already cards; the operator's
          // own were the one surface on this screen sitting on bare page
          // background.
          <Card>
            <CardContent className="pt-6">
              <ResponsiveTable
                columns={columns}
                data={mine}
                keyExtractor={(row): string => row.id}
              />
            </CardContent>
          </Card>
        )}
      </div>

      <h2 className="mb-2 text-sm font-medium">{t('templates.provided')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {system.map((template) => {
          const isSkeleton = template.fieldCount <= SKELETON_FIELD_CEILING;
          return (
            <Card key={template.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2">
                  <span>{template.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-xs">
                    <Lock size={11} aria-hidden="true" />
                    {isSkeleton ? t('templates.startingPoint') : t('templates.readyToUse')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>{template.description}</p>
                {isSkeleton ? <p className="text-xs">{t('templates.startingPoint.hint')}</p> : null}
                <p className="text-xs">
                  {template.outputFormat.toUpperCase()} ·{' '}
                  {t(`builder.granularity.${template.itemGranularity}`)} ·{' '}
                  {t('templates.fields', { count: template.fieldCount })}
                </p>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(): void => {
                      navigate(`/product-feeds/templates/${template.id}`);
                    }}
                  >
                    {t('templates.view')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canWrite}
                    title={!canWrite ? t('permission.needWrite') : undefined}
                    onClick={(): void => duplicate(template)}
                  >
                    {t('templates.duplicate')}
                  </Button>
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

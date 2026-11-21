import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus } from 'lucide-react';
import type { ProjectTemplateSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Checkbox, EmptyState, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ProjectConfigurationTabs } from '../components/ProjectConfigurationTabs.js';
import { PROJECT_TEMPLATE_NEW_PATH, projectTemplatePath } from '../lib/configuration-paths.js';
import { ResponsiveTable, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

const NEW_PATH = PROJECT_TEMPLATE_NEW_PATH;

/**
 * The Project Templates (`specs/163-projects-and-tasks/`, User Story 3;
 * `contracts/admin-surfaces.md` §2, `/projects/settings/templates` since
 * issue #1557, the configuration's first tab).
 *
 * The Templates a new Project may start from, by name, each with its number
 * of Stages and when it last changed. Archived Templates — no longer offered
 * on the create screen — are listed only on request, marked as archived. The
 * route is `projects:configure`, the code every write on a Template needs.
 */
export function TemplatesList(): ReactNode {
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<ProjectTemplateSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const templates = await projectsApi.listTemplates({ active: !showArchived });
      if (current !== sequence.current) return;
      setRows(templates);
      setLoaded(true);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('templates.list.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [showArchived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ResponsiveColumn<ProjectTemplateSummary>[] = [
    {
      id: 'name',
      header: t('templates.list.col.name'),
      primary: true,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
          <Link
            to={projectTemplatePath(row.id)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.name}
          </Link>
          {row.archivedAt ? <Badge variant="secondary">{t('templates.list.archived')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'stages',
      header: t('templates.list.col.stages'),
      render: (row) => t('templates.list.stageCount', { count: row.stageCount }),
    },
    {
      id: 'updated',
      header: t('templates.list.col.updated'),
      hideOnMobile: true,
      render: (row) => new Date(row.updatedAt).toLocaleDateString(language),
    },
  ];

  const newTemplate = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to={NEW_PATH}>
        <Plus aria-hidden="true" />
        {t('templates.list.new')}
      </Link>
    </Button>
  );

  const emptyState = (
    <EmptyState
      icon={<Layers size={20} />}
      title={t('templates.list.empty.title')}
      description={t('templates.list.empty.body')}
      action={newTemplate}
    />
  );

  return (
    <>
      <PageHeader
        title={t('templates.list.title')}
        description={t('templates.list.description')}
        // With nothing listed the empty state carries the one action.
        actions={rows.length > 0 || showArchived || !loaded ? newTemplate : undefined}
      />
      <ProjectConfigurationTabs />

      <Card>
        <CardContent className="space-y-4" aria-busy={loading}>
          <label htmlFor="templates-archived" className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <Checkbox
              id="templates-archived"
              checked={showArchived}
              onChange={(event): void => setShowArchived(event.target.checked)}
            />
            {t('templates.list.showArchived')}
          </label>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('templates.list.loading')}
            </p>
          ) : (
            <ResponsiveTable data={rows} columns={columns} keyExtractor={(row): string => row.id} emptyState={emptyState} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TemplatesList;

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatDate } from '@endora-commerce/admin-kit/lib';
import { Link } from 'react-router-dom';
import { Layers, Plus } from 'lucide-react';
import type { ProjectTemplateSummary } from '@endora-commerce/contracts';
import { Badge, Button, Checkbox, EmptyState } from '@endora-commerce/admin-kit/ui';
import { ProjectConfigurationTabs } from '../components/ProjectConfigurationTabs.js';
import { PROJECT_TEMPLATE_NEW_PATH, projectTemplatePath } from '../lib/configuration-paths.js';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
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
 *
 * The kit's `ListPage` since issue #1749: *Show archived* is the toolbar row,
 * and a refresh keeps the rows on screen. The endpoint answers every Template,
 * unpaged — a configuration list — so there is no pager.
 */
export function TemplatesList(): ReactNode {
  const t = useTranslation('projects');
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
      if (current === sequence.current) {
        setLoaded(false);
        setError(errorMessage(failure, t('templates.list.error')));
      }
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
      render: (row) => formatDate(row.updatedAt, language),
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

  const listLoad: ListPageLoad = error ? { kind: 'error', message: error } : loaded ? { kind: 'ready' } : { kind: 'loading' };

  return (
    <ListPage
      title={t('templates.list.title')}
      description={t('templates.list.description')}
      // With nothing listed the empty state carries the one action.
      actions={rows.length > 0 || showArchived || !loaded ? newTemplate : undefined}
      tabs={<ProjectConfigurationTabs />}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={t('templates.list.toolbar')}
          filters={
            <label htmlFor="templates-archived" className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <Checkbox
                id="templates-archived"
                checked={showArchived}
                onChange={(event): void => setShowArchived(event.target.checked)}
              />
              {t('templates.list.showArchived')}
            </label>
          }
        />
      }
      count={t('templates.list.count', { count: rows.length })}
      load={listLoad}
      busy={loading && loaded}
      onRetry={(): void => void load()}
    >
      <ResponsiveTable data={rows} columns={columns} keyExtractor={(row): string => row.id} emptyState={emptyState} />
    </ListPage>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TemplatesList;

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminZoneProps, ProjectSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { StageDot } from '../components/StageDot.js';
import { StateBadge } from '../components/StateBadge.js';

/**
 * Projects' panel on the Organization screen — the contribution to
 * `organization.detail.after` (`specs/163-projects-and-tasks/`, User Story 11;
 * `contracts/admin-surfaces.md` §3, §7).
 *
 * The Organization's Projects the reader may see, newest first, each with its
 * state and current Stage and a link to its screen, and a "New project" link
 * that carries the Organization to the create form. The list endpoint applies
 * Organization reach and visibility, so nothing here filters for safety.
 *
 * The zone renderer has already decided that `projects` is present and that
 * the person holds `projects:read` before this chunk is fetched, so nothing
 * here asks either question again. `projects:write` is asked, because the
 * create form is gated on it and a link to a refused screen is a dead end.
 *
 * *All projects* opens the Projects list narrowed to this Organization, which
 * keeps its filters in the address (issue #454).
 */
const PAGE = 10;

type State =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; rows: ProjectSummary[]; total: number };

export type OrganizationProjectsProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationProjects({ organizationId }: OrganizationProjectsProps): ReactNode {
  const t = useTranslation('projects');
  const { hasPermission } = useAuth();
  const headingId = useId();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    projectsApi
      .listProjects({ organizationId, limit: PAGE })
      .then((page) => {
        if (alive) setState({ phase: 'ready', rows: page.items, total: page.total });
      })
      .catch(() => {
        if (alive) setState({ phase: 'failed' });
      });
    return (): void => {
      alive = false;
    };
  }, [organizationId]);

  return (
    <section aria-labelledby={headingId}>
      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>
              <h2 id={headingId} className="text-base font-semibold">
                {t('organizationPanel.title')}
              </h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('organizationPanel.description')}</p>
          </div>
          {hasPermission('projects:write') ? (
            <Link
              to={`/projects/new?organizationId=${organizationId}`}
              className="inline-flex min-h-11 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent sm:min-h-9"
            >
              {t('organizationPanel.new')}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {state.phase === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('organizationPanel.loading')}
            </p>
          ) : null}
          {state.phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              {t('organizationPanel.error')}
            </p>
          ) : null}
          {state.phase === 'ready' && state.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('organizationPanel.empty')}</p>
          ) : null}
          {state.phase === 'ready' && state.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('organizationPanel.column.project')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('organizationPanel.column.state')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('organizationPanel.column.stage')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/projects/${row.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {row.number}
                        </Link>{' '}
                        <span className="[overflow-wrap:anywhere]">{row.title}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <StateBadge state={row.state} />
                      </td>
                      <td className="py-2">
                        {row.currentStage ? (
                          <span className="inline-flex items-center gap-2">
                            <StageDot color={row.currentStage.color} />
                            <span>{row.currentStage.name}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t('organizationPanel.noStage')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {state.phase === 'ready' && state.total > state.rows.length ? (
            <p className="text-sm text-muted-foreground">
              {t('organizationPanel.more', { shown: state.rows.length, total: state.total })}{' '}
              <Link to={`/projects?organizationId=${encodeURIComponent(organizationId)}`} className="text-primary underline underline-offset-4">
                {t('organizationPanel.all')}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrganizationProjects;

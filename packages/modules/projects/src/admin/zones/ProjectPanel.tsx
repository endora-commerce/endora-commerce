import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectPanelRecordKind, ProjectSummary } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { StageDot } from '../components/StageDot.js';
import { StateBadge } from '../components/StateBadge.js';
import { calendarDateLabel } from '../lib/labels.js';

/**
 * The Project a record is in, on that record's own screen
 * (`specs/163-projects-and-tasks/`, User Story 6; `contracts/admin-surfaces.md`
 * §3; spec FR-022): the Project's number — a link to it — its title, and its
 * current Stage with the Stage's deadline.
 *
 * The zone renderer has already decided that `projects` is present and that
 * the reader holds `projects:read` before this chunk is fetched; the record's
 * screen belongs to another module and hands over an id and nothing else.
 *
 * **Nothing at all** while the answer is awaited and when there is none — the
 * record is in no Project, or in one the reader may not see (404, US5 sc.5),
 * or the reader may not read records of its kind (403): the screen is then the
 * one without the panel. Only a failure of another kind is said, in the
 * panel's own card.
 */
export interface ProjectPanelProps {
  kind: ProjectPanelRecordKind;
  recordId: string;
}

type State = { phase: 'loading' } | { phase: 'none' } | { phase: 'failed' } | { phase: 'ready'; project: ProjectSummary };

/** The answers that mean "no Project to show", not "something went wrong". */
const NO_PROJECT = new Set([403, 404, 503]);

export function ProjectPanel({ kind, recordId }: ProjectPanelProps): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const headingId = useId();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    projectsApi
      .projectOfRecord(kind, recordId)
      .then((project) => {
        if (alive) setState({ phase: 'ready', project });
      })
      .catch((failure: unknown) => {
        if (!alive) return;
        setState(failure instanceof ApiError && NO_PROJECT.has(failure.status) ? { phase: 'none' } : { phase: 'failed' });
      });
    return (): void => {
      alive = false;
    };
  }, [kind, recordId]);

  if (state.phase === 'loading' || state.phase === 'none') return null;

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle id={headingId}>
            {t('panel.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {state.phase === 'failed' ? (
            <p role="alert" className="text-destructive">
              {t('panel.error')}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Link
                  to={`/projects/${state.project.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {state.project.number}
                </Link>
                <span className="min-w-0 [overflow-wrap:anywhere]">{state.project.title}</span>
                <StateBadge state={state.project.state} />
              </p>
              <dl>
                <dt className="text-muted-foreground">{t('panel.stage')}</dt>
                <dd className="flex flex-wrap items-center gap-x-2">
                  {state.project.currentStage ? (
                    <>
                      <StageDot color={state.project.currentStage.color} />
                      <span>{state.project.currentStage.name}</span>
                      {state.project.currentStage.deadlineOn ? (
                        <span
                          className={
                            state.project.currentStage.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'
                          }
                        >
                          {t('panel.deadline', { date: calendarDateLabel(state.project.currentStage.deadlineOn, language) })}
                          {state.project.currentStage.overdue ? ` · ${t('list.overdue')}` : null}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t('panel.closed')}</span>
                  )}
                </dd>
              </dl>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

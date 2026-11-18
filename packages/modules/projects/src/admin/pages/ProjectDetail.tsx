import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { ProjectDetail as ProjectDetailData } from '@endora-commerce/contracts';
import { cn, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { DeleteProjectDialog } from '../components/DeleteProjectDialog.js';
import { StageBar } from '../components/StageBar.js';
import { StateBadge } from '../components/StateBadge.js';
import { errorMessage, valueLabel } from '../lib/labels.js';
import { offeredTabs, searchForTab, tabFromSearch } from './project-detail/tabs.js';

const LIST_PATH = '/projects';

/** A quiet "·" between two parts of the header's meta line. */
function MetaSeparator(): ReactNode {
  return (
    <span aria-hidden="true" className="px-1.5">
      ·
    </span>
  );
}

/**
 * One Project (`specs/163-projects-and-tasks/`, User Story 1;
 * `contracts/admin-surfaces.md` §2).
 *
 * Top to bottom: **the header** — number, title, state, value and
 * Organizations (or "Internal project"); **the Stage bar** — where the Project
 * is and what it may do next; **the tabs**, declared as data in
 * `project-detail/tabs.ts`.
 *
 * **The selected tab is in the address** (`?tab=<id>`), so it survives a reload
 * and can be linked to; the default tab is the bare address. A tab another
 * module's presence decides — *Tasks* — is offered only while that module is
 * present and readable; its address otherwise opens the default tab.
 *
 * **Deleting the Project** is offered to a writer, behind a confirmation; a
 * refusal (409 `PROJECT_HAS_LINKS`) is shown in the dialog, in the server's
 * words, and a deleted Project leaves its screen for the list.
 *
 * A Project the operator may not see answers exactly as one that does not
 * exist (404 `PROJECT_NOT_FOUND`), and the screen says what the server said.
 */
export function ProjectDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const isVisible = useSurfaceVisibility();
  const sequence = useRef(0);
  const tablistRef = useRef<HTMLDivElement>(null);

  const tabs = offeredTabs(isVisible);
  const activeTab = tabFromSearch(searchParams, tabs);

  const selectTab = useCallback(
    (tabId: string): void => {
      // The tab is a view of the same page: it replaces the entry instead of adding one.
      setSearchParams((previous) => searchForTab(previous, tabId), { replace: true });
    },
    [setSearchParams],
  );

  const reload = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await projectsApi.getProject(id);
      if (current === sequence.current) setProject(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('detail.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setProject(null);
    setLoading(true);
    void reload();
  }, [reload]);

  const back = { label: t('detail.back'), to: LIST_PATH };

  if (project === null) {
    return (
      <>
        <PageHeader title={t('list.title')} back={back} />
        {loading ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {t('detail.loading')}
            </p>
            <div aria-hidden="true" className="mt-4 space-y-6">
              <div className="h-28 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              <div className="h-72 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            </div>
          </>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error ?? t('detail.error')}</span>
              <span className="flex gap-2">
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void reload()}>
                  {tCore('common.action.retry')}
                </Button>
                <Button className="min-h-11 sm:min-h-8" asChild variant="ghost" size="sm">
                  <Link to={LIST_PATH}>{t('detail.back')}</Link>
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0];
  const TabComponent = tab?.component;

  /** Arrow keys walk the strip, as the tabs pattern has it; Tab leaves it for the panel. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((candidate) => candidate.id === tab?.id);
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    const target = tabs[next];
    if (!target) return;
    event.preventDefault();
    selectTab(target.id);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#project-tab-${target.id}`)?.focus();
  };

  return (
    <>
      <PageHeader
        className="[&>div:first-child]:min-w-0 [&_h1]:flex-wrap"
        title={
          <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
            <span>{project.title}</span>
            <StateBadge state={project.state} />
          </span>
        }
        description={
          <>
            <span>{project.number}</span>
            <MetaSeparator />
            <span className="[overflow-wrap:anywhere]">
              {project.organizations.length === 0
                ? t('detail.internal')
                : project.organizations.map((organization) => organization.name).join(', ')}
            </span>
            <MetaSeparator />
            <span className="tabular-nums">{project.value ? valueLabel(project.value) : t('detail.noValue')}</span>
          </>
        }
        back={back}
        actions={
          project.permissions.canWrite ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 text-destructive hover:text-destructive sm:min-h-9"
              onClick={(): void => setDeleting(true)}
            >
              <Trash2 aria-hidden="true" />
              {t('detail.delete')}
            </Button>
          ) : undefined
        }
      />

      {deleting ? (
        <DeleteProjectDialog
          project={project}
          onClose={(): void => setDeleting(false)}
          onDeleted={(): void => void navigate(LIST_PATH)}
        />
      ) : null}

      {/* A later read that failed leaves the last good one on screen. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-6">
        <Card className="min-w-0">
          <CardContent>
            <StageBar key={project.id} project={project} onChange={setProject} reload={reload} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="b2b-tabs-scroll px-1 pt-1">
            <div
              ref={tablistRef}
              className="b2b-tabs"
              role="tablist"
              aria-label={t('tabs.label')}
              onKeyDown={onTabKeyDown}
            >
              {tabs.map((candidate) => {
                const selected = candidate.id === tab?.id;
                const count = candidate.count?.(project) ?? 0;
                const label = t(candidate.labelKey);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    id={`project-tab-${candidate.id}`}
                    aria-selected={selected}
                    // A bare number says nothing read aloud: the name says what is
                    // counted, and still begins with the words on screen.
                    aria-label={
                      count > 0 && candidate.countLabelKey ? t(candidate.countLabelKey, { label, count }) : undefined
                    }
                    aria-controls="project-tabpanel"
                    tabIndex={selected ? 0 : -1}
                    className={cn('b2b-tab', selected && 'is-active')}
                    onClick={(): void => selectTab(candidate.id)}
                  >
                    {label}
                    {/* Zero draws nothing; a real space, so a copy reads "Messages 2". */}
                    {count > 0 ? (
                      <>
                        {' '}
                        <span className="b2b-badge tabular-nums">{count}</span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <CardContent
            id="project-tabpanel"
            role="tabpanel"
            aria-labelledby={`project-tab-${tab?.id ?? ''}`}
          >
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {tCore('common.state.loading')}
                </p>
              }
            >
              {TabComponent ? (
                <TabComponent key={project.id} project={project} onChange={setProject} reload={reload} />
              ) : null}
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default ProjectDetail;

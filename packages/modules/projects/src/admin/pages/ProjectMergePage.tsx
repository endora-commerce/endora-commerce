import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProjectMergeView } from '@endora-commerce/contracts';
import {
  ApiError,
  formatDateTime,
  useDetailResource,
  useSurfaceVisibility,
} from '@endora-commerce/admin-kit/lib';
import { ConfirmDialog, DetailHeaderActions, RowActionMenuItem } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DetailSkeleton,
  EditorSection,
  PageHeader,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { projectMergesApi } from '../merge/merge-api.js';
import { MergeStateBadge, MergeStepStateBadge } from '../merge/MergeStateBadge.js';
import { isCancellable, isHostStep, participantLabel, phasesOf, progressOf, refusalMessage, type Translate } from '../merge/merge-view.js';

/** How often a running merge is read again. */
const POLL_MS = 3000;

/**
 * A Project merge's progress (`specs/192-organization-merge/` US6, FR-010,
 * FR-011, FR-080, FR-081; `contracts/project-merge.md` §4) at
 * `/projects/merges/:mergeId` — the Organization merge's screen, for Projects.
 *
 * The steps grouped by phase in the order they run, each with its state and
 * what it moved; how many of them are finished (Goal-Gradient); a running merge
 * is read again every few seconds. A merge that needs attention says so with
 * its error and offers **Resume** as the one primary action; **Cancel** is in
 * the "More" menu, away from it, only while no record has moved, and asks first.
 * Both are `projects:merge`'s; the screen itself opens under
 * `projects:read`, as the merge's read does.
 */
export function ProjectMergePage(): ReactNode {
  const { mergeId = '' } = useParams<{ mergeId: string }>();
  const own = useTranslation('projects');
  const core = useTranslation('core');
  const { t, language } = useTranslationContext();
  const translate: Translate = t;
  const isVisible = useSurfaceVisibility();
  const canMerge = isVisible({ module: 'projects', requiredPermission: 'projects:merge' });
  const status = useInlineStatus();
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const resource = useDetailResource<ProjectMergeView>(mergeId, async () => {
    try {
      return await projectMergesApi.get(mergeId);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') return null;
      throw err;
    }
  });
  const merge = resource.data;
  const { refresh } = resource;

  const running = merge?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return (): void => clearInterval(timer);
  }, [running, refresh]);

  if (resource.initialLoading) return <DetailSkeleton label={own('merge.page.loading')} />;
  if (merge === null) {
    return resource.error !== null ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {resource.error instanceof ApiError ? resource.error.envelope.error.message : own('merge.page.loadError')}
          <Button variant="outline" size="sm" onClick={(): void => void refresh()}>
            {core('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="warning">
        <AlertDescription>{own('merge.page.notFound')}</AlertDescription>
      </Alert>
    );
  }

  const run = async (action: 'resume' | 'cancel'): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await (action === 'resume'
        ? projectMergesApi.resume(merge.id, merge.version)
        : projectMergesApi.cancel(merge.id, merge.version));
      status.show(own(action === 'resume' ? 'merge.action.resumed' : 'merge.action.cancelled'));
      setConfirmingCancel(false);
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.envelope.error.message : own('merge.action.failed'));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const survivor = merge.survivorName ?? merge.survivorId;
  const loser = merge.loserName ?? merge.loserId;
  const progress = progressOf(merge);
  const cancellable = canMerge && isCancellable(merge);
  const needsAttention = merge.state === 'needs_attention';
  const started = formatDateTime(merge.startedAt, language);

  return (
    <>
      <PageHeader
        back={{ label: own('merge.list.title'), to: '/projects/merges' }}
        title={own('merge.page.title', { loser, survivor })}
        titleActions={<MergeStateBadge state={merge.state} />}
        description={
          merge.actorName
            ? own('merge.page.startedBy', { date: started, actor: merge.actorName })
            : own('merge.page.started', { date: started })
        }
        actions={
          <DetailHeaderActions
            status={status.props}
            moreBusy={busy}
            primary={
              canMerge && needsAttention ? (
                <Button type="button" disabled={busy} aria-busy={busy ? true : undefined} onClick={(): void => void run('resume')}>
                  {own('merge.action.resume')}
                </Button>
              ) : undefined
            }
          >
            {cancellable ? (
              <RowActionMenuItem destructive onSelect={(): void => setConfirmingCancel(true)}>
                {own('merge.action.cancel')}
              </RowActionMenuItem>
            ) : null}
          </DetailHeaderActions>
        }
      />

      {needsAttention ? (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>{own('merge.attention.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {merge.lastErrorCode !== null
                ? own('merge.attention.error', { error: refusalMessage(translate, { code: merge.lastErrorCode }) })
                : own('merge.attention.body')}
            </p>
            <p>{own(canMerge ? 'merge.attention.resumeHint' : 'merge.attention.askHint')}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {merge.state === 'completed' ? (
        // The merge's state, not an action's result (#1499): a plain notice; the badge says "Completed".
        <Alert variant="default" className="mb-4">
          <AlertDescription>{own('merge.page.completed', { loser, survivor })}</AlertDescription>
        </Alert>
      ) : null}
      {merge.state === 'cancelled' ? (
        <Alert variant="default" className="mb-4">
          <AlertDescription>{own('merge.page.cancelledNote')}</AlertDescription>
        </Alert>
      ) : null}
      {actionError !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent {...resource.busyProps} className="space-y-(--section-gap)">
          <EditorSection title={own('merge.page.records')}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{own('merge.page.survivor')}</dt>
                <dd>
                  <Link className="underline underline-offset-2" to={`/projects/${merge.survivorId}`}>
                    {survivor}
                  </Link>
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{own('merge.page.loser')}</dt>
                <dd>
                  <Link className="underline underline-offset-2" to={`/projects/${merge.loserId}`}>
                    {loser}
                  </Link>
                </dd>
              </div>
            </dl>
          </EditorSection>

          <EditorSection
            title={own('merge.page.progress')}
            description={own('merge.progress.count', { done: progress.done, total: progress.total })}
          >
            <progress className="h-2 w-full" max={progress.total} value={progress.done} aria-label={own('merge.page.progress')} />
            <ol className="grid gap-4">
              {phasesOf(merge).map((phase) => (
                <li key={phase.phase} className="grid gap-2">
                  <h3 className="text-sm font-medium">{own(`merge.phase.${phase.phase}`)}</h3>
                  {phase.phase === 'finalize' ? (
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{own('merge.step.finalize')}</span>
                      <MergeStepStateBadge state={phase.state === 'done' ? 'done' : 'pending'} />
                    </div>
                  ) : (
                    <ul className="divide-y text-sm">
                      {phase.steps.map((step) => (
                        <li key={`${step.moduleId}:${step.key}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
                          <span className="grid gap-0.5">
                            <span>{isHostStep(step) ? own('merge.step.hostStructure') : participantLabel(translate, step.moduleId, step.key)}</span>
                            {step.trailing ? <span className="text-xs text-muted-foreground">{own('merge.step.trailing')}</span> : null}
                            {step.state === 'deferred' ? (
                              <span className="text-xs text-muted-foreground">{own('merge.step.deferred')}</span>
                            ) : null}
                            {step.lastErrorCode !== null && step.state === 'failed' ? (
                              <span className="text-xs text-destructive">{refusalMessage(translate, { code: step.lastErrorCode })}</span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="tabular-nums text-muted-foreground">{own('merge.step.moved', { count: step.movedCount })}</span>
                            <MergeStepStateBadge state={step.state} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </EditorSection>
        </CardContent>
      </Card>

      {confirmingCancel ? (
        <ConfirmDialog
          title={own('merge.cancel.title')}
          message={own('merge.cancel.message', { loser, survivor })}
          confirmLabel={own('merge.cancel.confirm')}
          cancelLabel={own('merge.cancel.keep')}
          destructive
          busy={busy}
          onConfirm={(): void => void run('cancel')}
          onCancel={(): void => setConfirmingCancel(false)}
        />
      ) : null}
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default ProjectMergePage;

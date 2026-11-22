import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleCheck, CircleX, RotateCcw } from 'lucide-react';
import type { ProjectDetail, ProjectStage, ProjectStageGateOpenTasksDetails } from '@endora-commerce/contracts';
import { ApiError, cn, formatDate } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { calendarDateLabel, errorMessage } from '../lib/labels.js';
import { CloseProjectDialog } from './CloseProjectDialog.js';
import { StageDot } from './StageDot.js';

type OpenTask = NonNullable<ProjectStageGateOpenTasksDetails['openTasks']>[number];

/** The details of a closed completion gate's refusal, or `undefined` for any other failure. */
function gateDetailsOf(failure: unknown): { openTaskCount?: unknown; openTasks?: unknown } | undefined {
  if (!(failure instanceof ApiError) || failure.envelope.error.code !== 'PROJECT_STAGE_GATE_OPEN_TASKS') return undefined;
  return (failure.envelope.error as { details?: { openTaskCount?: unknown; openTasks?: unknown } }).details;
}

/**
 * How many Tasks a closed completion gate counts in its refusal — named or not:
 * the Tasks are named only to a caller who may read Tasks (T144 F2).
 */
function openTaskCountOf(failure: unknown): number {
  const count = gateDetailsOf(failure)?.openTaskCount;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
}

/** The open Tasks a closed completion gate names in its refusal, or none. */
function openTasksOf(failure: unknown): OpenTask[] {
  const listed = gateDetailsOf(failure)?.openTasks;
  return Array.isArray(listed)
    ? listed.filter(
        (task): task is OpenTask =>
          typeof task === 'object' &&
          task !== null &&
          typeof (task as OpenTask).id === 'string' &&
          typeof (task as OpenTask).number === 'string' &&
          typeof (task as OpenTask).title === 'string',
      )
    : [];
}

export interface StageBarProps {
  project: ProjectDetail;
  /** Put the server's newer answer on screen. */
  onChange: (project: ProjectDetail) => void;
  /** Read the Project again, after a refusal that says it has changed. */
  reload: () => Promise<void>;
}

/**
 * Where a Project is among its Stages, and what it may do next
 * (`specs/163-projects-and-tasks/`, User Story 1; `contracts/admin-surfaces.md` §2).
 *
 * Every Stage is drawn in order, the current one marked — `aria-current="step"`
 * and the word, not the colour alone — with its deadline, and "overdue" in
 * words when it has passed. **Only what can happen next is offered**: a button
 * per move the Project's workflow permits out of its current Stage, "Close as
 * completed" where that Stage permits completion, "Close as lost" through a
 * dialog that requires a reason, and "Reopen" on a closed Project.
 *
 * Every write names the `version` the screen read; a 409 is shown in the
 * server's own words — a guard's reason included — and the Project is read
 * again, so what is on screen is what is true. A closed completion gate's
 * refusal (`PROJECT_STAGE_GATE_OPEN_TASKS`) also lists the open Tasks it
 * names, each linked to its screen — or, to somebody who may not read Tasks,
 * says how many there are. Without `canWrite` the bar is a picture.
 */
export function StageBar(props: StageBarProps): ReactNode {
  const { project, onChange, reload } = props;
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const headingId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [notice, setNotice] = useState('');
  const [closingAsLost, setClosingAsLost] = useState(false);

  const canWrite = project.permissions.canWrite;
  const open = project.state === 'open';
  const currentId = project.currentStage?.id ?? null;
  const stages = [...project.stages].sort((a, b) => a.position - b.position);
  const current = stages.find((stage) => stage.id === currentId) ?? null;
  const targets: ProjectStage[] = open
    ? stages.filter((stage) => project.moves.some((move) => move.fromStageId === currentId && move.toStageId === stage.id))
    : [];

  /** Run one write; on a refusal show the server's sentence, and re-read on a 409. */
  const run = async (action: string, write: () => Promise<ProjectDetail>, done: (next: ProjectDetail) => string): Promise<void> => {
    setBusy(action);
    setError(null);
    setOpenTasks([]);
    setOpenTaskCount(0);
    setNotice('');
    try {
      const next = await write();
      onChange(next);
      setNotice(done(next));
    } catch (failure) {
      setError(errorMessage(failure, t('stageBar.error')));
      setOpenTasks(openTasksOf(failure));
      setOpenTaskCount(openTaskCountOf(failure));
      if (failure instanceof ApiError && failure.status === 409) void reload();
    } finally {
      setBusy(null);
    }
  };

  const moveTo = (stage: ProjectStage): Promise<void> =>
    run(
      stage.id,
      async () => (await projectsApi.move(project.id, stage.id, project.version)).project,
      () => t('stageBar.moved', { stage: stage.name }),
    );

  const complete = (): Promise<void> =>
    run(
      'complete',
      () => projectsApi.close(project.id, { outcome: 'completed', version: project.version }),
      () => t('stageBar.closedNotice'),
    );

  const reopen = (): Promise<void> =>
    run(
      'reopen',
      () => projectsApi.reopen(project.id, project.version),
      () => t('stageBar.reopened'),
    );

  const buttonClass = 'h-auto min-h-11 max-w-full whitespace-normal py-1.5 text-left [overflow-wrap:anywhere] sm:min-h-9';

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-base font-semibold">
        {t('stageBar.heading')}
      </h2>

      <ol className="flex flex-wrap gap-2">
        {stages.map((stage, index) => {
          const isCurrent = stage.id === currentId;
          return (
            <li
              key={stage.id}
              data-stage={stage.id}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm sm:min-h-9',
                isCurrent ? 'border-primary bg-primary/5 font-semibold' : 'text-muted-foreground',
              )}
            >
              <span aria-hidden="true" className="tabular-nums">
                {index + 1}.
              </span>
              <StageDot color={stage.color} />
              <span className="[overflow-wrap:anywhere]">{stage.name}</span>
              {isCurrent ? <span className="text-xs font-normal text-muted-foreground">({t('stageBar.current')})</span> : null}
            </li>
          );
        })}
      </ol>

      {open && project.currentStage?.deadlineOn ? (
        <p className={project.currentStage.overdue ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}>
          {t('stageBar.deadline', { date: calendarDateLabel(project.currentStage.deadlineOn, language) })}
          {project.stages.find((stage) => stage.id === project.currentStage?.id)?.deadlineManual
            ? ` (${t('stageBar.deadlineManualNote')})`
            : null}
          {project.currentStage.overdue ? ` · ${t('list.overdue')}` : null}
        </p>
      ) : null}

      {!open && project.closedAt ? (
        <div className="space-y-1 text-sm">
          <p>
            {t(project.state === 'completed' ? 'stageBar.closed.completed' : 'stageBar.closed.lost', {
              date: formatDate(project.closedAt, language),
              stage: current?.name ?? '',
            })}
          </p>
          {project.lossReason ? (
            <p className="text-muted-foreground">{t('stageBar.lossReason', { reason: project.lossReason.name })}</p>
          ) : null}
          {project.lossComment ? <p className="whitespace-pre-wrap text-muted-foreground">{project.lossComment}</p> : null}
        </div>
      ) : null}

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">{t('stageBar.readOnly')}</p>
      ) : open ? (
        <div className="space-y-3">
          {targets.length > 0 ? (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                {t('stageBar.next')}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </p>
              <ul className="flex flex-wrap gap-2">
                {targets.map((stage) => (
                  <li key={stage.id} className="max-w-full">
                    <Button
                      type="button"
                      variant="outline"
                      className={buttonClass}
                      aria-label={t('stageBar.moveTo', { stage: stage.name })}
                      disabled={busy !== null}
                      aria-busy={busy === stage.id}
                      onClick={(): void => void moveTo(stage)}
                    >
                      <StageDot color={stage.color} />
                      <span>{stage.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('stageBar.none')}</p>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {current?.completionPermitted ? (
              <Button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                aria-busy={busy === 'complete'}
                onClick={(): void => void complete()}
              >
                <CircleCheck aria-hidden="true" />
                {t('stageBar.complete')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className={`${buttonClass} text-destructive hover:text-destructive`}
              disabled={busy !== null}
              onClick={(): void => setClosingAsLost(true)}
            >
              <CircleX aria-hidden="true" />
              {t('stageBar.lose')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className={buttonClass}
          disabled={busy !== null}
          aria-busy={busy === 'reopen'}
          onClick={(): void => void reopen()}
        >
          <RotateCcw aria-hidden="true" />
          {t('stageBar.reopen')}
        </Button>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            {openTasks.length > 0 ? (
              <>
                <p>{t('stageBar.openTasks')}</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {openTasks.map((task) => (
                    <li key={task.id} className="[overflow-wrap:anywhere]">
                      <Link to={`/tasks/${task.id}`} className="underline underline-offset-4">
                        {task.number} {task.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : openTaskCount > 0 ? (
              <p>{t('stageBar.openTaskCount', { count: openTaskCount })}</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Mounted before it has text, so the announcement is reliable (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {notice}
      </p>

      {closingAsLost ? (
        <CloseProjectDialog
          project={project}
          reload={reload}
          onClose={(): void => setClosingAsLost(false)}
          onClosed={(closed): void => {
            setClosingAsLost(false);
            onChange(closed);
            setNotice(t('stageBar.closedNotice'));
          }}
        />
      ) : null}
    </section>
  );
}

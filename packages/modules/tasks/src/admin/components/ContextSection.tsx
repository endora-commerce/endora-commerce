import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, X } from 'lucide-react';
import type { TaskContextOption, TaskDetail, UpdateTaskBody } from '@endora-commerce/contracts';
import { Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';
import { LookupPicker } from './LookupPicker.js';

export interface ContextSectionProps {
  task: TaskDetail;
  /** The reader may change this Task (`tasks:write`, and not someone else's private Task). */
  canChange: boolean;
  busy: boolean;
  /** One write of the Task; resolves `true` when it was made, and the screen says `notice`. */
  onWrite: (body: UpdateTaskBody, notice: string) => Promise<boolean>;
}

/**
 * The record a Task belongs to — its context (`specs/163-projects-and-tasks/`
 * User Story 2; `specs/165-task-management/` User Story 6 scenario 3;
 * `contracts/admin-surfaces.md` §2): named as its owner describes it, linked
 * while it is available and named without a link when it is not, with the
 * group (a Project's Stage) and the note the owner wrote.
 *
 * A writer places the Task in a record and group, moves it, or takes it out.
 * The picker reads `GET /tasks/lookups/contexts` — the records the writer may
 * see and put a Task into, through each owner's own answer; this module names
 * none of them. The move is offered only where the record's owner lets the
 * reader change its Tasks (`canChangeTasks`), and never for a private Task,
 * which belongs to no record (FR-038). The record decides who sees the Task,
 * as in feature 163.
 */
export function ContextSection(props: ContextSectionProps): ReactNode {
  const { task, canChange, busy } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const headingId = useId();
  const pickerId = useId();
  const groupId = useId();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<TaskContextOption | null>(null);
  const [group, setGroup] = useState('');
  const focus = useEditorFocus(picking);
  const { confirm, confirmDialog } = useConfirmDialog();
  const mayMove = canChange && !task.private && (task.context === null || task.context.canChangeTasks);

  const close = (): void => {
    setPicking(false);
    setChosen(null);
    setGroup('');
  };

  const save = async (): Promise<void> => {
    if (!chosen) return;
    const written = await props.onWrite(
      { context: { contextType: chosen.contextType, contextId: chosen.id, contextGroupId: group === '' ? null : group } },
      t('context.saved'),
    );
    if (written) close();
  };

  /**
   * Taking the Task out of its record changes who sees it — from the record's
   * readers to everyone who may see Tasks — so it is asked first, saying so (issue #512).
   */
  const remove = async (): Promise<void> => {
    if (task.context === null) return;
    const ok = await confirm({
      title: t('context.removeConfirm.title'),
      message: t('context.removeConfirm.body', { record: task.context.label }),
      confirmLabel: t('context.remove'),
      destructive: true,
    });
    if (!ok) return;
    const written = await props.onWrite({ context: null }, t('context.removed'));
    // This button unmounts with the record; focus goes to the opener that is left.
    if (written) focus.returnFocus();
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2 text-sm">
      <h2 id={headingId} className="text-base font-semibold">
        {t('detail.context')}
      </h2>
      {task.context === null ? (
        <p className="text-muted-foreground">{t('detail.contextNone')}</p>
      ) : (
        <>
          {task.context.available && task.context.href ? (
            <Link
              to={task.context.href}
              className="font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
            >
              {task.context.label}
            </Link>
          ) : (
            <p className="font-medium [overflow-wrap:anywhere]">{task.context.label}</p>
          )}
          {task.context.groupLabel ? <p className="text-muted-foreground">{task.context.groupLabel}</p> : null}
          {task.context.available ? null : (
            <p className="text-xs text-muted-foreground">{t('detail.contextUnavailable')}</p>
          )}
          {task.contextNote ? (
            <div className="space-y-0.5 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">{t('detail.contextNote')}</p>
              <p className="[overflow-wrap:anywhere]">{task.contextNote}</p>
            </div>
          ) : null}
        </>
      )}

      {mayMove && !picking ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            ref={focus.openerRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={busy}
            onClick={(): void => setPicking(true)}
          >
            <ArrowRightLeft aria-hidden="true" />
            {task.context === null ? t('context.choose') : t('context.change')}
          </Button>
          {task.context !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={(): void => void remove()}
            >
              <X aria-hidden="true" />
              {t('context.remove')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {picking ? (
        <div ref={focus.editorRef} className="space-y-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor={pickerId}>{t('context.picker')}</Label>
            <LookupPicker
              id={pickerId}
              load={tasksApi.lookupContexts}
              value={chosen}
              onChange={(option): void => {
                setChosen(option);
                setGroup(option?.groups[0]?.id ?? '');
              }}
              placeholder={t('context.placeholder')}
              emptyMessage={t('context.searchEmpty')}
              loadingMessage={t('context.searching')}
              disabled={busy}
            />
          </div>
          {chosen && chosen.groups.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor={groupId}>{t('context.groupPicker')}</Label>
              <Select id={groupId} value={group} disabled={busy} onChange={(event): void => setGroup(event.target.value)}>
                {chosen.groups.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value="">{t('context.groupNone')}</option>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy || chosen === null}
              aria-busy={busy}
              onClick={(): void => void save()}
            >
              {tCore('common.action.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={close}
            >
              {tCore('common.action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  );
}

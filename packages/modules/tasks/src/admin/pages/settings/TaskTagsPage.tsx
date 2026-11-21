import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import type { TaskTag } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../../api.js';
import { TaskTagDeleteDialog } from '../../components/tags/TaskTagDeleteDialog.js';
import { TaskTagDialog, type TaskTagDialogSubmit } from '../../components/tags/TaskTagDialog.js';
import { SettingsEmptyState } from '../../components/SettingsEmptyState.js';
import { errorMessage } from '../../lib/labels.js';
import { TaskConfigurationTabs } from '../../components/TaskConfigurationTabs.js';

type DialogState = { kind: 'create' } | { kind: 'edit'; tag: TaskTag } | null;

/**
 * The Task tags (`specs/165-task-management/`, User Story 9 — FR-010, FR-041,
 * research R-10; `contracts/admin-surfaces.md` §1): the one platform-wide list
 * of tags a Task may carry, each with how many Tasks the operator can see
 * carry it. Adding, renaming, recolouring and deleting a tag are
 * configuration — the route is gated `tasks:configure`; whoever edits Tasks
 * picks among these tags but cannot add one (scenario 4).
 *
 * After every write the list is read again, so the usage counts are the
 * server's.
 */
export function TaskTagsPage(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const [tags, setTags] = useState<TaskTag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskTag | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setTags(await tasksApi.listTags());
    } catch (error) {
      setLoadError(errorMessage(error, t('tags.error.load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitTag = async (submit: TaskTagDialogSubmit): Promise<void> => {
    if (submit.mode === 'create') await tasksApi.createTag(submit.body);
    else await tasksApi.updateTag(submit.id, submit.body);
    await load();
  };

  const deleteTag = async (): Promise<void> => {
    if (!pendingDelete) return;
    await tasksApi.deleteTag(pendingDelete.id);
    await load();
  };

  const openCreate = (): void => setDialog({ kind: 'create' });

  // The one place for Add (issue #1562, WORK-13): the header's filled button,
  // as on the CRM and Projects dictionaries — hidden while the list is empty,
  // where the empty state's own Add is the view's one primary (Von Restorff).
  const header = (
    <>
      <PageHeader
        title={t('tags.title')}
        actions={
          tags !== null && tags.length > 0 ? (
            <Button className="min-h-11 sm:min-h-9" onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t('tags.add')}
            </Button>
          ) : undefined
        }
      />
      <TaskConfigurationTabs />
    </>
  );

  if (tags === null) {
    return (
      <>
        {header}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tCore('common.state.loading')}
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError ?? t('tags.error.load')}</span>
              <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                {tCore('common.action.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  return (
    <>
      {header}

      <Card className="mb-4">
        <CardContent>
          {tags.length === 0 ? (
            <SettingsEmptyState
              icon={<Tags size={20} />}
              title={t('tags.empty.title')}
              body={t('tags.empty.body')}
              actionLabel={t('tags.add')}
              onAction={openCreate}
            />
          ) : (
            <Table aria-label={t('tags.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tags.col.name')}</TableHead>
                  <TableHead className="text-right">{t('tags.col.usage')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('workflow.col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map((tag) => (
                  <TableRow key={tag.id}>
                    <TableCell>
                      <Badge className="font-medium" style={statusBadgeStyle(tag.color)}>
                        {tag.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tag.usageCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          variant="ghost"
                          size="sm"
                          aria-label={t('tags.editLabel', { name: tag.name })}
                          onClick={(): void => setDialog({ kind: 'edit', tag })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          className="min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
                          variant="ghost"
                          size="sm"
                          aria-label={t('tags.deleteLabel', { name: tag.name })}
                          onClick={(): void => setPendingDelete(tag)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialog ? (
        <TaskTagDialog
          tag={dialog.kind === 'edit' ? dialog.tag : null}
          onSubmit={submitTag}
          onClose={(): void => setDialog(null)}
        />
      ) : null}

      {pendingDelete ? (
        <TaskTagDeleteDialog tag={pendingDelete} onConfirm={deleteTag} onClose={(): void => setPendingDelete(null)} />
      ) : null}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskTagsPage;

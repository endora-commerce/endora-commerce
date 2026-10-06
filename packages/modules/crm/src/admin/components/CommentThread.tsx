import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { OpportunityComment, OpportunityCommentKind } from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Label,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { COMMENT_MAX_LENGTH, CommentComposer } from './CommentComposer.js';
import { ModalDialog } from './ModalDialog.js';
import { ReferenceText } from './ReferenceText.js';
import { ReferenceTextarea } from './ReferenceTextarea.js';

/** The sentences one tab says; the thread itself knows no wording of its own kind. */
export interface CommentThreadCopy {
  /** Names the list for assistive technology. */
  title: string;
  empty: string;
  hint: string;
  composerLabel: string;
  composerPlaceholder: string;
  composerSubmit: string;
  /** Spoken once an entry was added. */
  added: string;
}

export interface CommentThreadProps {
  opportunityId: string;
  /** The Opportunity's Organization — whose Orders a reference may name. */
  organizationId: string;
  kind: OpportunityCommentKind;
  copy: CommentThreadCopy;
}

/**
 * The notes, or the messages, of one Opportunity
 * (`contracts/admin-api.md` §6): the entries oldest first and, for a holder of
 * `crm:write`, the composer under them.
 *
 * **What may be changed is decided twice, and the server's answer wins.** A
 * note shows *Edit* and *Delete* only to the administrator who wrote it —
 * authorship is not a permission, so the platform administrator sees none on a
 * colleague's note. A message shows neither to anybody: it cannot be changed
 * once sent. Both rules are the server's (403, 409 `CRM_MESSAGE_IMMUTABLE`);
 * the screen only refrains from offering what would be refused, and shows the
 * refusal if one comes anyway.
 */
export function CommentThread(props: CommentThreadProps): ReactNode {
  const { opportunityId, organizationId, kind, copy } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { hasPermission, me } = useAuth();
  const canWrite = hasPermission('crm:write');
  const myId = me?.adminUser.id ?? null;
  const editFieldId = useId();

  const [entries, setEntries] = useState<OpportunityComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OpportunityComment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = await crmApi.listComments(opportunityId, kind);
      if (current === sequence.current) setEntries(found);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('comments.error.load')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [opportunityId, kind, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (body: string): Promise<void> => {
    const created = await crmApi.addComment(opportunityId, kind, body);
    setEntries((previous) => [...(previous ?? []), created]);
    setNotice(copy.added);
  };

  const saveEdit = async (): Promise<void> => {
    if (editingId === null) return;
    const body = draft.trim();
    if (body === '') {
      setEditError(t('comments.error.empty'));
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const updated = await crmApi.updateComment(opportunityId, editingId, body);
      setEntries((previous) =>
        (previous ?? []).map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingId(null);
      setNotice(t('comments.updated'));
    } catch (failure) {
      setEditError(errorMessage(failure, t('comments.error.save')));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await crmApi.deleteComment(opportunityId, pendingDelete.id);
      setEntries((previous) => (previous ?? []).filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      setNotice(t('comments.deleted'));
    } catch (failure) {
      setDeleteError(errorMessage(failure, t('comments.error.delete')));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{copy.hint}</p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {entries === null ? (
        loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tCore('common.state.loading')}
          </p>
        ) : null
      ) : entries.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ol aria-label={copy.title} className="space-y-3">
          {entries.map((item) => {
            // Only a note, only its author, only with the right to write at all.
            const mine = canWrite && kind === 'note' && myId !== null && item.author.id === myId;
            const editing = editingId === item.id;
            return (
              <li key={item.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{item.author.name}</span>
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    {item.editedAt ? (
                      <Badge variant="outline" className="font-normal">
                        {t('comments.edited')}
                      </Badge>
                    ) : null}
                  </p>
                  {mine && !editing ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        onClick={(): void => {
                          setEditingId(item.id);
                          setDraft(item.body);
                          setEditError(null);
                          setNotice('');
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                        {t('comments.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        onClick={(): void => {
                          setDeleteError(null);
                          setPendingDelete(item);
                          setNotice('');
                        }}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                        {t('comments.delete')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {editing ? (
                  <div className="mt-2 space-y-2">
                    <Label htmlFor={`${editFieldId}-${item.id}`}>{t('comments.edit.label')}</Label>
                    <ReferenceTextarea
                      id={`${editFieldId}-${item.id}`}
                      organizationId={organizationId}
                      rows={4}
                      value={draft}
                      maxLength={COMMENT_MAX_LENGTH}
                      disabled={saving}
                      autoFocus
                      aria-invalid={editError !== null}
                      onValueChange={setDraft}
                    />
                    {editError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {editError}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        disabled={saving}
                        onClick={(): void => setEditingId(null)}
                      >
                        {tCore('common.action.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        disabled={saving}
                        aria-busy={saving}
                        onClick={(): void => void saveEdit()}
                      >
                        {tCore('common.action.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    <ReferenceText text={item.body} references={item.references} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {canWrite ? (
        <CommentComposer
          label={copy.composerLabel}
          placeholder={copy.composerPlaceholder}
          submitLabel={copy.composerSubmit}
          organizationId={organizationId}
          onSubmit={add}
        />
      ) : null}

      {pendingDelete ? (
        <ModalDialog
          title={t('comments.delete.title')}
          busy={deleting}
          onClose={(): void => setPendingDelete(null)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                onClick={(): void => setPendingDelete(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                aria-busy={deleting}
                onClick={(): void => void confirmDelete()}
              >
                {t('comments.delete.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('comments.delete.body')}</p>
          {deleteError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}
    </div>
  );
}

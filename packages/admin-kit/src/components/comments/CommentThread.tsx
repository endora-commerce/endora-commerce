import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { RecordReference } from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '../../lib/index.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Label } from '../../ui/label.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { ModalDialog } from '../modal-dialog/ModalDialog.js';
import { ReferenceField } from '../references/ReferenceField.js';
import { ReferenceText } from '../references/ReferenceText.js';
import type { ReferenceLookups, ReferenceTriggerKind } from '../references/reference-kinds.js';
import { COMMENT_MAX_LENGTH, CommentComposer, commentErrorMessage } from './CommentComposer.js';

/** A note or a message of a record — CRM's `OpportunityComment` and Projects' `ProjectComment` alike. */
export interface RecordComment {
  id: string;
  kind: 'note' | 'message';
  author: { id: string; name: string };
  body: string;
  references: RecordReference[];
  editedAt: string | null;
  /**
   * When the entry was deleted — set only by a record that keeps a deleted
   * entry in its thread (a Task's comment, `specs/165-task-management/` R-6).
   */
  deletedAt?: string | null;
  createdAt: string;
}

/** The record's own requests for its notes or messages. Keep it stable between renders: a new one reads again. */
export interface CommentThreadApi<C extends RecordComment = RecordComment> {
  list: () => Promise<C[]>;
  add: (body: string) => Promise<C>;
  update: (commentId: string, body: string) => Promise<C>;
  remove: (commentId: string) => Promise<void>;
}

/** The sentences one tab says; the thread itself knows no wording of its own kind. */
export interface CommentThreadCopy {
  /** Names the list for assistive technology. */
  title: string;
  empty: string;
  /** One line above the thread — who may read it. Keep it to one clause. */
  hint: string;
  composerLabel: string;
  /**
   * One line under the composer, describing the field — a rule about what is
   * about to be sent ("Cannot be edited after sending."). Omit it when there is
   * none; nothing is drawn then.
   */
  composerHint?: string;
  composerPlaceholder: string;
  composerSubmit: string;
  /** Spoken once an entry was added. */
  added: string;
  /** The body of the question before a note is deleted — what the record's history keeps of it. */
  deleteBody: string;
}

export interface CommentThreadProps<C extends RecordComment = RecordComment> {
  kind: 'note' | 'message';
  api: CommentThreadApi<C>;
  /** Whether the reader may write here — the record's own write permission. */
  canWrite: boolean;
  copy: CommentThreadCopy;
  /** What a text may refer to — the trigger table of {@link ReferenceField}. */
  referenceKinds: readonly ReferenceTriggerKind[];
  /** Where the references' suggestions come from. */
  lookups: ReferenceLookups;
  /**
   * An entry was added or deleted — there is one more, or one fewer, than
   * before. Whoever shows a count of them reads it again. Not called for an
   * edit, which changes no number.
   */
  onCountChange?: () => void | Promise<void>;
  /**
   * The entries on screen, each time they are read or change — for whoever
   * keeps something about them, as the Messages tab keeps what was read.
   */
  onEntries?: (entries: readonly C[]) => void;
  /** A referenced Order's status by name; without it, its code. */
  orderStatusLabel?: (code: string) => string;
  /**
   * A deleted entry keeps its place, marked as deleted and with nothing left
   * to change (a Task's comments, `specs/165-task-management/` R-6). Without
   * it a deleted entry leaves the list, as a CRM or Project note does.
   */
  keepDeleted?: boolean;
  /** An entry's time in words; `formatDateTime` when the record has no format of its own. */
  formatTime?: (iso: string) => string;
}

/**
 * The notes, or the messages, of one record (CRM's `contracts/admin-api.md`
 * §6, promoted by `specs/163-projects-and-tasks/` research R-17): the entries
 * oldest first and, for a reader who may write, the composer under them.
 *
 * **What may be changed is decided twice, and the server's answer wins.** A
 * note shows *Edit* and *Delete* only to the administrator who wrote it —
 * authorship is not a permission, so the platform administrator sees none on a
 * colleague's note. A message shows neither to anybody: it cannot be changed
 * once sent. Both rules are the server's; the screen only refrains from
 * offering what would be refused, and shows the refusal if one comes anyway.
 */
export function CommentThread<C extends RecordComment = RecordComment>(props: CommentThreadProps<C>): ReactNode {
  const { api, kind, copy, canWrite, onCountChange, onEntries } = props;
  const t = useTranslation('core');
  const { me } = useAuth();
  const myId = me?.adminUser.id ?? null;
  const editFieldId = useId();

  const [entries, setEntries] = useState<C[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<C | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = await api.list();
      if (current === sequence.current) setEntries(found);
    } catch (failure) {
      if (current === sequence.current) setError(commentErrorMessage(failure, t('comments.error.load')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (entries !== null) onEntries?.(entries);
  }, [entries, onEntries]);

  const add = async (body: string): Promise<void> => {
    const created = await api.add(body);
    setEntries((previous) => [...(previous ?? []), created]);
    setNotice(copy.added);
    void onCountChange?.();
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
      const updated = await api.update(editingId, body);
      setEntries((previous) =>
        (previous ?? []).map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingId(null);
      setNotice(t('comments.updated'));
    } catch (failure) {
      setEditError(commentErrorMessage(failure, t('comments.error.save')));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.remove(pendingDelete.id);
      const deletedAt = new Date().toISOString();
      setEntries((previous) =>
        props.keepDeleted
          ? (previous ?? []).map((item) =>
              item.id === pendingDelete.id ? { ...item, body: '', references: [], deletedAt } : item,
            )
          : (previous ?? []).filter((item) => item.id !== pendingDelete.id),
      );
      setPendingDelete(null);
      setNotice(t('comments.deleted'));
      void onCountChange?.();
    } catch (failure) {
      setDeleteError(commentErrorMessage(failure, t('comments.error.delete')));
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
            <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
              {t('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {entries === null ? (
        loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.state.loading')}
          </p>
        ) : null
      ) : entries.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ol aria-label={copy.title} className="space-y-3">
          {entries.map((item) => {
            const deleted = Boolean(item.deletedAt);
            // Only a note, only its author, only with the right to write at all — and never once deleted.
            const mine = !deleted && canWrite && kind === 'note' && myId !== null && item.author.id === myId;
            const editing = editingId === item.id;
            return (
              <li key={item.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{item.author.name}</span>
                    <time dateTime={item.createdAt}>{(props.formatTime ?? formatDateTime)(item.createdAt)}</time>
                    {item.editedAt && !deleted ? (
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
                {deleted ? (
                  <p className="mt-2 text-sm italic text-muted-foreground">{t('comments.removedEntry')}</p>
                ) : editing ? (
                  <div className="mt-2 space-y-2">
                    <Label htmlFor={`${editFieldId}-${item.id}`}>{t('comments.edit.label')}</Label>
                    <ReferenceField
                      id={`${editFieldId}-${item.id}`}
                      kinds={props.referenceKinds}
                      lookups={props.lookups}
                      references={item.references}
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
                        {t('common.action.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        disabled={saving}
                        aria-busy={saving}
                        onClick={(): void => void saveEdit()}
                      >
                        {t('common.action.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm">
                    <ReferenceText
                      text={item.body}
                      references={item.references}
                      {...(props.orderStatusLabel ? { orderStatusLabel: props.orderStatusLabel } : {})}
                    />
                  </div>
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
          {...(copy.composerHint ? { hint: copy.composerHint } : {})}
          referenceKinds={props.referenceKinds}
          lookups={props.lookups}
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
                {t('common.action.cancel')}
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
          <p className="text-sm">{copy.deleteBody}</p>
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

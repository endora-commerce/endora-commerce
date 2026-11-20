import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { TASK_ATTACHMENT_MAX_BYTES, type TaskAttachment } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { AttachmentUploader, ModalDialog, uploadAttachment } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage, fileSizeLabel, momentLabel } from '../lib/labels.js';

/**
 * A Task's attachments (`specs/165-task-management/` FR-008, research R-7;
 * Projects' *Attachments* tab, the model): the asset library's files attached
 * to this Task, each with its name, size, uploader and time.
 *
 * **Adding a file needs `tasks:write` and nothing else.** The file goes to the
 * Task's own upload, which stores it in the asset library as a private file
 * and attaches it in the same request; what a file may be is the library's
 * policy and the server's refusal is shown in its own words. A file over the
 * size the server takes is refused here, before it is sent.
 *
 * **A download link is read at the moment it is used**: each attachment
 * carries a signed link valid for minutes, so *Download* reads the list again.
 *
 * `onChange` is told after a file is added or removed — both are audited, so
 * the screen reads its history again (165 T095) and the tab's count.
 *
 * It is the *Attachments* tab of the Task's screen (issue #1524): the tab names
 * the panel, so the list draws no heading of its own.
 */
export function TaskAttachments(props: { taskId: string; canChange: boolean; onChange?: () => void }): ReactNode {
  const { taskId, canChange, onChange } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const maxSize = fileSizeLabel(TASK_ATTACHMENT_MAX_BYTES, language);

  const [attachments, setAttachments] = useState<TaskAttachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<TaskAttachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = await tasksApi.listAttachments(taskId);
      if (current === sequence.current) setAttachments(found);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('attachments.error.load')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [taskId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File): Promise<void> => {
    setActionError(null);
    setNotice('');
    if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
      setActionError(t('attachments.error.tooLarge', { name: file.name, max: maxSize }));
      return;
    }
    setUploading(file.name);
    try {
      const added = await uploadAttachment<TaskAttachment>(tasksApi.attachmentUploadPath(taskId), file);
      setAttachments((previous) =>
        (previous ?? []).some((item) => item.id === added.id) ? (previous ?? []) : [...(previous ?? []), added],
      );
      setNotice(t('attachments.added'));
      onChange?.();
    } catch (failure) {
      setActionError(errorMessage(failure, t('attachments.error.attach')));
    } finally {
      setUploading(null);
    }
  };

  const download = async (attachment: TaskAttachment): Promise<void> => {
    setDownloadingId(attachment.id);
    setActionError(null);
    setNotice('');
    try {
      // The link on screen may have expired: ask for the list again and use the one it answers now.
      const fresh = await tasksApi.listAttachments(taskId);
      setAttachments(fresh);
      const url = fresh.find((item) => item.id === attachment.id)?.url ?? null;
      if (url === null) {
        setActionError(t('attachments.error.unavailable', { name: attachment.fileName }));
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      setActionError(errorMessage(failure, t('attachments.error.download')));
    } finally {
      setDownloadingId(null);
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!pendingRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await tasksApi.removeAttachment(taskId, pendingRemove.id);
      setAttachments((previous) => (previous ?? []).filter((item) => item.id !== pendingRemove.id));
      setNotice(t('attachments.removed', { name: pendingRemove.fileName }));
      setPendingRemove(null);
      onChange?.();
    } catch (failure) {
      setRemoveError(errorMessage(failure, t('attachments.error.remove')));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-3">

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {attachments === null ? (
        loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tCore('common.state.loading')}
          </p>
        ) : null
      ) : attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="break-all font-medium">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{fileSizeLabel(attachment.sizeBytes, language)}</span>
                  {' · '}
                  <span>{attachment.uploadedBy?.name ?? ''}</span>
                  {' · '}
                  <span>{momentLabel(attachment.createdAt, language)}</span>
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                  aria-label={t('attachments.download', { name: attachment.fileName })}
                  aria-busy={downloadingId === attachment.id}
                  disabled={downloadingId !== null}
                  onClick={(): void => void download(attachment)}
                >
                  <Download aria-hidden="true" />
                </Button>
                {canChange ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    aria-label={t('attachments.remove', { name: attachment.fileName })}
                    onClick={(): void => {
                      setRemoveError(null);
                      setPendingRemove(attachment);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>

      {canChange ? (
        <AttachmentUploader
          label={t('attachments.upload')}
          hint={
            uploading === null
              ? t('attachments.dropHint', { max: maxSize })
              : t('attachments.uploading', { name: uploading })
          }
          busy={uploading !== null}
          onFile={(file): void => void upload(file)}
        />
      ) : null}

      {pendingRemove ? (
        <ModalDialog
          title={t('attachments.removeTitle')}
          busy={removing}
          onClose={(): void => setPendingRemove(null)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={removing}
                onClick={(): void => setPendingRemove(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={removing}
                aria-busy={removing}
                onClick={(): void => void confirmRemove()}
              >
                {t('attachments.removeConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('attachments.removeBody', { name: pendingRemove.fileName })}</p>
          {removeError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}
    </div>
  );
}

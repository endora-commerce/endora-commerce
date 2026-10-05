import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Trash2 } from 'lucide-react';
import {
  OPPORTUNITY_ATTACHMENT_MAX_BYTES,
  type OpportunityAttachment,
} from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../../../api.js';
import { AttachmentUploader } from '../../../components/AttachmentUploader.js';
import { ModalDialog } from '../../../components/ModalDialog.js';
import { errorMessage, fileSizeLabel } from '../../../lib/labels.js';
import { uploadOpportunityAttachment } from '../../../lib/upload-attachment.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Attachments* tab (User Story 5; `contracts/admin-api.md` §7): the files
 * of the media library linked to this Opportunity.
 *
 * **Adding a file needs `crm:write` and nothing else.** The file goes to
 * CRM's own upload endpoint, which stores it in the media library as a private
 * asset and attaches it in the same request; the library's own upload asks for
 * the library's permission, which the people working an Opportunity need not
 * hold. What a file may be — its type, its size — is still the library's
 * policy, and its refusal is shown in its own words. A file over the size this
 * screen may send at all is refused here, before it is sent.
 *
 * **A download link is read at the moment it is used.** Each attachment carries
 * a signed link valid for a few minutes; one read when the tab was opened may
 * have expired by the time it is clicked. *Download* therefore reads the list
 * again and opens the link it has just been given.
 *
 */
export function AttachmentsTab(props: OpportunityTabProps): ReactNode {
  const opportunityId = props.opportunity.id;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const maxSize = fileSizeLabel(OPPORTUNITY_ATTACHMENT_MAX_BYTES, language);

  const [attachments, setAttachments] = useState<OpportunityAttachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<OpportunityAttachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = await crmApi.listAttachments(opportunityId);
      if (current === sequence.current) setAttachments(found);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('attachments.error.load')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [opportunityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File): Promise<void> => {
    setActionError(null);
    setNotice('');
    if (file.size > OPPORTUNITY_ATTACHMENT_MAX_BYTES) {
      setActionError(t('attachments.error.tooLarge', { name: file.name, max: maxSize }));
      return;
    }
    setUploading(file.name);
    try {
      const added = await uploadOpportunityAttachment(opportunityId, file);
      setAttachments((previous) =>
        (previous ?? []).some((item) => item.id === added.id)
          ? (previous ?? [])
          : [...(previous ?? []), added],
      );
      setNotice(t('attachments.added'));
    } catch (failure) {
      setActionError(errorMessage(failure, t('attachments.error.attach')));
    } finally {
      setUploading(null);
    }
  };

  const download = async (attachment: OpportunityAttachment): Promise<void> => {
    setDownloadingId(attachment.id);
    setActionError(null);
    setNotice('');
    try {
      // The link on screen may have expired: ask for the list again and use
      // the one it answers now.
      const fresh = await crmApi.listAttachments(opportunityId);
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
      await crmApi.removeAttachment(opportunityId, pendingRemove.id);
      setAttachments((previous) => (previous ?? []).filter((item) => item.id !== pendingRemove.id));
      setNotice(t('attachments.removed', { name: pendingRemove.fileName }));
      setPendingRemove(null);
    } catch (failure) {
      setRemoveError(errorMessage(failure, t('attachments.error.remove')));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('attachments.hint')}</p>

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
        <p className="py-4 text-sm text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <Table aria-label={t('opportunity.tabs.attachments')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('attachments.col.name')}</TableHead>
              <TableHead className="text-right">{t('attachments.col.size')}</TableHead>
              <TableHead>{t('attachments.col.uploadedBy')}</TableHead>
              <TableHead>{t('attachments.col.added')}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{t('attachments.col.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attachments.map((attachment) => (
              <TableRow key={attachment.id}>
                <TableCell className="break-all font-medium">{attachment.fileName}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fileSizeLabel(attachment.sizeBytes, language)}
                </TableCell>
                <TableCell>{attachment.uploadedBy.name}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(attachment.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
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
                    {canWrite ? (
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>

      {canWrite ? (
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
          title={t('attachments.remove.title')}
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
                {t('attachments.remove.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('attachments.remove.body', { name: pendingRemove.fileName })}</p>
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

export default AttachmentsTab;

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { FORM_ENTRY_STATUSES, type FormEntryDetail, type FormEntryStatus } from '@endora-commerce/contracts';
import { ModalDialog, adminLanguageToLocale, listScopeSalesChannels } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { entriesApi } from '../api.js';
import { EntryAnswers, EntryConsents, EntryContext } from '../components/EntryAnswers.js';
import { EntryStatusBadge } from '../components/EntryFilters.js';
import { EntryNotes } from '../components/EntryNotes.js';
import { errorMessage } from '../lib/errors.js';

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; entry: FormEntryDetail };

/** The last status change, so it can be undone — or what came of the undo. */
type Change =
  | { kind: 'changed'; from: FormEntryStatus; to: FormEntryStatus }
  | { kind: 'undone' }
  | { kind: 'failed'; message: string };

/**
 * One entry (`specs/170-forms-module/` User Story 4, contracts/admin-surfaces.md §4, research R-16).
 *
 * Opening it marks it read — through its own `mark-read` route, once, so an integration reading
 * entries marks nothing. The status control (with `forms:entries_write`) moves the entry any way;
 * the last change can be undone, and an undo the entry has moved past since is refused with the
 * server's sentence. Notes are appended; the delete is behind a dialog and cannot be undone.
 *
 * An entry the reader's scope does not hold answers like a missing one, and is shown as such.
 *
 * Layout: two columns from `lg` — the answers and consents on the left (what was sent), the status,
 * the details and the notes on the right (what is done with it) — stacking in that order below.
 */
export function EntryDetailPage(): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('forms:entries_write');
  const statusId = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [channelName, setChannelName] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    entriesApi
      .markRead(id)
      .then((entry) => {
        if (alive) setLoad({ kind: 'ready', entry });
      })
      .catch((failure: unknown) => {
        if (!alive) return;
        setLoad(failure instanceof ApiError && failure.status === 404 ? { kind: 'missing' } : { kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const channelId = load.kind === 'ready' ? load.entry.salesChannelId : null;
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const locale = adminLanguageToLocale(language);
    listScopeSalesChannels()
      .then((list) => {
        const channel = list.items.find((candidate) => candidate.id === channelId);
        if (alive && channel) setChannelName(channel.name[locale] ?? channel.name['en-US'] ?? Object.values(channel.name)[0] ?? channel.code);
      })
      // Without the channel read the id stands in for the name.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [channelId, language]);

  if (load.kind === 'loading') return <p className="text-sm text-muted-foreground">{t('entry.loading')}</p>;
  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert variant="destructive">
          <AlertDescription>{load.kind === 'missing' ? t('entry.notFound') : t('entry.loadError')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { entry } = load;
  const time = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  const moveTo = async (to: FormEntryStatus, from: FormEntryStatus, undo: boolean): Promise<void> => {
    setBusy(true);
    try {
      const next = await entriesApi.changeStatus(entry.id, to, from);
      setLoad({ kind: 'ready', entry: next });
      setChange(undo ? { kind: 'undone' } : { kind: 'changed', from, to });
    } catch (failure) {
      setChange({ kind: 'failed', message: errorMessage(failure, t('entries.actionError')) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setDeleteError(null);
    try {
      await entriesApi.remove(entry.id);
      navigate('/forms/entries');
    } catch (failure) {
      setDeleteError(errorMessage(failure, t('entries.actionError')));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <BackLink />
      <PageHeader
        title={t('entry.title', { form: entry.formName })}
        description={t('entry.sentAt', { date: time.format(new Date(entry.submittedAt)) })}
        actions={
          canWrite ? (
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 size={16} aria-hidden="true" />
              {t('entry.delete')}
            </Button>
          ) : null
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <EntryAnswers entry={entry} />
          <EntryConsents entry={entry} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 p-4">
              {canWrite ? (
                <div className="space-y-1">
                  <Label htmlFor={statusId}>{t('entry.status')}</Label>
                  <Select
                    id={statusId}
                    value={entry.status}
                    disabled={busy}
                    onChange={(event) => void moveTo(event.target.value as FormEntryStatus, entry.status, false)}
                  >
                    {FORM_ENTRY_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`entryStatus.${status}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{t('entry.status')}</span>
                  <EntryStatusBadge status={entry.status} />
                </div>
              )}
              <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
                {change?.kind === 'changed' ? (
                  <>
                    <span>{t('entry.statusChanged', { status: t(`entryStatus.${change.to}`) })}</span>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void moveTo(change.from, change.to, true)}>
                      {t('entry.undo')}
                    </Button>
                  </>
                ) : null}
                {change?.kind === 'undone' ? <span>{t('entry.undone')}</span> : null}
                {change?.kind === 'failed' ? <span className="text-destructive">{change.message}</span> : null}
              </div>
            </CardContent>
          </Card>
          <EntryContext entry={entry} channelName={channelName} />
          <EntryNotes
            notes={entry.notes}
            canWrite={canWrite}
            onAdd={async (body) => {
              const note = await entriesApi.addNote(entry.id, body);
              setLoad({ kind: 'ready', entry: { ...entry, notes: [...entry.notes, note] } });
            }}
          />
        </div>
      </div>
      {confirmDelete ? (
        <ModalDialog
          title={t('entry.deleteDialog.title')}
          onClose={() => setConfirmDelete(false)}
          busy={busy}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
                {t('entry.deleteDialog.cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
                {t('entry.deleteDialog.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>{t('entry.deleteDialog.body')}</p>
            {deleteError ? (
              <p role="alert" className="text-destructive">
                {deleteError}
              </p>
            ) : null}
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

function BackLink(): ReactNode {
  const t = useTranslation('forms');
  return (
    <Link to="/forms/entries" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
      <ArrowLeft size={14} aria-hidden="true" />
      {t('entry.back')}
    </Link>
  );
}

export default EntryDetailPage;

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, CircleSlash, RotateCcw, Trash2 } from 'lucide-react';
import type { PriceBook, PriceBookPatch, PriceBookTargetSalesChannel } from '@endora-commerce/contracts';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label, Section } from '@endora-commerce/admin-kit/ui';
import { errorCode, errorMessage, errorPaths } from '../lib/api-errors.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';
import { AudienceField } from './AudienceField.js';
import { ChannelsField } from './ChannelsField.js';
import { DeleteBookDialog } from './DeleteBookDialog.js';
import { ScheduleFields, parseSchedule, toLocalInput, type ScheduleDraft } from './ScheduleFields.js';

/**
 * A book's header (feature 161, US1 — FR-003, FR-004, FR-005, FR-028).
 *
 * What may change is the name, the channels, the members, the schedule and the
 * priority; the currency never changes and the audience kind is fixed once the
 * book has been active (160 FR-004), so both are shown and explained rather
 * than offered. A save sends only what changed, against the `version` the book
 * was opened at (G5): `409 PRICE_BOOK_STALE` keeps the edits on screen and
 * offers a reload. A refused activation names what is missing — in this
 * module's words, keyed on the server's `details[].path` — and each reason
 * takes the operator to the field that fixes it.
 *
 * Nothing the caller may not do is rendered (FR-028): without
 * `price_lists:write`, or on a book the server marks not `writable` (G11), the
 * header is a read-only summary. A base book is everyone's price in its
 * currency: always active, never renamed, scheduled or deleted (FR-005).
 */

interface Draft {
  readonly name: string;
  readonly channelIds: readonly string[];
  readonly kind: PriceBook['audience']['kind'];
  readonly memberIds: readonly string[];
  readonly schedule: ScheduleDraft;
}

function draftOf(book: PriceBook): Draft {
  return {
    name: book.name,
    channelIds: book.channels.map((c) => c.channelId),
    kind: book.audience.kind,
    memberIds: book.audience.memberIds,
    schedule: { startsAt: toLocalInput(book.startsAt), endsAt: toLocalInput(book.endsAt), priority: String(book.priority) },
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

type Notice =
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'notApplicable'; readonly paths: readonly string[] };

export function PriceBookHeaderForm(props: {
  readonly book: PriceBook;
  readonly channels: readonly PriceBookTargetSalesChannel[];
  /** The audience kinds the caller may create (G11); the kind of a never-activated draft may change to one. */
  readonly kinds: readonly PriceBook['audience']['kind'][];
  readonly editable: boolean;
  readonly onChanged: (book: PriceBook) => void;
  readonly onReload: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const navigate = useNavigate();
  const { book, editable } = props;
  const nameId = useId();
  const channelsRef = useRef<HTMLFieldSetElement | null>(null);
  const audienceRef = useRef<HTMLFieldSetElement | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(book));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A new version from the server (a save, an activation, a reload) is the new baseline.
  useEffect(() => {
    setDraft(draftOf(book));
    setErrors({});
  }, [book]);

  const baseline = useMemo(() => draftOf(book), [book]);
  const patch = useMemo((): PriceBookPatch | null => {
    const parsed = parseSchedule(draft.schedule, t);
    const out: { -readonly [K in keyof PriceBookPatch]: PriceBookPatch[K] } = {};
    if (draft.name.trim() !== baseline.name) out.name = draft.name.trim();
    if (!sameSet(draft.channelIds, baseline.channelIds)) out.channelIds = [...draft.channelIds];
    if (draft.kind !== baseline.kind || !sameSet(draft.memberIds, baseline.memberIds)) {
      out.audience = { kind: draft.kind, memberIds: draft.kind === 'everyone' ? [] : [...draft.memberIds] };
    }
    if (draft.schedule.startsAt !== baseline.schedule.startsAt) out.startsAt = parsed.startsAt;
    if (draft.schedule.endsAt !== baseline.schedule.endsAt) out.endsAt = parsed.endsAt;
    if (draft.schedule.priority.trim() !== baseline.schedule.priority) out.priority = parsed.priority;
    return Object.keys(out).length === 0 ? null : out;
  }, [draft, baseline, t]);
  const dirty = patch !== null;
  useUnsavedChangesPrompt(dirty);

  const save = async (): Promise<void> => {
    if (!patch) return;
    const found: Record<string, string> = { ...parseSchedule(draft.schedule, t).errors };
    if (draft.name.trim() === '') found['name'] = t('priceBooks.validation.nameRequired');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setNotice(null);
    setStatus(t('priceBooks.header.saving'));
    try {
      const saved = await api.patch(book.id, patch, book.version);
      props.onChanged(saved);
      setStatus(t('priceBooks.header.saved'));
    } catch (err) {
      setStatus('');
      setNotice(
        errorCode(err) === 'PRICE_BOOK_STALE'
          ? { kind: 'stale', message: errorMessage(err, t('priceBooks.header.stale')) }
          : { kind: 'refused', message: errorMessage(err, t('priceBooks.header.error.save')) },
      );
    } finally {
      setBusy(false);
    }
  };

  const transition = async (to: 'activate' | 'draftify'): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const next = to === 'activate' ? await api.activate(book.id) : await api.draftify(book.id);
      props.onChanged(next);
      setStatus(to === 'activate' ? t('priceBooks.header.activated') : t('priceBooks.header.draftified'));
    } catch (err) {
      setNotice(
        errorCode(err) === 'PRICE_BOOK_NOT_APPLICABLE'
          ? { kind: 'notApplicable', paths: errorPaths(err) }
          : { kind: 'refused', message: errorMessage(err, t('priceBooks.header.error.transition')) },
      );
    } finally {
      setBusy(false);
    }
  };

  const dormant = new Set(book.channels.filter((c) => c.dormant).map((c) => c.channelId));
  const kindFixed = book.everActivated;

  if (book.isSystem) {
    return (
      <Section title={t('priceBooks.header.section')}>
        <p className="text-sm">{t('priceBooks.header.baseNote', { currency: book.currencyCode })}</p>
        <CurrencyLine currency={book.currencyCode} />
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
      {notice?.kind === 'stale' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{notice.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={props.onReload}>
              <RotateCcw aria-hidden="true" />
              {t('priceBooks.header.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {notice?.kind === 'refused' ? (
        <Alert variant="destructive">
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}
      {notice?.kind === 'notApplicable' ? (
        <Alert variant="warning">
          <AlertDescription className="space-y-2">
            <p className="font-medium">{t('priceBooks.activate.refused')}</p>
            <ul className="space-y-2">
              {notice.paths.map((path) => {
                const channels = path.startsWith('channelIds');
                return (
                  <li key={path} className="flex flex-wrap items-center gap-2">
                    <span>
                      {channels
                        ? t('priceBooks.activate.reason.channels', { currency: book.currencyCode })
                        : t('priceBooks.activate.reason.members')}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={(): void => (channels ? channelsRef : audienceRef).current?.focus()}
                    >
                      {channels ? t('priceBooks.activate.fix.channels') : t('priceBooks.activate.fix.members')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {editable ? null : <p className="text-sm text-muted-foreground">{t('priceBooks.header.readOnly')}</p>}

      <Section title={t('priceBooks.header.section')}>
        <div className="max-w-2xl space-y-5">
          {editable ? (
            <div className="space-y-1">
              <Label htmlFor={nameId}>{t('priceBooks.field.name')}</Label>
              <Input
                id={nameId}
                value={draft.name}
                maxLength={200}
                aria-invalid={errors['name'] ? true : undefined}
                aria-describedby={errors['name'] ? `${nameId}-error` : undefined}
                onChange={(event): void => setDraft({ ...draft, name: event.target.value })}
              />
              {errors['name'] ? (
                <p id={`${nameId}-error`} className="text-xs text-destructive">
                  {errors['name']}
                </p>
              ) : null}
            </div>
          ) : null}
          <CurrencyLine currency={book.currencyCode} />
          <ChannelsField
            ref={channelsRef}
            currency={book.currencyCode}
            channels={props.channels}
            value={draft.channelIds}
            onChange={(channelIds): void => setDraft({ ...draft, channelIds })}
            dormant={dormant}
            readOnly={!editable}
          />
          <AudienceField
            ref={audienceRef}
            kinds={props.kinds.includes(book.audience.kind) ? props.kinds : [book.audience.kind, ...props.kinds]}
            kind={draft.kind}
            onKindChange={(kind): void => setDraft({ ...draft, kind, memberIds: [] })}
            kindFixed={kindFixed}
            memberIds={draft.memberIds}
            onMembersChange={(memberIds): void => setDraft({ ...draft, memberIds })}
            readOnly={!editable}
          />
          {editable ? (
            <ScheduleFields value={draft.schedule} onChange={(schedule): void => setDraft({ ...draft, schedule })} errors={errors} />
          ) : null}
        </div>
      </Section>

      {editable ? (
        <>
          <StickyFormActions className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={(): void => void save()} disabled={!dirty || busy} aria-busy={busy}>
              {t('priceBooks.header.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={(): void => setDraft(baseline)} disabled={!dirty || busy}>
              {t('priceBooks.header.discard')}
            </Button>
            {book.status === 'active' || book.status === 'scheduled' ? (
              <Button type="button" variant="outline" onClick={(): void => void transition('draftify')} disabled={busy}>
                <CircleSlash aria-hidden="true" />
                {t('priceBooks.header.draftify')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={(): void => void transition('activate')}
                disabled={busy || dirty}
                title={dirty ? t('priceBooks.header.saveFirst') : undefined}
              >
                <CircleCheck aria-hidden="true" />
                {t('priceBooks.header.activate')}
              </Button>
            )}
          </StickyFormActions>

          <Section title={t('priceBooks.delete.section')} className="border-t pt-6">
            <p className="text-sm text-muted-foreground">{t('priceBooks.delete.help')}</p>
            <div>
              <Button type="button" variant="outline" className="text-destructive" onClick={(): void => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                {t('priceBooks.delete.confirm')}
              </Button>
            </div>
          </Section>
        </>
      ) : null}

      {deleting ? (
        <DeleteBookDialog
          book={book}
          onClose={(): void => setDeleting(false)}
          onDeleted={(): void => void navigate('/price-lists', { replace: true })}
        />
      ) : null}
    </div>
  );
}

function CurrencyLine(props: { readonly currency: string }): ReactNode {
  const t = useTranslation('price_lists');
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{t('priceBooks.field.currency')}</p>
      <p className="text-sm">{props.currency}</p>
      <p className="text-xs text-muted-foreground">{t('priceBooks.header.currencyFixed')}</p>
    </div>
  );
}

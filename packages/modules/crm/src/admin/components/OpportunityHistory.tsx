import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  customFieldCarrySkipLabelSchema,
  customFieldCarrySkipReasonSchema,
  opportunityRichTextToPlain,
  type CustomFieldCarrySkipLabel,
  type OpportunityDetail,
  type OpportunityHistoryEntry,
  type OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import {
  clipReferenceText,
  RecordHistory,
  recordHistoryChanges,
  ReferenceText,
  resolveCustomFieldLabel,
  useRecordHistory,
  type RecordHistoryChange,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import {
  humaniseKey,
  LABELLED_HISTORY_FIELDS,
  SILENT_HISTORY_FIELDS,
} from '../lib/history-fields.js';
import {
  calendarDateLabel,
  moneyLabel,
  NO_VALUE,
  orderStatusLabel,
  workflowStatusLabel,
} from '../lib/labels.js';
import {
  customFieldLabel,
  customFieldValueLabel,
  useCanSeeCustomFields,
  useOpportunityFieldDefinitions,
} from './OpportunityCustomFields.js';
import { useReturnHere } from '../lib/return-here.js';

const PAGE_SIZE = 50;
/** A long text (a description, a note) is cut here; the whole of it is where it lives. */
const TEXT_LIMIT = 280;
const ORDERS_READ = 'orders:read';
const RETRY_ACTION = 'crm.opportunity.propagation_retry';
const NOT_FOLLOWED_ACTION = 'crm.opportunity.propagation_skip';
/** A field name shown to an operator is cut here. */
const SHOWN_KEY_LIMIT = 64;
const CARRY_SKIP_REASONS: ReadonlySet<string> = new Set(customFieldCarrySkipReasonSchema.options);

type State = Record<string, unknown>;

/** One field of an entry, as it was and as it is. `before` is absent for a state that only arrived. */
export type HistoryChange = RecordHistoryChange;

function asState(value: unknown): State | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as State)
    : null;
}

interface CarrySkipLine {
  key: string;
  reason: string;
  /** The source field's label as it read when the skip was recorded; absent on an older entry. */
  label?: CustomFieldCarrySkipLabel;
}

/**
 * The keys a `customFieldCarry` member says were not carried, each with its
 * reason and stored label (feature 162, data-model §4.3; owner ruling V3) —
 * `[]` for one that only carried. A label that does not parse is left out,
 * so the line falls back to the key rather than to a guess.
 */
function carrySkips(raw: unknown): CarrySkipLine[] {
  const skipped = asState(raw)?.skipped;
  if (!Array.isArray(skipped)) return [];
  return skipped.flatMap((item: unknown): CarrySkipLine[] => {
    const skip = asState(item);
    if (typeof skip?.key !== 'string' || typeof skip.reason !== 'string') return [];
    const label = customFieldCarrySkipLabelSchema.safeParse(skip.label);
    return [{ key: skip.key, reason: skip.reason, ...(label.success ? { label: label.data } : {}) }];
  });
}

/**
 * The name a skip line gives its field: the stored label in the reader's
 * language, then its default label, then the key; cut at {@link SHOWN_KEY_LIMIT}.
 */
function skippedFieldName(skip: CarrySkipLine, language: string): string {
  const name = skip.label ? resolveCustomFieldLabel(skip.label.labels, skip.label.labelDefault, language) : '';
  const shown = name === '' ? skip.key : name;
  return shown.length > SHOWN_KEY_LIMIT ? `${shown.slice(0, SHOWN_KEY_LIMIT)}…` : shown;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What an entry changed, field by field: for an edit the fields whose value
 * differs, for something that only appeared (a creation, a link, a note) the
 * fields it arrived with, for something removed the fields it had.
 *
 * The status of a status change and its cause are not here — the entry shows
 * them as a sentence of their own.
 *
 * **A retry is one statement, not an edit.** Its `before` is the refusal it
 * starts from and its `after` the attempt it opens, so the two share almost no
 * key and a field-by-field comparison reads "outcome: refused → nothing". What
 * it says instead: which Order, the status asked of it, and the refusal that is
 * being retried — under a name of its own (`retriedOutcome`), because the
 * entry does not carry what the retry led to.
 */
export function historyChanges(
  entry: Pick<OpportunityHistoryEntry, 'before' | 'after'> & { action?: string },
): HistoryChange[] {
  const before = asState(entry.before);
  const after = asState(entry.after);
  if (before && after && entry.action === RETRY_ACTION) {
    const { outcome, ...rest } = before;
    return historyChanges({ before: null, after: { ...rest, retriedOutcome: outcome, ...after } });
  }
  return recordHistoryChanges(entry, SILENT_HISTORY_FIELDS);
}

export interface OpportunityHistoryProps {
  opportunity: OpportunityDetail;
}

/**
 * The change history of one Opportunity (User Story 11, FR-052): what was
 * done, by whom and when, newest first, read from
 * `GET /opportunities/:id/history` a page at a time.
 *
 * **Every entry is a sentence, not a record.** Its heading is the label of the
 * audited action — `auditLog.<action>` in this module's bundle, the same
 * sentence the platform-wide audit log shows. A status change says *from* and
 * *to* in the statuses' names, never their codes, and — when an Order caused
 * it — names that Order and links to it. Anything else lists the fields that
 * changed, as they were and as they are, with identifiers replaced by what
 * they name wherever this screen knows it (the assignee, the Organization, a
 * linked Order) and left out where it does not.
 *
 * **Nothing is shown as it is stored.** Every key an audited state can carry
 * has a label (`lib/history-fields.ts`, held to the services by
 * `index.test.ts`); custom field values are a line per field under the
 * field's own label, or its code for a reader who may not read the
 * definitions; an outcome is the sentence the Overview's propagation section
 * says; an Order status is its name, and is a row only for somebody holding
 * `orders:read`. A description reads as it does on the Overview — a person, an
 * Order or a Product it refers to is the name the server resolved for this
 * reader, never the token (User Story 18, FR-084). A key this screen was never
 * told about is "Other change" with the key in words — never the key itself,
 * never JSON.
 *
 * The history is cursor-paginated: *Show earlier changes* appends the next
 * page under the ones already read, so a reader scanning back keeps their
 * place. Under the last page it says either that this is the whole history or
 * — when the history ended at its reach — that earlier changes exist and are
 * not shown; the two are never confused.
 *
 * Reading and drawing are the kit's `useRecordHistory` and `RecordHistory`
 * (`specs/163-projects-and-tasks/` research R-17); everything above that names
 * something is this file's.
 */
export function OpportunityHistory(props: OpportunityHistoryProps): ReactNode {
  const returnHere = useReturnHere();
  const { opportunity } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const canReadOrders = useAuth().hasPermission(ORDERS_READ);
  const canSeeCustomFields = useCanSeeCustomFields();
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);

  const loadPage = useCallback(
    (cursor: string | null) =>
      crmApi.getHistory(opportunity.id, { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
    [opportunity.id],
  );
  // The history is read again when the Opportunity on screen changes: a move
  // made on the Overview is the newest entry here.
  const history = useRecordHistory(loadPage, `${opportunity.updatedAt}|${opportunity.version}`);
  const { entries } = history;

  // Status names are the workflow's; without them the codes are shown.
  useEffect(() => {
    let alive = true;
    crmApi
      .getWorkflow()
      .then((workflow) => {
        if (alive) setStatuses(workflow.statuses);
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  /** Whether any entry read so far carries `field` — what decides if its names are worth asking for. */
  const carries = useCallback(
    (field: string): boolean =>
      (entries ?? []).some(
        (entry) => field in (asState(entry.before) ?? {}) || field in (asState(entry.after) ?? {}),
      ),
    [entries],
  );

  // Order status names are `orders`' and need `orders:read` — the source the
  // Overview's linked Orders use. Asked only once an entry names a status.
  const wantsOrderStatuses = canReadOrders && carries('orderStatusCode');
  useEffect(() => {
    if (!wantsOrderStatuses) return undefined;
    let alive = true;
    crmApi
      .listOrderStatuses()
      .then((found) => {
        if (alive) setOrderStatuses(found);
      })
      .catch(() => {
        if (alive) setOrderStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, [wantsOrderStatuses]);

  // The fields' own labels, for somebody `custom_fields` lets read them.
  const { definitions } = useOpportunityFieldDefinitions(
    canSeeCustomFields && carries('customFieldValues'),
  );

  /** Administrators this page can name: the assignee and everybody who acted. */
  const people = useMemo(() => {
    const names = new Map<string, string>();
    if (opportunity.assignee) names.set(opportunity.assignee.id, opportunity.assignee.name);
    for (const entry of entries ?? []) {
      if (entry.actor.id && entry.actor.name) names.set(entry.actor.id, entry.actor.name);
    }
    return names;
  }, [entries, opportunity.assignee]);

  const statusName = (code: unknown): string => {
    if (typeof code !== 'string' || code === '') return NO_VALUE;
    const status = statuses.find((item) => item.code === code);
    return status ? workflowStatusLabel(status, language) : code;
  };

  const document = (kind: unknown, id: unknown): ReactNode => {
    const documentKind = kind === 'quote_request' ? 'quote_request' : 'order';
    const label = t(`value.excluded.kind.${documentKind}`);
    if (typeof id !== 'string') return label;
    const link = opportunity.links.find(
      (item) => item.documentKind === documentKind && item.documentId === id,
    );
    const to = returnHere(documentKind === 'order' ? `/orders/${id}` : `/quote-requests/${id}`);
    return (
      <Link to={to} className="text-primary underline-offset-4 hover:underline">
        {link?.available && link.number
          ? `${label} ${link.number}`
          : t(`history.document.open.${documentKind}`)}
      </Link>
    );
  };

  const value = (field: string, raw: unknown, entry: OpportunityHistoryEntry): ReactNode => {
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    switch (field) {
      case 'skippedStatus':
      case 'statusCode':
        return statusName(raw);
      case 'valueMode':
        return raw === 'computed' ? t('value.mode.computed') : t('value.mode.manual');
      case 'manualValue':
        return moneyLabel(String(raw), opportunity.currency);
      case 'expectedCloseDate':
        return calendarDateLabel(String(raw));
      case 'documentKind':
        return t(`value.excluded.kind.${raw === 'quote_request' ? 'quote_request' : 'order'}`);
      case 'documentId': {
        const state = asState(entry.after) ?? asState(entry.before);
        return document(state?.documentKind, raw);
      }
      case 'linkedDocument': {
        const linked = asState(raw);
        return document(linked?.documentKind, linked?.documentId);
      }
      case 'orderId':
        return document('order', raw);
      case 'assignedAdminUserId':
        return people.get(String(raw)) ?? t('history.value.someone');
      case 'organizationId':
        // An Opportunity's Organization is the one on this screen.
        return raw === opportunity.organization.id
          ? opportunity.organization.name
          : t('history.value.set');
      case 'customerAccountId':
        return opportunity.customerAccount && raw === opportunity.customerAccount.id
          ? opportunity.customerAccount.name
          : t('history.value.set');
      case 'salesChannelId':
        // The detail carries the channel's id, not its name.
        return t('history.value.set');
      case 'orderStatusCode':
        return orderStatusLabel(String(raw), orderStatuses, language);
      case 'outcome':
      case 'retriedOutcome':
        return outcome(String(raw), entry);
      case 'source':
        return t(`opportunity.source.${raw === 'order' || raw === 'quote_request' ? raw : 'manual'}`);
      case 'linkSource':
        return t(
          `history.linkSource.${
            raw === 'auto' || raw === 'created_from_opportunity' || raw === 'quote_conversion'
              ? raw
              : 'manual'
          }`,
        );
      case 'kind':
        return raw === 'message' ? t('history.kind.message') : t('history.kind.note');
      case 'description':
        // Its words without their formatting, cut before they are cut into
        // chips, so neither a marker nor a token is ever shown in half.
        return typeof raw === 'string' ? (
          <ReferenceText
            inline
            text={clipReferenceText(opportunityRichTextToPlain(raw), TEXT_LIMIT)}
            references={entry.references}
          />
        ) : (
          plain(raw)
        );
      default:
        break;
    }
    if (typeof raw === 'boolean') return raw ? t('links.following.on') : t('links.following.off');
    return plain(raw);
  };

  /** Any value in words: a list as a list, a structure as `name: value` pairs — never JSON. */
  const plain = (raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    if (typeof raw === 'boolean') return raw ? t('links.following.on') : t('links.following.off');
    if (Array.isArray(raw)) return raw.length === 0 ? NO_VALUE : raw.map(plain).join(', ');
    if (typeof raw === 'object') {
      const pairs = Object.entries(raw).map(([key, item]) => `${humaniseKey(key)}: ${plain(item)}`);
      return pairs.length === 0 ? NO_VALUE : pairs.join('; ');
    }
    const text = String(raw);
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
  };

  /**
   * An outcome as a sentence. For an Order that did not follow the Opportunity
   * it is the sentence of the Overview's propagation section, with the status
   * that was asked of the Order named as that section names it. For an
   * Opportunity that did not follow an Order the direction is the other one,
   * and so are the words.
   */
  const outcome = (code: string, entry: OpportunityHistoryEntry): string => {
    if (entry.action === NOT_FOLLOWED_ACTION) {
      return t(`history.notFollowed.${code === 'failed' ? 'failed' : 'skipped'}`);
    }
    const state = { ...asState(entry.before), ...asState(entry.after) };
    const status =
      typeof state.orderStatusCode === 'string'
        ? orderStatusLabel(state.orderStatusCode, orderStatuses, language)
        : NO_VALUE;
    const key = `propagation.outcome.${code}`;
    const sentence = t(key, { status });
    // An outcome this bundle has no sentence for is still words, not a code.
    return sentence === key ? humaniseKey(code) : sentence;
  };

  const fieldLabel = (field: string): string =>
    LABELLED_HISTORY_FIELDS.has(field)
      ? t(`history.field.${field}`)
      : t('history.field.other', { field: humaniseKey(field) });

  /** Custom field values: a line per field — every one that arrived, or only the ones an edit changed. */
  const customFields = (change: HistoryChange): ReactNode => {
    const edited = 'before' in change;
    const before = asState(change.before) ?? {};
    const after = asState(change.after) ?? {};
    const words = { yes: t('customFields.value.yes'), no: t('customFields.value.no') };
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) =>
      edited
        ? !same(before[key], after[key])
        : after[key] !== null && after[key] !== undefined && after[key] !== '',
    );
    if (keys.length === 0) return NO_VALUE;
    return (
      <ul className="space-y-0.5">
        {keys.map((key) => {
          const definition = definitions.find((candidate) => candidate.key === key);
          const shownValue = (raw: unknown): string =>
            customFieldValueLabel(definition, raw, language, words);
          return (
            <li key={key}>
              <span className="text-muted-foreground">{customFieldLabel(definition, key, language)}</span>
              {': '}
              {edited ? (
                <>
                  <span className="sr-only">{tCore('history.status.from')}</span>
                  <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                    {shownValue(before[key])}
                  </span>
                  <ArrowRight aria-hidden="true" className="mx-1.5 inline size-3.5 text-muted-foreground" />
                  <span className="sr-only">{tCore('history.status.to')}</span>
                </>
              ) : null}
              <span>{shownValue(after[key])}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  /**
   * What a creation or a join could not carry in (feature 162): which kind of
   * record the values came from, then a line per field with its reason, the
   * field named by the label stored with the skip. Every reader of the
   * Opportunity sees these lines — they name a field and a reason, never a
   * value (owner ruling V3, 2026-10-21) — so they need no definition read and
   * no `custom_fields:read`. What it did carry is silent here; the values show
   * in the entry's custom fields row, under that row's own gate.
   */
  const carryNote = (raw: unknown): ReactNode => {
    const source = asState(asState(raw)?.source);
    const from = source?.entityType === 'order' ? 'order' : 'quote_request';
    return (
      <div className="space-y-0.5">
        <p>{t(`history.customFieldCarry.from.${from}`)}</p>
        <ul className="list-disc space-y-0.5 pl-5">
          {carrySkips(raw).map((skip) => (
            <li key={skip.key} className="break-words">
              {t('history.customFieldCarry.line', {
                field: skippedFieldName(skip, language),
                // A reason this screen does not know yet reads as the generic
                // sentence — never as its code, however humanised.
                reason: CARRY_SKIP_REASONS.has(skip.reason)
                  ? t(`history.carryReason.${skip.reason}`)
                  : t('history.carryReasonUnknown'),
              })}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  /**
   * An edit that shows this reader nothing: its states differ only in the
   * custom-field values they may not read (owner ruling P2), so the entry says
   * that much rather than standing empty under its heading.
   */
  const valuesHidden = (entry: OpportunityHistoryEntry, changes: readonly HistoryChange[]): boolean =>
    !canSeeCustomFields &&
    entry.action === 'crm.opportunity.update' &&
    changes.length === 0 &&
    statusChange(entry) === null &&
    cause(entry) === null;

  const heading = (entry: OpportunityHistoryEntry): string => {
    const key = `auditLog.${entry.action}`;
    const label = t(key);
    return label === key ? t('history.action.unknown', { action: entry.action }) : label;
  };

  const statusChange = (entry: OpportunityHistoryEntry): ReactNode => {
    const before = asState(entry.before);
    const after = asState(entry.after);
    if (!after || typeof after.status !== 'string' || before?.status === after.status) return null;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="sr-only">{tCore('history.status.from')}</span>
        <span>{statusName(before?.status)}</span>
        <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">{tCore('history.status.to')}</span>
        <span className="font-medium">{statusName(after.status)}</span>
      </p>
    );
  };

  const cause = (entry: OpportunityHistoryEntry): ReactNode => {
    const after = asState(entry.after);
    if (!after) return null;
    if (after.cause === 'order_status') {
      return (
        <p className="text-sm text-muted-foreground">
          {t('history.cause.order')} {document('order', after.causeOrderId)}
        </p>
      );
    }
    if (after.cause === 'system') {
      return <p className="text-sm text-muted-foreground">{t('history.cause.system')}</p>;
    }
    return null;
  };

  /**
   * The rows an entry shows. An Order's status is `orders`' to show: no row
   * without `orders:read`. Custom-field values are `custom_fields`' (owner
   * ruling P2): the server strips them for a reader without
   * `custom_fields:read`, and this screen drops any that arrive all the same.
   */
  const changesOf = (entry: OpportunityHistoryEntry): HistoryChange[] =>
    historyChanges(entry).filter(
      (change) =>
        (canReadOrders || change.field !== 'orderStatusCode') &&
        (canSeeCustomFields || change.field !== 'customFieldValues') &&
        // A carry that skipped nothing has nothing to say.
        (change.field !== 'customFieldCarry' || carrySkips(change.after).length > 0),
    );

  return (
    <RecordHistory<OpportunityHistoryEntry>
      history={history}
      copy={{
        empty: t('history.empty'),
        end: t('history.end'),
        truncated: t('history.truncated'),
      }}
      heading={heading}
      changes={changesOf}
      fieldLabel={fieldLabel}
      renderValue={value}
      renderChange={(change): ReactNode | undefined =>
        change.field === 'customFieldValues'
          ? customFields(change)
          : change.field === 'customFieldCarry'
            ? carryNote(change.after)
            : undefined
      }
      renderLead={(entry, changes): ReactNode => (
        <>
          {statusChange(entry)}
          {cause(entry)}
          {valuesHidden(entry, changes) ? (
            <p className="break-words text-sm text-muted-foreground">{t('history.customFieldValuesHidden')}</p>
          ) : null}
        </>
      )}
    />
  );
}

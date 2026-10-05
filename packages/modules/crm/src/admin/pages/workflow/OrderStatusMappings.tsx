import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OpportunityWorkflow, OrderStatusMapping } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OrderStatusOption } from '../../api.js';
import { errorMessage, orderStatusLabel, workflowStatusLabel } from '../../lib/labels.js';

const FORWARD = 'opportunity_to_order' as const;
const REVERSE = 'order_to_opportunity' as const;

export interface OrderStatusMappingsProps {
  workflow: OpportunityWorkflow;
  /** `null` when the Order statuses could not be read (no `orders:read`, or `orders` off). */
  orderStatuses: readonly OrderStatusOption[] | null;
  language: string;
  /** Replaces the whole mapping set; resolves when the write was accepted. */
  onSave: (mappings: OrderStatusMapping[]) => Promise<void>;
}

/** What an Order status does to the Opportunity, as one row of the reverse table holds it. */
interface ReverseChoice {
  opportunityStatusCode: string;
  requireAllOrders: boolean;
}

/** Both directions, as the screen edits them. */
interface MappingDraft {
  /** Opportunity status code → the Order status it sets. */
  forward: Record<string, string>;
  /** Order status code → the Opportunity status it leads to, and whether it waits for every Order. */
  reverse: Record<string, ReverseChoice>;
}

/** The saved mappings in a stable order, so two reads of the same set compare equal. */
function savedDraftKey(workflow: OpportunityWorkflow): string {
  const forward: [string, string][] = [];
  const reverse: [string, ReverseChoice][] = [];
  for (const mapping of workflow.orderStatusMappings) {
    if (mapping.direction === FORWARD) {
      forward.push([mapping.opportunityStatusCode, mapping.orderStatusCode]);
    } else {
      reverse.push([
        mapping.orderStatusCode,
        {
          opportunityStatusCode: mapping.opportunityStatusCode,
          requireAllOrders: mapping.requireAllOrders,
        },
      ]);
    }
  }
  const byKey = <T,>(a: [string, T], b: [string, T]): number => a[0].localeCompare(b[0]);
  return JSON.stringify([forward.sort(byKey), reverse.sort(byKey)]);
}

function draftFromKey(key: string): MappingDraft {
  const [forward, reverse] = JSON.parse(key) as [[string, string][], [string, ReverseChoice][]];
  return { forward: Object.fromEntries(forward), reverse: Object.fromEntries(reverse) };
}

/**
 * The Order-status mappings of the workflow, in both directions.
 *
 * **Forward** — which Order status each Opportunity status sets on the linked
 * Orders that follow it. One row per Opportunity status and one choice per row,
 * because that is the rule the server holds (`mapping_duplicate`).
 *
 * **Reverse** (User Story 2) — which Opportunity status an Order status leads
 * to. One row per *Order* status, for the mirror rule
 * (`mapping_duplicate_order_status`): an Order status moves an Opportunity to
 * one status, while several Order statuses may lead to the same one. Each row
 * carries "only when every linked order is there", which is on by default when
 * the target closes the Opportunity — one delivered Order out of three should
 * not win the deal — and is the operator's to change.
 *
 * **An Order status that no longer exists is said on screen**, from the list
 * the Orders module answers (`GET /api/v1/admin/orders/statuses`), not from the
 * workflow's `orderStatusKnown`: that flag is evidence gathered from refusals
 * and cannot warn before the first one (`research.md` N-B1).
 *
 * The set is edited as one draft and saved as a whole — the endpoint replaces
 * the set, both directions together — so a half-edited table never reaches the
 * Orders.
 */
export function OrderStatusMappings(props: OrderStatusMappingsProps): ReactNode {
  const { workflow, orderStatuses, language, onSave } = props;
  const t = useTranslation('crm');
  // Keyed by what the mappings *are*, not by the workflow object: every write
  // on this screen answers a fresh workflow, and one that did not touch the
  // mappings must not discard a choice the operator has not saved yet.
  const savedKey = savedDraftKey(workflow);
  const saved = useMemo(() => draftFromKey(savedKey), [savedKey]);
  const [draft, setDraft] = useState<MappingDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // The stored mappings changed (a save came back, or a status carrying one was
  // deleted): start again from what is stored.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const statuses = useMemo(
    () => [...workflow.statuses].sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code)),
    [workflow.statuses],
  );

  /**
   * The rows of the reverse table: every Order status the Orders module
   * answers, then any mapped code it no longer answers — kept visible so the
   * operator can see the dead mapping and remove it.
   */
  const reverseRows = useMemo(() => {
    const known = (orderStatuses ?? []).map((option) => ({ code: option.code, known: true }));
    const knownCodes = new Set(known.map((row) => row.code));
    const gone = [...new Set([...Object.keys(saved.reverse), ...Object.keys(draft.reverse)])]
      .filter((code) => !knownCodes.has(code))
      .sort()
      .map((code) => ({ code, known: false }));
    return [...known, ...gone];
  }, [orderStatuses, saved.reverse, draft.reverse]);

  /** The draft as the endpoint takes it: forward in workflow order, then reverse in table order. */
  const toMappings = (from: MappingDraft): OpportunityWorkflow['orderStatusMappings'] => {
    const forward = statuses
      .filter((status) => (from.forward[status.code] ?? '') !== '')
      .map((status) => ({
        direction: FORWARD,
        opportunityStatusCode: status.code,
        orderStatusCode: from.forward[status.code] as string,
        requireAllOrders: false,
        orderStatusKnown: true,
      }));
    const reverse = reverseRows
      .filter((row) => from.reverse[row.code] !== undefined)
      .map((row) => ({
        direction: REVERSE,
        orderStatusCode: row.code,
        opportunityStatusCode: (from.reverse[row.code] as ReverseChoice).opportunityStatusCode,
        requireAllOrders: (from.reverse[row.code] as ReverseChoice).requireAllOrders,
        orderStatusKnown: true,
      }));
    return [...forward, ...reverse];
  };

  if (orderStatuses === null) {
    return (
      <Alert variant="warning">
        <AlertDescription>{t('workflow.mapping.ordersUnavailable')}</AlertDescription>
      </Alert>
    );
  }

  const dirty = savedDraftKey({ ...workflow, orderStatusMappings: toMappings(draft) }) !== savedKey;

  const save = async (): Promise<void> => {
    const mappings: OrderStatusMapping[] = toMappings(draft).map((mapping) =>
      mapping.direction === FORWARD
        ? {
            direction: FORWARD,
            opportunityStatusCode: mapping.opportunityStatusCode,
            orderStatusCode: mapping.orderStatusCode,
          }
        : {
            direction: REVERSE,
            orderStatusCode: mapping.orderStatusCode,
            opportunityStatusCode: mapping.opportunityStatusCode,
            requireAllOrders: mapping.requireAllOrders,
          },
    );
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await onSave(mappings);
      setNotice(t('workflow.mapping.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('workflow.error.save')));
    } finally {
      setBusy(false);
    }
  };

  const setReverseTarget = (orderStatusCode: string, opportunityStatusCode: string): void => {
    setNotice('');
    setDraft((previous) => {
      const reverse = { ...previous.reverse };
      if (opportunityStatusCode === '') {
        delete reverse[orderStatusCode];
      } else {
        const target = statuses.find((status) => status.code === opportunityStatusCode);
        reverse[orderStatusCode] = {
          opportunityStatusCode,
          // The default follows the target: closing a deal waits for every
          // Order, an open step does not. Choosing another target re-applies
          // it; the checkbox beside it is how the operator overrides.
          requireAllOrders: target !== undefined && target.kind !== 'open',
        };
      }
      return { ...previous, reverse };
    });
  };

  const setRequireAll = (orderStatusCode: string, requireAllOrders: boolean): void => {
    setNotice('');
    setDraft((previous) => {
      const current = previous.reverse[orderStatusCode];
      if (!current) return previous;
      return {
        ...previous,
        reverse: { ...previous.reverse, [orderStatusCode]: { ...current, requireAllOrders } },
      };
    });
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Table aria-label={t('workflow.mapping.title')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workflow.mapping.col.opportunityStatus')}</TableHead>
            <TableHead>{t('workflow.mapping.col.orderStatus')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statuses.map((status) => {
            const name = workflowStatusLabel(status, language);
            const value = draft.forward[status.code] ?? '';
            // A mapping whose Order status has since been deleted keeps its row
            // readable: the stale code stays selectable and says what it is.
            const stale = value !== '' && !orderStatuses.some((option) => option.code === value);
            return (
              <TableRow key={status.code}>
                <TableCell>
                  <Badge className="font-medium" style={statusBadgeStyle(status.color)}>
                    {name}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Select
                    className="max-w-sm"
                    value={value}
                    disabled={busy}
                    aria-label={t('workflow.mapping.orderStatusFor', { name })}
                    onChange={(event): void => {
                      setNotice('');
                      setDraft((previous) => ({
                        ...previous,
                        forward: { ...previous.forward, [status.code]: event.target.value },
                      }));
                    }}
                  >
                    <option value="">{t('workflow.mapping.none')}</option>
                    {stale ? (
                      <option value={value}>{t('workflow.mapping.unknown', { code: value })}</option>
                    ) : null}
                    {orderStatuses.map((option) => (
                      <option key={option.code} value={option.code}>
                        {orderStatusLabel(option.code, orderStatuses, language)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="space-y-1 pt-4">
        <h3 className="text-sm font-semibold tracking-tight">{t('workflow.reverse.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('workflow.reverse.description')}</p>
      </div>
      <Table aria-label={t('workflow.reverse.title')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workflow.mapping.col.orderStatus')}</TableHead>
            <TableHead>{t('workflow.mapping.col.opportunityStatus')}</TableHead>
            <TableHead>{t('workflow.reverse.col.requireAll')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reverseRows.map((row) => {
            const name = row.known
              ? orderStatusLabel(row.code, orderStatuses, language)
              : t('workflow.mapping.unknown', { code: row.code });
            const choice = draft.reverse[row.code];
            const checkboxId = `crm-reverse-all-${row.code}`;
            return (
              <TableRow key={row.code}>
                <TableCell>
                  <span className="font-medium">{name}</span>
                  {row.known ? null : (
                    <span className="mt-1 block text-xs text-destructive">
                      {t('workflow.reverse.unknownStatus')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    className="max-w-sm"
                    value={choice?.opportunityStatusCode ?? ''}
                    disabled={busy}
                    aria-label={t('workflow.reverse.opportunityStatusFor', { name })}
                    onChange={(event): void => setReverseTarget(row.code, event.target.value)}
                  >
                    <option value="">{t('workflow.reverse.none')}</option>
                    {statuses.map((status) => (
                      <option key={status.code} value={status.code}>
                        {workflowStatusLabel(status, language)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <label
                    htmlFor={checkboxId}
                    className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={choice?.requireAllOrders ?? false}
                      disabled={busy || choice === undefined}
                      aria-label={t('workflow.reverse.requireAllFor', { name })}
                      onChange={(event): void => setRequireAll(row.code, event.target.checked)}
                    />
                    <span aria-hidden="true">{t('workflow.reverse.requireAll')}</span>
                  </label>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Mounted before it has text, so the announcement is reliable. */}
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
        <Button disabled={!dirty || busy} aria-busy={busy} onClick={(): void => void save()}>
          {t('workflow.mapping.save')}
        </Button>
      </div>
    </div>
  );
}

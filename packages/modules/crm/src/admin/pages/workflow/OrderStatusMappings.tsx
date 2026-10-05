import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OpportunityWorkflow, OrderStatusMapping } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
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

export interface OrderStatusMappingsProps {
  workflow: OpportunityWorkflow;
  /** `null` when the Order statuses could not be read (no `orders:read`, or `orders` off). */
  orderStatuses: readonly OrderStatusOption[] | null;
  language: string;
  /** Replaces the whole mapping set; resolves when the write was accepted. */
  onSave: (mappings: OrderStatusMapping[]) => Promise<void>;
}

/** Opportunity status code → the Order status it sets, from the saved workflow. */
function savedForward(workflow: OpportunityWorkflow): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const mapping of workflow.orderStatusMappings) {
    if (mapping.direction === FORWARD) draft[mapping.opportunityStatusCode] = mapping.orderStatusCode;
  }
  return draft;
}

/**
 * Which Order status each Opportunity status sets on the linked Orders that
 * follow it.
 *
 * One row per Opportunity status and one choice per row, because that is the
 * rule the server holds (`mapping_duplicate`): an Opportunity status maps to at
 * most one Order status. The set is edited as a draft and saved as a whole —
 * the endpoint replaces the set — so a half-edited table never reaches the
 * Orders.
 *
 * Mappings in the other direction (an Order status moving the Opportunity) are
 * a later story's. Any the workflow already carries are sent back unchanged, so
 * saving this table cannot delete them.
 */
export function OrderStatusMappings(props: OrderStatusMappingsProps): ReactNode {
  const { workflow, orderStatuses, language, onSave } = props;
  const t = useTranslation('crm');
  const saved = useMemo(() => savedForward(workflow), [workflow]);
  const [draft, setDraft] = useState<Record<string, string>>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // The workflow changed under the table (a status was added or deleted, or a
  // save came back): start again from what is stored.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const statuses = useMemo(
    () => [...workflow.statuses].sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code)),
    [workflow.statuses],
  );

  if (orderStatuses === null) {
    return (
      <Alert variant="warning">
        <AlertDescription>{t('workflow.mapping.ordersUnavailable')}</AlertDescription>
      </Alert>
    );
  }

  const dirty = statuses.some((status) => (draft[status.code] ?? '') !== (saved[status.code] ?? ''));

  const save = async (): Promise<void> => {
    const forward: OrderStatusMapping[] = statuses
      .filter((status) => (draft[status.code] ?? '') !== '')
      .map((status) => ({
        direction: FORWARD,
        opportunityStatusCode: status.code,
        orderStatusCode: draft[status.code] as string,
      }));
    const reverse: OrderStatusMapping[] = workflow.orderStatusMappings
      .filter((mapping) => mapping.direction !== FORWARD)
      .map((mapping) => ({
        direction: mapping.direction,
        opportunityStatusCode: mapping.opportunityStatusCode,
        orderStatusCode: mapping.orderStatusCode,
        requireAllOrders: mapping.requireAllOrders,
      }));
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await onSave([...forward, ...reverse]);
      setNotice(t('workflow.mapping.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('workflow.error.save')));
    } finally {
      setBusy(false);
    }
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
            const value = draft[status.code] ?? '';
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
                      setDraft((previous) => ({ ...previous, [status.code]: event.target.value }));
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

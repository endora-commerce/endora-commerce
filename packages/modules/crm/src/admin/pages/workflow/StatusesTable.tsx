import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { OpportunityWorkflowStatus } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ReorderControls } from '../../components/reorder/ReorderControls.js';
import { workflowStatusLabel } from '../../lib/labels.js';

export interface StatusesTableProps {
  statuses: readonly OpportunityWorkflowStatus[];
  language: string;
  onEdit: (status: OpportunityWorkflowStatus) => void;
  onDelete: (status: OpportunityWorkflowStatus) => void;
  /** Move a status up (−1) or down (+1) — one batch reorder (issue #1560). */
  onMove: (status: OpportunityWorkflowStatus, delta: number) => void;
  /** A reorder is in flight: the move controls wait for it. */
  reordering: boolean;
}

/**
 * The statuses of the Opportunity workflow, in workflow order.
 *
 * The order is changed with the move controls on each row, one batch
 * reorder per move (issue #1560); the position column is the row's place.
 *
 * Delete is offered for every row, including one that is in use or is the
 * start status. The server is the authority on both — `inUseCount` counts only
 * the Opportunities *this* operator may see — so the screen asks and shows the
 * server's sentence rather than guessing from a number that can be an
 * undercount.
 */
export function StatusesTable(props: StatusesTableProps): ReactNode {
  const t = useTranslation('crm');
  const ordered = [...props.statuses].sort(
    (a, b) => a.weight - b.weight || a.code.localeCompare(b.code),
  );

  return (
    <Table aria-label={t('workflow.statuses.title')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('workflow.col.name')}</TableHead>
          <TableHead>{t('workflow.col.code')}</TableHead>
          <TableHead>{t('workflow.col.kind')}</TableHead>
          <TableHead className="text-right">{t('workflow.col.position')}</TableHead>
          <TableHead className="text-right">{t('workflow.col.inUse')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('workflow.col.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((status, index) => {
          const name = workflowStatusLabel(status, props.language);
          return (
            <TableRow key={status.code}>
              <TableCell>
                <Badge className="font-medium" style={statusBadgeStyle(status.color)}>
                  {name}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{status.code}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{t(`workflow.kind.${status.kind}`)}</span>
                  {status.isInitial ? (
                    <Badge variant="outline">{t('workflow.flag.initial')}</Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{index + 1}</TableCell>
              <TableCell className="text-right tabular-nums">{status.inUseCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <ReorderControls
                    name={name}
                    isFirst={index === 0}
                    isLast={index === ordered.length - 1}
                    disabled={props.reordering}
                    onMove={(delta): void => props.onMove(status, delta)}
                  />
                  <Button className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                    variant="ghost"
                    size="sm"
                    aria-label={t('workflow.status.editLabel', { name })}
                    onClick={(): void => props.onEdit(status)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                    variant="ghost"
                    size="sm"
                    aria-label={t('workflow.status.deleteLabel', { name })}
                    onClick={(): void => props.onDelete(status)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

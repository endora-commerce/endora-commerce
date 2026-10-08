import type { ReactNode } from 'react';
import { User } from 'lucide-react';
import type { OpportunityBoardCardField, OpportunitySummary } from '@endora-commerce/contracts';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { boardFieldLabel, boardFieldOptionLabel } from '../lib/board-fields.js';
import { calendarDateLabel, moneyLabel } from '../lib/labels.js';
import { AssigneeName } from './AssigneeName.js';
import { TagChips } from './TagPicker.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const instantLabel = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

/**
 * What a labelled field says on this card, or `null` when the Opportunity has
 * nothing for it — the field is then left out of the card.
 */
function fieldText(
  field: OpportunityBoardCardField,
  item: OpportunitySummary,
  language: string,
  t: Translate,
): string | null {
  const stored = item.cardValues?.[field.ref];
  if (field.source === 'builtin') {
    switch (field.key) {
      case 'expectedCloseDate':
        return item.expectedCloseDate ? calendarDateLabel(item.expectedCloseDate) : null;
      case 'createdAt':
        return instantLabel(item.createdAt);
      case 'updatedAt':
        return instantLabel(item.updatedAt);
      case 'closedAt':
        return instantLabel(item.closedAt);
      case 'source':
        return typeof stored === 'string' ? boardFieldOptionLabel(field, stored, language, t) : null;
      case 'linkedOrders':
      case 'linkedQuoteRequests':
        // No linked document is nothing to say on a card.
        return typeof stored === 'number' && stored > 0 ? String(stored) : null;
      default:
        return typeof stored === 'string' && stored !== '' ? stored : null;
    }
  }
  if (stored === null || stored === undefined || stored === '') return null;
  switch (field.kind) {
    case 'boolean':
      return typeof stored === 'boolean' ? t(stored ? 'customFields.value.yes' : 'customFields.value.no') : null;
    case 'date':
      return typeof stored === 'string' ? calendarDateLabel(stored) : null;
    case 'select':
      return boardFieldOptionLabel(field, String(stored), language, t);
    case 'multiselect':
      return Array.isArray(stored) && stored.length > 0
        ? stored.map((value) => boardFieldOptionLabel(field, String(value), language, t)).join(', ')
        : null;
    default:
      return typeof stored === 'string' || typeof stored === 'number' ? String(stored) : null;
  }
}

/**
 * The fields of one board card, in the configured order
 * (`specs/143-crm-sales-opportunities/`, User Story 19 — FR-091).
 *
 * The five fields the card always had keep the form they had — the number and
 * the Organization on one line when they are neighbours, the value as an
 * amount, the assignee with its icon, the tags as chips — so the default card
 * is the card as it was. Every other field is a label and its value on one
 * line, cut after two lines, and **left out when the Opportunity has no value
 * for it**: a card is read at a glance, and an empty row says nothing.
 */
export function BoardCardFields(props: {
  item: OpportunitySummary;
  fields: readonly OpportunityBoardCardField[];
}): ReactNode {
  const { item, fields } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const rows: ReactNode[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] as OpportunityBoardCardField;
    switch (field.ref) {
      case 'builtin:number':
        if (fields[index + 1]?.ref === 'builtin:organization') {
          rows.push(
            <p key="subtitle" className="break-words text-xs text-muted-foreground">
              {t('board.card.subtitle', { number: item.number, organization: item.organization.name })}
            </p>,
          );
          index += 1;
        } else {
          rows.push(
            <p key={field.ref} className="break-words text-xs text-muted-foreground">
              {item.number}
            </p>,
          );
        }
        break;
      case 'builtin:organization':
        rows.push(
          <p key={field.ref} className="break-words text-xs text-muted-foreground">
            {item.organization.name}
          </p>,
        );
        break;
      case 'builtin:value':
        rows.push(
          <p key={field.ref} className="text-sm tabular-nums">
            {moneyLabel(item.value, item.currency)}
          </p>,
        );
        break;
      case 'builtin:assignee':
        rows.push(
          <p key={field.ref} className="flex items-center gap-1 text-xs text-muted-foreground">
            <User aria-hidden="true" className="size-3.5 shrink-0" />
            <AssigneeName assignee={item.assignee} />
          </p>,
        );
        break;
      case 'builtin:tags':
        if (item.tags.length > 0) rows.push(<TagChips key={field.ref} tags={item.tags} />);
        break;
      default: {
        const text = fieldText(field, item, language, t);
        if (text === null) break;
        rows.push(
          <p key={field.ref} className="line-clamp-2 break-words text-xs" title={text}>
            <span className="text-muted-foreground">
              {t('board.card.field', { label: boardFieldLabel(field, language, t) })}
            </span>{' '}
            {text}
          </p>,
        );
      }
    }
  }
  return <>{rows}</>;
}

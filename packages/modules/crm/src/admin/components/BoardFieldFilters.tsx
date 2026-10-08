import { useEffect, useState, type ReactNode } from 'react';
import type {
  OpportunityBoardCardField,
  OpportunityFieldFilter,
  OpportunityFieldFilters,
} from '@endora-commerce/contracts';
import { Input, Label, MultiSelect, Select } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { boardFieldLabel, boardFieldOptionLabel, fieldFilterOperators } from '../lib/board-fields.js';
import { ContactLookup } from './LookupPickers.js';

const TYPING_PAUSE_MS = 300;

/**
 * A text or number box that tells its owner once typing pauses — the board is
 * read again for every change of a filter, not for every keystroke.
 */
function PausedInput(props: {
  id: string;
  value: string;
  onCommit: (value: string) => void;
  type?: 'text' | 'number' | 'search';
  inputMode?: 'decimal';
  ariaLabel?: string;
  placeholder?: string;
}): ReactNode {
  const { value, onCommit } = props;
  const [typed, setTyped] = useState(value);
  // What the owner holds changed from outside — *Clear*, or another address.
  useEffect(() => setTyped(value), [value]);
  useEffect(() => {
    if (typed === value) return undefined;
    const timer = setTimeout(() => onCommit(typed), TYPING_PAUSE_MS);
    return (): void => clearTimeout(timer);
  }, [typed, value, onCommit]);
  return (
    <Input
      id={props.id}
      type={props.type ?? 'text'}
      inputMode={props.inputMode}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      value={typed}
      onChange={(event): void => setTyped(event.target.value)}
    />
  );
}

export interface BoardFieldFiltersProps {
  idPrefix: string;
  /** The fields the cards show — a filter is offered for each that has one of its own. */
  fields: readonly OpportunityBoardCardField[];
  filters: OpportunityFieldFilters;
  /** One field's filter, whole; `null` when nothing of it is left. */
  onChange: (ref: string, filter: OpportunityFieldFilter | null) => void;
  /** The Organization the board is filtered by — a contact person is chosen within one. */
  organizationId: string | null;
  /** `crm:write`: the contact-person list is read on that code. */
  canPickContact: boolean;
}

/**
 * The filters of the fields a board card shows
 * (`specs/143-crm-sales-opportunities/`, User Story 19 — FR-092), one grid cell
 * each, of the kind the field is: a text it contains, a lowest and a highest
 * number or amount, a range of dates, yes / no, the options of a choice.
 *
 * The Organization, the assignee, the Sales Channel, the tags and the creation
 * date are not here: they are the filters the board always had
 * (`OpportunityFilterFields`), whatever the card shows.
 *
 * It renders grid cells and no container, as `OpportunityFilterFields` does.
 */
export function BoardFieldFilters(props: BoardFieldFiltersProps): ReactNode {
  const { idPrefix, fields, filters, onChange, organizationId, canPickContact } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();

  const cells: ReactNode[] = [];
  for (const field of fields) {
    const operators = fieldFilterOperators(field);
    if (operators.length === 0) continue;
    if (field.kind === 'contact' && !canPickContact) continue;
    const id = `${idPrefix}-${field.ref.replace(/[^A-Za-z0-9_]/g, '-')}`;
    const label = boardFieldLabel(field, language, t);
    const filter = filters[field.ref] ?? {};
    const patch = (change: OpportunityFieldFilter): void => {
      const next: Record<string, unknown> = { ...filter, ...change };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key];
      }
      onChange(field.ref, Object.keys(next).length > 0 ? (next as OpportunityFieldFilter) : null);
    };

    if (field.kind === 'text') {
      cells.push(
        <div key={field.ref} className="space-y-1">
          <Label htmlFor={id}>{label}</Label>
          <PausedInput
            id={id}
            type="search"
            value={filter.contains ?? ''}
            placeholder={t('board.filter.contains')}
            onCommit={(contains): void => patch({ contains: contains.trim() })}
          />
        </div>,
      );
    } else if (field.kind === 'number' || field.kind === 'money' || field.kind === 'date') {
      const range = field.kind === 'date';
      const [low, high] = range ? (['from', 'to'] as const) : (['min', 'max'] as const);
      cells.push(
        <fieldset key={field.ref} className="min-w-0 space-y-1">
          <legend className="text-sm font-medium leading-none">{label}</legend>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {([low, high] as const).map((operator) => {
              const name = t(`board.filter.${operator}`, { label });
              return range ? (
                <Input
                  key={operator}
                  id={`${id}-${operator}`}
                  type="date"
                  aria-label={name}
                  value={filter[operator] ?? ''}
                  {...(operator === 'from' ? { max: filter.to } : { min: filter.from })}
                  onChange={(event): void => patch({ [operator]: event.target.value })}
                />
              ) : (
                <PausedInput
                  key={operator}
                  id={`${id}-${operator}`}
                  type="number"
                  inputMode="decimal"
                  ariaLabel={name}
                  placeholder={t(`board.filter.${operator}Short`)}
                  value={filter[operator] ?? ''}
                  onCommit={(value): void => patch({ [operator]: value.trim().replace(',', '.') })}
                />
              );
            })}
          </div>
        </fieldset>,
      );
    } else if (field.kind === 'boolean') {
      cells.push(
        <div key={field.ref} className="space-y-1">
          <Label htmlFor={id}>{label}</Label>
          <Select
            id={id}
            value={filter.is === undefined ? '' : String(filter.is)}
            onChange={(event): void =>
              onChange(field.ref, event.target.value === '' ? null : { is: event.target.value === 'true' })
            }
          >
            <option value="">{t('board.filter.any')}</option>
            <option value="true">{t('customFields.value.yes')}</option>
            <option value="false">{t('customFields.value.no')}</option>
          </Select>
        </div>,
      );
    } else if (field.kind === 'select' || field.kind === 'multiselect') {
      cells.push(
        <div key={field.ref} className="space-y-1">
          {/* The multi-select's trigger is a button; the visible label names it. */}
          <span className="text-sm font-medium leading-none">{label}</span>
          <MultiSelect
            options={field.options.map((option) => ({
              value: option.value,
              label: boardFieldOptionLabel(field, option.value, language, t),
            }))}
            selected={[...(filter.in ?? [])]}
            onChange={(chosen): void => {
              // In the options' own order, so one choice is always one address.
              const wanted = new Set(chosen);
              patch({ in: field.options.map((option) => option.value).filter((value) => wanted.has(value)) });
            }}
            placeholder={t('board.filter.any')}
            ariaLabel={label}
            disabled={field.options.length === 0}
            searchable={field.options.length > 8}
            searchPlaceholder={t('board.filter.searchOptions')}
            className="flex w-full [&>button]:flex-1"
          />
        </div>,
      );
    } else if (field.kind === 'contact') {
      cells.push(
        <div key={field.ref} className="space-y-1">
          <Label htmlFor={id}>{label}</Label>
          <ContactLookup
            id={id}
            ariaLabel={label}
            {...(organizationId ? { organizationId } : {})}
            disabled={!organizationId}
            value={organizationId ? (filter.in?.[0] ?? null) : null}
            onChange={(contactId): void => onChange(field.ref, contactId ? { in: [contactId] } : null)}
            placeholder={t(organizationId ? 'board.filter.any' : 'board.filter.contactNeedsOrganization')}
            emptyMessage={t('opportunity.picker.contactEmpty')}
          />
        </div>,
      );
    }
  }
  return <>{cells}</>;
}

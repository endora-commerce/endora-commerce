import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { OrganizationSalesChannelOption } from '@endora-commerce/contracts';
import { Badge, Checkbox, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The stores an Organization's members may use, chosen from every sales
 * channel (feature 154). Shared by the Organization's *Sales channels* panel
 * and the *New organization* form, so the two read and behave alike.
 *
 * A list of checkboxes rather than a searchable multi-select: an instance runs
 * a handful of storefronts, every one of them is worth seeing at once, and the
 * two markers an operator decides by — the system default and an inactive
 * store — sit beside each name instead of inside a dropdown.
 *
 * Without `onChange` it renders the selected channels as a plain list, which is
 * the read-only view an operator without `customers:manage` gets.
 *
 * `pendingId` names a channel whose change is being written (the Organization
 * panel applies each tick at once, issue #1305): that box is `aria-busy` with a
 * spinner beside it, every box is `aria-disabled` and a tick is not passed on.
 * `aria-disabled` rather than `disabled`, so the box just ticked keeps the focus.
 */
export interface SalesChannelChecklistProps {
  options: readonly OrganizationSalesChannelOption[];
  value: readonly string[];
  onChange?: (next: string[]) => void;
  disabled?: boolean;
  /** Prefix for the checkbox ids — two lists on one page must not share them. */
  idPrefix: string;
  /** Id of the element naming the group (the panel's title or the field's label). */
  labelledBy: string;
  /** Ids of the description and, while invalid, the error message. */
  describedBy?: string | undefined;
  invalid?: boolean;
  /** The channel whose change is being written; every box waits for it. */
  pendingId?: string | null;
}

export function channelLabel(option: Pick<OrganizationSalesChannelOption, 'code' | 'name'>): string {
  const name = option.name['en-US'] ?? option.name['en'] ?? Object.values(option.name)[0];
  return name && name !== option.code ? `${name} (${option.code})` : option.code;
}

export function SalesChannelChecklist({
  options,
  value,
  onChange,
  disabled = false,
  idPrefix,
  labelledBy,
  describedBy,
  invalid = false,
  pendingId = null,
}: SalesChannelChecklistProps): ReactNode {
  const t = useTranslation('organizations');
  const selected = new Set(value);

  const markers = (option: OrganizationSalesChannelOption): ReactNode =>
    option.systemDefault ? (
      <Badge variant="secondary" className="text-[10px]">
        {t('salesChannels.systemDefault')}
      </Badge>
    ) : null;

  const text = (option: OrganizationSalesChannelOption): string =>
    option.active
      ? channelLabel(option)
      : `${channelLabel(option)} ${t('salesChannels.inactiveSuffix')}`;

  if (!onChange) {
    const assigned = options.filter((option) => selected.has(option.id));
    if (assigned.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('salesChannels.none')}</p>;
    }
    return (
      <ul aria-labelledby={labelledBy} className="grid gap-1 text-sm">
        {assigned.map((option) => (
          <li key={option.id} data-sales-channel-option className="flex items-center gap-2">
            <span>{text(option)}</span>
            {markers(option)}
          </li>
        ))}
      </ul>
    );
  }

  const toggle = (id: string, checked: boolean): void => {
    if (pendingId !== null) return;
    // The order the options are listed in, whatever order they were ticked in,
    // so the set compares and reads the same however it was reached.
    const next = new Set(value);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(options.filter((option) => next.has(option.id)).map((option) => option.id));
  };

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={invalid ? 'grid gap-2 rounded-md border border-destructive p-2' : 'grid gap-2'}
    >
      {options.map((option) => {
        const id = `${idPrefix}-${option.id}`;
        return (
          <div key={option.id} data-sales-channel-option className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={selected.has(option.id)}
              disabled={disabled}
              aria-disabled={pendingId !== null ? true : undefined}
              aria-busy={pendingId === option.id ? true : undefined}
              className="aria-disabled:cursor-wait aria-disabled:opacity-50"
              onChange={(e) => toggle(option.id, e.target.checked)}
            />
            <Label htmlFor={id} className="cursor-pointer font-normal">
              {text(option)}
            </Label>
            {markers(option)}
            {pendingId === option.id ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { PriceBookAudienceKind } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The audience members of a customer-group or organization book (feature 161,
 * FR-002, FR-003, FR-027).
 *
 * Built on the kit's `Combobox` rather than its `OrganizationPickerMulti` and
 * `CustomerGroupPicker`, because those read the organizations' and groups' own
 * endpoints: a book's members must come from the price-book targets, which are
 * scope-filtered for a sales representative (R10) and need only the pricing
 * codes. Organizations are searched on the server; the handful of customer
 * groups is filtered in the browser. Stored members are named through
 * `…/targets/organizations?ids=` (G12) — an id out of scope is simply absent.
 */
export function MemberPicker(props: {
  readonly kind: Exclude<PriceBookAudienceKind, 'everyone'>;
  readonly value: readonly string[];
  readonly onChange: (memberIds: string[]) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { kind, value, onChange } = props;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ComboboxOption<string>[]>([]);
  const [loading, setLoading] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  // The candidates: groups once, organizations per settled query.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        const load =
          kind === 'customer_groups'
            ? api.targets.customerGroups().then((groups) => groups.map((g) => ({ value: g.id, label: g.name, description: g.code })))
            : api.targets
                .organizations(query.trim() ? { search: query.trim(), limit: 20 } : { limit: 20 })
                .then((orgs) => orgs.map((o) => ({ value: o.id, label: o.name, description: o.taxId })));
        load
          .then((options) => {
            if (cancelled) return;
            setFound(options);
            setNames((current) => ({ ...current, ...Object.fromEntries(options.map((o) => [o.value, o.label])) }));
          })
          .catch(() => {
            if (!cancelled) setFound([]);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      kind === 'organizations' && query !== '' ? 250 : 0,
    );
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, kind, query]);

  // Name stored organization members the search has not brought in (G12).
  const unnamed = useMemo(() => value.filter((id) => names[id] === undefined), [value, names]);
  useEffect(() => {
    if (kind !== 'organizations' || unnamed.length === 0) return;
    let cancelled = false;
    void api.targets
      .organizations({ ids: unnamed })
      .then((orgs) => {
        if (!cancelled) setNames((current) => ({ ...current, ...Object.fromEntries(orgs.map((o) => [o.id, o.name])) }));
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [api, kind, unnamed]);

  const selected = new Set(value);
  const options = found.map((option) => ({ ...option, disabled: selected.has(option.value) }));
  const addLabel = kind === 'organizations' ? t('priceBooks.members.addOrganization') : t('priceBooks.members.addGroup');

  return (
    <div className="space-y-2">
      {props.disabled ? null : (
      <Combobox<string>
        options={options}
        value={null}
        onChange={(id): void => {
          if (id && !selected.has(id)) onChange([...value, id]);
          setQuery('');
        }}
        {...(kind === 'organizations' ? { onSearchChange: setQuery, manualFilter: true } : {})}
        loading={loading}
        clearable={false}
        placeholder={addLabel}
        emptyMessage={t('priceBooks.members.noMatch')}
        ariaLabel={addLabel}
        {...(props.id ? { id: props.id } : {})}
      />
      )}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('priceBooks.field.members')}>
          {value.map((id) => {
            const name = names[id] ?? t('priceBooks.members.unknown');
            return (
              <li key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-3 pr-1 text-sm">
                <span>{name}</span>
                {props.disabled ? null : (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('priceBooks.members.remove', { name })}
                    onClick={(): void => onChange(value.filter((member) => member !== id))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('priceBooks.members.none')}</p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';

/**
 * The pickers of the Projects screens — Organizations and administrators
 * (`specs/163-projects-and-tasks/`, User Story 5 — task T088).
 *
 * **Why the module has its own.** The kit's `OrganizationPickerMulti` and
 * `AdminUserPicker` read `/organizations` and `/admin-users`, each behind its
 * owner's code, so a role holding only `projects:*` got empty pickers. These
 * read the module's own `GET /projects/lookups/*` (gated `projects:read`) on
 * the kit's `Combobox` — the CRM precedent, `crm/…/LookupPickers.tsx`.
 *
 * Every picker has its three states: *loading* is the combobox's own, *empty*
 * says nothing matches, and a failed read is said under the field — a picker
 * that silently offers nothing reads as "there are none".
 */

const SEARCH_DEBOUNCE_MS = 250;

/** A chosen row: its id, and the name a chip shows. */
export interface LookupChoice {
  id: string;
  name: string;
}

export interface RemoteOptions {
  options: ComboboxOption<string>[];
  loading: boolean;
  failed: boolean;
  /** Whether a read has answered (or failed) since the picker was mounted. */
  settled: boolean;
  /** The label of an option seen during this visit, by id. */
  labelOf: (id: string | null) => string;
  search: (query: string) => void;
}

/**
 * Server-side search behind a combobox: one read on mount, then one per pause
 * in typing. A slower answer to an earlier query never replaces a later one.
 */
export function useRemoteOptions(load: (query: string) => Promise<ComboboxOption<string>[]>): RemoteOptions {
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(() => new Map());
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (query: string): Promise<void> => {
      const current = ++sequence.current;
      setLoading(true);
      setFailed(false);
      try {
        const found = await load(query.trim());
        if (current !== sequence.current) return;
        setOptions(found);
        setLabels((previous) => {
          const next = new Map(previous);
          for (const option of found) next.set(option.value, option.label);
          return next;
        });
      } catch {
        if (current !== sequence.current) return;
        setOptions([]);
        setFailed(true);
      } finally {
        if (current === sequence.current) {
          setLoading(false);
          setSettled(true);
        }
      }
    },
    [load],
  );

  useEffect(() => {
    void run('');
    return (): void => {
      sequence.current += 1;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [run]);

  const search = useCallback(
    (query: string): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(query), SEARCH_DEBOUNCE_MS);
    },
    [run],
  );

  const labelOf = useCallback((id: string | null): string => (id ? (labels.get(id) ?? '') : ''), [labels]);
  return { options, loading, failed, settled, labelOf, search };
}

const loadOrganizations = async (query: string): Promise<ComboboxOption<string>[]> =>
  (await projectsApi.lookupOrganizations(query)).map((organization) => ({ value: organization.id, label: organization.name }));

const loadAdminUsers = async (query: string): Promise<ComboboxOption<string>[]> =>
  (await projectsApi.lookupAdminUsers(query)).map((admin) => ({
    value: admin.id,
    label: admin.name,
    description: admin.email,
  }));

function LoadError(props: { shown: boolean }): ReactNode {
  const t = useTranslation('projects');
  if (!props.shown) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {t('picker.loadError')}
    </p>
  );
}

export interface LookupPickerProps {
  id?: string;
  ariaLabel: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** The label of `value` when it was chosen elsewhere (an address, a stored value). */
  selectedLabel?: string;
}

/** The name of one row by its id, or `null` when it cannot be read. */
type NameOf = (id: string) => Promise<string | null>;

const adminUserName: NameOf = (id) => projectsApi.adminUserName(id);
const organizationName: NameOf = (id) => projectsApi.organizationOption(id).then((option) => option?.name ?? null);

/**
 * The name of `id` when none of the options read so far names it — a value
 * given rather than chosen here (a restored filter, a stored Member) — asked of
 * the lookup by that one id. `''` while unknown, and when it cannot be read.
 */
function useResolvedName(id: string | null, known: string, nameOf: NameOf): string {
  const [resolved, setResolved] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!id || known) return undefined;
    let alive = true;
    void nameOf(id).then((name) => {
      if (alive && name) setResolved({ id, name });
    });
    return (): void => {
      alive = false;
    };
  }, [id, known, nameOf]);
  return resolved && resolved.id === id ? resolved.name : '';
}

/** One active administrator — a Member, or the list's "any member" filter. */
export function AdminUserLookup(props: LookupPickerProps): ReactNode {
  const t = useTranslation('projects');
  const remote = useRemoteOptions(loadAdminUsers);
  const known = remote.labelOf(props.value) || (props.selectedLabel ?? '');
  // Only once the first read has answered: the value is usually among its options.
  const resolved = useResolvedName(remote.settled ? props.value : null, known, adminUserName);
  return (
    <>
      <Combobox<string>
        id={props.id ?? ''}
        ariaLabel={props.ariaLabel}
        options={remote.options}
        value={props.value}
        onChange={props.onChange}
        onSearchChange={remote.search}
        manualFilter
        loading={remote.loading}
        loadingMessage={t('picker.loading')}
        clearable={props.clearable ?? true}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? ''}
        emptyMessage={t('picker.empty')}
        selectedLabel={known || resolved}
      />
      <LoadError shown={remote.failed} />
    </>
  );
}

/** One Organization in the caller's reach — the list's Organization filter. */
export function OrganizationLookup(props: LookupPickerProps): ReactNode {
  const t = useTranslation('projects');
  const remote = useRemoteOptions(loadOrganizations);
  const known = remote.labelOf(props.value) || (props.selectedLabel ?? '');
  // An Organization the address names (a shared link, the Organization screen's "All projects").
  const resolved = useResolvedName(remote.settled ? props.value : null, known, organizationName);
  return (
    <>
      <Combobox<string>
        id={props.id ?? ''}
        ariaLabel={props.ariaLabel}
        options={remote.options}
        value={props.value}
        onChange={props.onChange}
        onSearchChange={remote.search}
        manualFilter
        loading={remote.loading}
        loadingMessage={t('picker.loading')}
        clearable={props.clearable ?? true}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? ''}
        emptyMessage={t('picker.empty')}
        selectedLabel={known || resolved}
      />
      <LoadError shown={remote.failed} />
    </>
  );
}

export interface MultiLookupProps {
  id?: string;
  ariaLabel: string;
  /** The chosen rows, in the order they were chosen. */
  value: LookupChoice[];
  onChange: (value: LookupChoice[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Further choices are refused past this many. */
  max?: number;
  /** The accessible name of a chip's remove button. */
  removeLabel: (name: string) => string;
}

/**
 * Several rows, each a removable chip under the search field: choosing one
 * appends it, a row already chosen is not offered again.
 */
function MultiLookup(props: MultiLookupProps & { remote: RemoteOptions }): ReactNode {
  const t = useTranslation('projects');
  const { remote, value } = props;
  const chosen = new Set(value.map((row) => row.id));
  const max = props.max ?? 200;
  const choose = (id: string | null): void => {
    if (!id || chosen.has(id) || value.length >= max) return;
    props.onChange([...value, { id, name: remote.labelOf(id) || id }]);
  };
  return (
    <div className="space-y-2">
      <Combobox<string>
        id={props.id ?? ''}
        ariaLabel={props.ariaLabel}
        options={remote.options.map((option) => ({ ...option, disabled: chosen.has(option.value) }))}
        value={null}
        onChange={choose}
        onSearchChange={remote.search}
        manualFilter
        loading={remote.loading}
        loadingMessage={t('picker.loading')}
        clearable={false}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? ''}
        emptyMessage={t('picker.empty')}
      />
      <LoadError shown={remote.failed} />
      {value.length > 0 ? (
        <ul aria-label={props.ariaLabel} className="flex flex-wrap gap-2">
          {value.map((row) => (
            <li
              key={row.id}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-sm"
            >
              <span className="max-w-[16rem] truncate">{row.name}</span>
              <button
                type="button"
                className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={props.removeLabel(row.name)}
                disabled={props.disabled ?? false}
                onClick={(): void => props.onChange(value.filter((other) => other.id !== row.id))}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Organizations in the caller's reach — a Project's Organizations. */
export function OrganizationsLookup(props: MultiLookupProps): ReactNode {
  return <MultiLookup {...props} remote={useRemoteOptions(loadOrganizations)} />;
}

/** Active administrators — the people listed on a Project. */
export function AdminUsersLookup(props: MultiLookupProps): ReactNode {
  return <MultiLookup {...props} remote={useRemoteOptions(loadAdminUsers)} />;
}

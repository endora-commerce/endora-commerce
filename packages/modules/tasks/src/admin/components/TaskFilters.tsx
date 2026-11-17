import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { CustomFieldFilter, TaskPriorityConfig, TaskStatusConfig } from '@endora-commerce/contracts';
import { Button, Checkbox, Input, Label, MultiSelect, Select } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  TagMultiSelect,
  useCustomFieldListFilterFields,
  withCustomFieldFilter,
  writeCustomFieldFilterParams,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { workflowStatusName } from '../lib/labels.js';
import { customFilters, hiddenFilterCount, RECORD_FILTERS, withFilter } from '../lib/task-filters.js';

const SEARCH_DEBOUNCE_MS = 300;
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/tasks/custom-field-filters';

/** The categories behind "Closed". */
const CLOSED_CATEGORIES = ['done', 'cancelled'];

/** What a screen implies and so does not offer (*My Tasks*: who, open, published). */
export interface ImpliedFilters {
  assignee?: boolean;
  statusCategory?: boolean;
  draft?: boolean;
}

export interface TaskFiltersProps {
  /** Prefix of every control's `id`, unique on the page. */
  idPrefix: string;
  /** The address — the filters' one home (`lib/task-filters.ts`). */
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
  /** The workflow's statuses, in order. */
  statuses: readonly TaskStatusConfig[];
  /** The priority list, most urgent first. */
  priorities: readonly TaskPriorityConfig[];
  implied?: ImpliedFilters;
  /** A reader who may view custom fields gets their filters (`custom_fields:read`). */
  customFields: boolean;
}

/** "Open", "Closed" or nothing, from the address's categories. */
function categoryChoice(values: readonly string[]): '' | 'open' | 'closed' {
  if (values.length === 1 && values[0] === 'open') return 'open';
  if (values.length === CLOSED_CATEGORIES.length && CLOSED_CATEGORIES.every((c) => values.includes(c))) return 'closed';
  return '';
}

/** The one hierarchy choice the address carries. */
function hierarchyChoice(params: URLSearchParams): '' | 'subtasks' | 'topLevel' | 'parents' {
  if (params.get('isSubtask') === 'true') return 'subtasks';
  if (params.get('isSubtask') === 'false') return 'topLevel';
  if (params.get('hasSubtasks') === 'true') return 'parents';
  return '';
}

/** The custom-field filter cells — mounted only for a reader who may view custom fields, so only they read the fields. */
function CustomFieldCells(props: { params: URLSearchParams; onChange: (next: URLSearchParams) => void; idPrefix: string }): ReactNode {
  const { language } = useAppLanguage();
  const offered = useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);
  const value = customFilters(props.params);
  return (
    <CustomFieldListFilters
      idPrefix={`${props.idPrefix}-cf`}
      fields={offered.fields}
      value={value}
      onChange={(key: string, filter: CustomFieldFilter | null): void =>
        props.onChange(writeCustomFieldFilterParams(props.params, withCustomFieldFilter(value, key, filter)))
      }
      language={language}
      status={offered.status}
      onRetry={offered.reload}
    />
  );
}

/**
 * The filters the Tasks list, the board and *My Tasks* share
 * (`specs/165-task-management/` User Story 3 scenario 4, FR-020).
 *
 * Every control reads the address and writes it back; nothing is held here
 * but the search box, which is typed into and reaches the address once typing
 * pauses. The search, status, assignees and due range are always shown; the
 * rest folds behind *More filters*, which counts those in use while it is
 * closed (Hick's law, issue #512). Narrowing to one record (a linked record, a Project, a parent) has no
 * picker on this screen — it arrives in a link — and is shown as a sentence
 * with a way out.
 */
export function TaskFilters(props: TaskFiltersProps): ReactNode {
  const { idPrefix, params, onChange, statuses, priorities, implied = {}, customFields } = props;
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const id = (name: string): string => `${idPrefix}-${name}`;

  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  /** The search this control last wrote, so an address it did not write (Back, a saved view) is shown. */
  const written = useRef(q);
  const latest = useRef({ params, onChange });
  latest.current = { params, onChange };

  useEffect(() => {
    const typed = search.trim();
    if (typed === (latest.current.params.get('q') ?? '')) return undefined;
    const timer = setTimeout(() => {
      written.current = typed;
      latest.current.onChange(withFilter(latest.current.params, 'q', typed || null));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (q === written.current) return;
    written.current = q;
    setSearch(q);
  }, [q]);

  const set = (key: Parameters<typeof withFilter>[1], value: string | readonly string[] | null): void =>
    onChange(withFilter(params, key, value));

  const assignee = params.getAll('assignee');
  const assigneeChoice = assignee.length === 1 && (assignee[0] === 'me' || assignee[0] === 'none') ? assignee[0] : '';
  const hierarchy = hierarchyChoice(params);
  const narrowedToRecord = RECORD_FILTERS.some((key) => params.has(key));
  /** *More filters*: the rarely used filters, folded away until asked for (Hick's law, issue #512). */
  const [moreOpen, setMoreOpen] = useState(false);

  const hiddenInUse = hiddenFilterCount(params, implied);

  return (
    <>
      <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={id('search')}>{t('list.search')}</Label>
          <Input
            id={id('search')}
            type="search"
            value={search}
            placeholder={t('list.searchPlaceholder')}
            onChange={(event): void => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('status')}>{t('list.filter.status')}</Label>
          <Select
            id={id('status')}
            value={params.getAll('status').length === 1 ? (params.get('status') ?? '') : ''}
            onChange={(event): void => set('status', event.target.value || null)}
          >
            <option value="">{t('list.filter.statusAll')}</option>
            {statuses.map((status) => (
              <option key={status.code} value={status.code}>
                {workflowStatusName(status, language)}
              </option>
            ))}
          </Select>
        </div>
        {implied.assignee ? null : (
          <div className="space-y-1">
            <Label htmlFor={id('assignee')}>{t('list.filter.assignee')}</Label>
            <Select
              id={id('assignee')}
              value={assigneeChoice}
              onChange={(event): void => set('assignee', event.target.value || null)}
            >
              <option value="">{t('list.filter.assigneeAny')}</option>
              <option value="me">{t('list.filter.assigneeMe')}</option>
              <option value="none">{t('list.filter.assigneeNone')}</option>
            </Select>
          </div>
        )}
        {/* The due range is one cell: two dates read as one filter. */}
        <div className="grid grid-cols-2 gap-x-2">
          <div className="space-y-1">
            <Label htmlFor={id('due-from')}>{t('filter.dueFrom')}</Label>
            <Input
              id={id('due-from')}
              type="date"
              value={params.get('dueFrom') ?? ''}
              onChange={(event): void => set('dueFrom', event.target.value || null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('due-to')}>{t('filter.dueTo')}</Label>
            <Input
              id={id('due-to')}
              type="date"
              value={params.get('dueTo') ?? ''}
              onChange={(event): void => set('dueTo', event.target.value || null)}
            />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <label htmlFor={id('overdue')} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <Checkbox
            id={id('overdue')}
            checked={params.get('overdue') === 'true'}
            onChange={(event): void => set('overdue', event.target.checked ? 'true' : null)}
          />
          {t('list.filter.overdue')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 sm:min-h-8"
          aria-expanded={moreOpen}
          aria-controls={id('more-filters')}
          onClick={(): void => setMoreOpen((open) => !open)}
        >
          <ChevronDown
            aria-hidden="true"
            className={`transition-transform motion-reduce:transition-none${moreOpen ? ' rotate-180' : ''}`}
          />
          {moreOpen
            ? t('filter.fewer')
            : hiddenInUse > 0
              ? t('filter.moreCount', { count: hiddenInUse })
              : t('filter.more')}
        </Button>
      </div>
      {/* Mounted while collapsed too, so `aria-controls` always names an element. */}
      <div id={id('more-filters')} hidden={!moreOpen} className="mt-4">
        {moreOpen ? (
          <>
            <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {implied.statusCategory ? null : (
                <div className="space-y-1">
                  <Label htmlFor={id('category')}>{t('filter.statusCategory')}</Label>
                  <Select
                    id={id('category')}
                    value={categoryChoice(params.getAll('statusCategory'))}
                    onChange={(event): void =>
                      set(
                        'statusCategory',
                        event.target.value === 'open' ? 'open' : event.target.value === 'closed' ? CLOSED_CATEGORIES : null,
                      )
                    }
                  >
                    <option value="">{t('filter.statusCategory.any')}</option>
                    <option value="open">{t('filter.statusCategory.open')}</option>
                    <option value="closed">{t('filter.statusCategory.closed')}</option>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor={id('creator')}>{t('filter.creator')}</Label>
                <Select
                  id={id('creator')}
                  value={params.get('creator') === 'me' ? 'me' : ''}
                  onChange={(event): void => set('creator', event.target.value || null)}
                >
                  <option value="">{t('filter.creator.any')}</option>
                  <option value="me">{t('filter.creator.me')}</option>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="block text-sm font-medium" id={id('priority-label')}>
                  {t('filter.priority')}
                </span>
                <MultiSelect
                  options={[
                    ...priorities.map((priority) => ({ value: priority.code, label: workflowStatusName(priority, language) })),
                    { value: 'none', label: t('field.priorityNone') },
                  ]}
                  selected={params.getAll('priority')}
                  onChange={(next): void => set('priority', next)}
                  placeholder={t('filter.priority.any')}
                  ariaLabelledBy={id('priority-label')}
                  className="flex [&>button]:flex-1"
                />
              </div>
              <div className="space-y-1">
                <span className="block text-sm font-medium" id={id('tags-label')}>
                  {t('filter.tags')}
                </span>
                <TagMultiSelect
                  ariaLabelledBy={id('tags-label')}
                  selected={params.getAll('tagId')}
                  onChange={(next): void => set('tagId', next)}
                  loadTags={tasksApi.listTags}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={id('hierarchy')}>{t('filter.hierarchy')}</Label>
                <Select
                  id={id('hierarchy')}
                  value={hierarchy}
                  onChange={(event): void => {
                    let next = withFilter(withFilter(params, 'isSubtask', null), 'hasSubtasks', null);
                    if (event.target.value === 'subtasks') next = withFilter(next, 'isSubtask', 'true');
                    if (event.target.value === 'topLevel') next = withFilter(next, 'isSubtask', 'false');
                    if (event.target.value === 'parents') next = withFilter(next, 'hasSubtasks', 'true');
                    onChange(next);
                  }}
                >
                  <option value="">{t('filter.hierarchy.any')}</option>
                  <option value="subtasks">{t('filter.hierarchy.subtasks')}</option>
                  <option value="topLevel">{t('filter.hierarchy.topLevel')}</option>
                  <option value="parents">{t('filter.hierarchy.parents')}</option>
                </Select>
              </div>
              {customFields ? <CustomFieldCells params={params} onChange={onChange} idPrefix={idPrefix} /> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {implied.draft ? null : (
                <label htmlFor={id('draft')} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <Checkbox
                    id={id('draft')}
                    checked={params.get('draft') === 'true'}
                    onChange={(event): void => set('draft', event.target.checked ? 'true' : null)}
                  />
                  {t('filter.draft')}
                </label>
              )}
              <label htmlFor={id('private')} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <Checkbox
                  id={id('private')}
                  checked={params.get('private') === 'true'}
                  onChange={(event): void => set('private', event.target.checked ? 'true' : null)}
                />
                {t('filter.private')}
              </label>
            </div>
          </>
        ) : null}
      </div>
      {narrowedToRecord ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{t('filter.record')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={(): void => {
              let next = params;
              for (const key of RECORD_FILTERS) next = withFilter(next, key, null);
              onChange(next);
            }}
          >
            <X aria-hidden="true" />
            {t('filter.record.remove')}
          </Button>
        </p>
      ) : null}
    </>
  );
}

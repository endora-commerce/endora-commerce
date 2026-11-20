import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { CustomFieldFilter, TaskPriorityConfig, TaskStatusConfig } from '@endora-commerce/contracts';
import { Button, Input, Label, MultiSelect, Select } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  FilterChip,
  ListToolbar,
  ListToolbarSearch,
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
  /** The search box, so a screen can return focus to it (after *Clear filters*, WCAG 2.4.3). */
  // Typed off the kit's `Input`, whose React types this package does not share.
  searchRef?: ComponentProps<typeof Input>['ref'];
  /** The list's own controls — saved views, the sort — at the end of the filter row. */
  actions?: ReactNode;
  /** Whether the address narrows anything (`hasFilters`): *Clear all filters* is offered while it does. */
  filtered: boolean;
  /** Clears every filter; the kit then hands focus to the search box. */
  onClear: () => void;
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
 * pauses. The search, status, assignees, due range and *Overdue* are always
 * shown; the rest folds behind *More filters*, which counts those in use while
 * it is closed (Hick's law, issue #512). The bar is the kit's `ListToolbar`
 * (issue #1505, WORK-05), so it reads like every other list's. Narrowing to one record (a linked record, a Project, a parent) has no
 * picker on this screen — it arrives in a link — and is shown as a sentence
 * with a way out.
 */
export function TaskFilters(props: TaskFiltersProps): ReactNode {
  const { idPrefix, params, onChange, statuses, priorities, implied = {}, customFields, searchRef, actions, filtered, onClear } =
    props;
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

  return (
    <>
      <ListToolbar
        label={t('filter.toolbar')}
        search={
          <ListToolbarSearch
            ref={searchRef}
            id={id('search')}
            label={t('list.search')}
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onValueChange={setSearch}
          />
        }
        filters={
          <>
            <Select
              id={id('status')}
              aria-label={t('list.filter.status')}
              className="w-auto"
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
            {implied.assignee ? null : (
              <Select
                id={id('assignee')}
                aria-label={t('list.filter.assignee')}
                className="w-auto"
                value={assigneeChoice}
                onChange={(event): void => set('assignee', event.target.value || null)}
              >
                <option value="">{t('list.filter.assigneeAny')}</option>
                <option value="me">{t('list.filter.assigneeMe')}</option>
                <option value="none">{t('list.filter.assigneeNone')}</option>
              </Select>
            )}
            {/* The due range is one group: two dates read as one filter, under one visible word. */}
            <div role="group" aria-labelledby={id('due-label')} className="flex items-center gap-1.5">
              <span id={id('due-label')} className="text-sm text-muted-foreground">
                {t('filter.due')}
              </span>
              <Input
                id={id('due-from')}
                type="date"
                aria-label={t('filter.dueFrom')}
                className="w-auto"
                value={params.get('dueFrom') ?? ''}
                max={params.get('dueTo') ?? undefined}
                onChange={(event): void => set('dueFrom', event.target.value || null)}
              />
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              <Input
                id={id('due-to')}
                type="date"
                aria-label={t('filter.dueTo')}
                className="w-auto"
                value={params.get('dueTo') ?? ''}
                min={params.get('dueFrom') ?? undefined}
                onChange={(event): void => set('dueTo', event.target.value || null)}
              />
            </div>
            <FilterChip
              pressed={params.get('overdue') === 'true'}
              onPressedChange={(next): void => set('overdue', next ? 'true' : null)}
            >
              {t('list.filter.overdue')}
            </FilterChip>
          </>
        }
        {...(actions ? { actions } : {})}
        moreFilters={
          <>
            {implied.statusCategory ? null : (
              <div className="space-y-1">
                <Label htmlFor={id('category')}>{t('filter.statusCategory')}</Label>
                <Select
                  id={id('category')}
                  value={categoryChoice(params.getAll('statusCategory'))}
                  onChange={(event): void =>
                    set('statusCategory', event.target.value === 'open' ? 'open' : event.target.value === 'closed' ? CLOSED_CATEGORIES : null)
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
            {/* On/off filters are chips, in one cell after the others (DS-06). */}
            <div className="flex flex-wrap items-end gap-2">
              {implied.draft ? null : (
                <FilterChip
                  pressed={params.get('draft') === 'true'}
                  onPressedChange={(next): void => set('draft', next ? 'true' : null)}
                >
                  {t('filter.draft')}
                </FilterChip>
              )}
              <FilterChip
                pressed={params.get('private') === 'true'}
                onPressedChange={(next): void => set('private', next ? 'true' : null)}
              >
                {t('filter.private')}
              </FilterChip>
            </div>
            {customFields ? <CustomFieldCells params={params} onChange={onChange} idPrefix={idPrefix} /> : null}
          </>
        }
        moreFiltersActiveCount={hiddenFilterCount(params, implied)}
        filtersActive={filtered}
        onClearFilters={onClear}
      />
      {narrowedToRecord ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
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

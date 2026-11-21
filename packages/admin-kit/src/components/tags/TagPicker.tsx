import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { statusBadgeStyle } from '../../lib/status-color.js';
import { Badge } from '../../ui/badge.js';
import { MultiSelect } from '../../ui/multi-select.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/**
 * Tags as a record shows and chooses them — CRM's `TagPicker.tsx`, promoted by
 * `specs/165-task-management/` research R-10 when Tasks became its second
 * consumer (Constitution IX). The kit knows no module: **where the tag list
 * comes from is a prop** (`loadTags`), each module reading its own list behind
 * its own permission.
 */

/** One tag as a list offers it and a record carries it. */
export interface TagOption {
  id: string;
  name: string;
  /** `#rrggbb`. */
  color: string;
}

/** The tags a record carries, as chips in the tags' own colours; nothing for none. */
export function TagChips(props: { tags: ReadonlyArray<Pick<TagOption, 'id' | 'name' | 'color'>> }): ReactNode {
  if (props.tags.length === 0) return null;
  return (
    <ul role="list" className="flex flex-wrap gap-1">
      {props.tags.map((tag) => (
        <li key={tag.id}>
          <Badge className="font-normal" style={statusBadgeStyle(tag.color)}>
            {tag.name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * The tag list, read once per mount through the caller's own loader. Pass a
 * stable function (a module-level one, or memoised): a new one reads again.
 */
export function useTagOptions<T extends TagOption>(
  loadTags: () => Promise<readonly T[]>,
): { tags: readonly T[]; loading: boolean; failed: boolean } {
  const [tags, setTags] = useState<readonly T[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    loadTags()
      .then((found) => {
        if (alive) setTags(found);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [loadTags]);
  return { tags, loading, failed };
}

/**
 * The trigger's accessible name — what the choice is *for* on this screen:
 * `ariaLabelledBy`, the id of the visible label beside it, or, with no visible
 * label, `ariaLabel`.
 */
export type TagMultiSelectName =
  | { ariaLabel: string; ariaLabelledBy?: never }
  | { ariaLabelledBy: string; ariaLabel?: never };

export type TagMultiSelectProps = TagMultiSelectName & {
  selected: readonly string[];
  onChange: (tagIds: string[]) => void;
  /** Where the tag list comes from — the module's own endpoint. Keep it stable. */
  loadTags: () => Promise<readonly TagOption[]>;
  /** The trigger's id — what an `InlineEdit` editor puts its focus on. */
  id?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Choose any number of tags from the tag list — on the kit's `MultiSelect`.
 *
 * The selection is returned **in the tag list's order** (by name), not in the
 * order of the clicks, so the same choice is always the same request. With no
 * tags defined the control is disabled and says so; a list that could not be
 * read says that instead.
 */
export function TagMultiSelect(props: TagMultiSelectProps): ReactNode {
  const t = useTranslation('core');
  const { tags, loading, failed } = useTagOptions(props.loadTags);
  const options = useMemo(() => tags.map((tag) => ({ value: tag.id, label: tag.name })), [tags]);
  const placeholder = loading
    ? t('tags.picker.loading')
    : tags.length === 0
      ? t('tags.picker.none')
      : t('tags.picker.placeholder');
  return (
    <>
      <MultiSelect
        options={options}
        selected={[...props.selected]}
        {...(props.id !== undefined ? { id: props.id } : {})}
        onChange={(next): void => {
          const chosen = new Set(next);
          props.onChange(tags.filter((tag) => chosen.has(tag.id)).map((tag) => tag.id));
        }}
        placeholder={placeholder}
        {...(props.ariaLabelledBy !== undefined
          ? { ariaLabelledBy: props.ariaLabelledBy }
          : { ariaLabel: props.ariaLabel })}
        disabled={(props.disabled ?? false) || loading || tags.length === 0}
        searchable={tags.length > 8}
        searchPlaceholder={t('tags.picker.search')}
        // The kit's trigger is an inline-level button: as a flex item it leaves
        // no descender gap under it, so the field lines up with its neighbours.
        className={`flex [&>button]:flex-1 ${props.className ?? ''}`.trim()}
      />
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t('tags.picker.loadError')}
        </p>
      ) : null}
    </>
  );
}

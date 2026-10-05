import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OpportunityTag, OpportunityTagRef } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import { Badge, MultiSelect } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';

/** The tags an Opportunity carries, as chips in the tags' own colours. */
export function TagChips(props: { tags: readonly OpportunityTagRef[] }): ReactNode {
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

/** The platform's tag list (`GET /tags`, `crm:read`), read once per screen. */
export function useTagOptions(): { tags: OpportunityTag[]; loading: boolean; failed: boolean } {
  const [tags, setTags] = useState<OpportunityTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    crmApi
      .listTags()
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
  }, []);
  return { tags, loading, failed };
}

export interface TagMultiSelectProps {
  /** The trigger's accessible name — what the choice is *for* on this screen. */
  ariaLabel: string;
  selected: readonly string[];
  onChange: (tagIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Choose any number of tags from the tag list — on the kit's `MultiSelect`.
 *
 * The selection is returned **in the tag list's order** (by name), not in the
 * order of the clicks, so the same choice is always the same request.
 * With no tags defined the control is disabled and says so; a list that could
 * not be read says that instead.
 */
export function TagMultiSelect(props: TagMultiSelectProps): ReactNode {
  const t = useTranslation('crm');
  const { tags, loading, failed } = useTagOptions();
  const options = useMemo(() => tags.map((tag) => ({ value: tag.id, label: tag.name })), [tags]);
  const placeholder = loading
    ? t('opportunity.picker.loading')
    : tags.length === 0
      ? t('tags.picker.none')
      : t('tags.picker.placeholder');
  return (
    <>
      <MultiSelect
        options={options}
        selected={[...props.selected]}
        onChange={(next): void => {
          const chosen = new Set(next);
          props.onChange(tags.filter((tag) => chosen.has(tag.id)).map((tag) => tag.id));
        }}
        placeholder={placeholder}
        ariaLabel={props.ariaLabel}
        disabled={(props.disabled ?? false) || loading || tags.length === 0}
        searchable={tags.length > 8}
        searchPlaceholder={t('tags.picker.search')}
        // The kit's trigger is an inline-level button: as a flex item it leaves
        // no descender gap under it, so the field lines up with its neighbours.
        className={`flex [&>button]:flex-1 ${props.className ?? ''}`.trim()}
      />
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t('opportunity.picker.loadError')}
        </p>
      ) : null}
    </>
  );
}

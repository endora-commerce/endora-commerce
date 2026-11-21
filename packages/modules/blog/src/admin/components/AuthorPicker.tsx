import { useEffect, useId, useState, type ReactNode } from 'react';
import type { BlogAuthorCandidate, BlogPostAuthorAdmin } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { Badge, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 171 (US7) — the post's author, chosen among the active administrators
 * (`GET /api/v1/admin/blog/author-candidates`, `blog.write`: no administrator rights
 * needed). An author who has since become inactive stays selected and is marked so; a
 * deleted one is shown as such, and the storefront shows no author for them.
 *
 * Controlled by the chosen administrator's id: the choice is part of the editor's draft and is
 * saved with its one Save (issue #1512, DEC-08). `saved` is the author as last saved, so an author
 * who is no longer a candidate stays an option and keeps their mark.
 */
export function AuthorPicker({
  value,
  saved,
  disabled,
  onChange,
}: {
  /** The chosen administrator's id, `null` for none. */
  value: string | null;
  /** The author as last saved. */
  saved: BlogPostAuthorAdmin | null;
  disabled?: boolean;
  onChange: (adminUserId: string | null) => void;
}): ReactNode {
  const t = useTranslation('blog');
  const id = useId();
  const [candidates, setCandidates] = useState<BlogAuthorCandidate[]>([]);

  useEffect(() => {
    void apiClient
      .get<{ data: BlogAuthorCandidate[] }>('/api/v1/admin/blog/author-candidates')
      .then((out) => setCandidates(out.data))
      .catch(() => setCandidates([]));
  }, []);

  // The current author stays an option even when no longer a candidate.
  const options =
    saved && !candidates.some((c) => c.id === saved.id)
      ? [{ id: saved.id, name: saved.name || t('author.deleted'), avatarUrl: saved.avatarUrl }, ...candidates]
      : candidates;
  const chosen = options.find((option) => option.id === value) ?? null;
  // The inactive / deleted mark belongs to the saved author, and only while they stay chosen.
  const state = saved && saved.id === value ? saved.state : 'active';

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t('author.label')}</Label>
      <div className="flex items-center gap-2">
        {chosen?.avatarUrl ? (
          // Decorative: the name is beside it.
          <img src={chosen.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : null}
        <Select
          id={id}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('author.none')}</option>
          {options.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
        {state !== 'active' ? (
          <Badge variant="warning">{state === 'inactive' ? t('author.inactive') : t('author.deleted')}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('author.hint')}</p>
    </div>
  );
}

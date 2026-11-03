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
 */
export function AuthorPicker({
  value,
  disabled,
  onChange,
}: {
  value: BlogPostAuthorAdmin | null;
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
    value && !candidates.some((c) => c.id === value.id)
      ? [{ id: value.id, name: value.name || t('author.deleted'), avatarUrl: value.avatarUrl }, ...candidates]
      : candidates;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t('author.label')}</Label>
      <div className="flex items-center gap-2">
        {value?.avatarUrl ? (
          // Decorative: the name is beside it.
          <img src={value.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : null}
        <Select
          id={id}
          value={value?.id ?? ''}
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
        {value && value.state !== 'active' ? (
          <Badge variant="warning">{value.state === 'inactive' ? t('author.inactive') : t('author.deleted')}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('author.hint')}</p>
    </div>
  );
}

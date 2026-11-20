import type { ReactNode } from 'react';
import type { BlogPostStatus } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const VARIANT_BY_STATUS: Record<BlogPostStatus, 'success' | 'secondary' | 'outline'> = {
  draft: 'secondary',
  published: 'success',
  archived: 'outline',
};

/**
 * A post's status, and whether it is inactive, as badges with text in the
 * operator's language — the colour is never the only carrier (issue #1495, UX
 * audit CONTENT-13; the badge used to print the raw English enum).
 */
export function PostStatusBadge({
  status,
  active = true,
}: {
  status: BlogPostStatus;
  active?: boolean;
}): ReactNode {
  const t = useTranslation('blog');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={VARIANT_BY_STATUS[status]}>{t(`status.${status}`)}</Badge>
      {!active ? <Badge variant="outline">{t('status.inactive')}</Badge> : null}
    </span>
  );
}

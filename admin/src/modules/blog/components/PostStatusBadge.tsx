import type { ReactNode } from 'react';
import type { BlogPostStatus } from '@b2b/contracts';
import { Badge } from '@/components/ui/badge';

const VARIANT_BY_STATUS: Record<BlogPostStatus, 'default' | 'outline' | 'secondary'> = {
  draft: 'outline',
  published: 'default',
  archived: 'secondary',
};

const LABEL_BY_STATUS: Record<BlogPostStatus, string> = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
};

export function PostStatusBadge({
  status,
  active = true,
}: {
  status: BlogPostStatus;
  active?: boolean;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={VARIANT_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
      {!active ? (
        <Badge variant="outline" className="text-[10px]">
          inactive
        </Badge>
      ) : null}
    </span>
  );
}

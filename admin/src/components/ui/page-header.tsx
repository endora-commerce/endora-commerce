import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The standard page header: title + optional description on the left,
 * an actions slot on the right. Used across every admin module page.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps): ReactNode {
  return (
    <header
      className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

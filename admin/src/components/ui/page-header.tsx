import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The standard page header: title + optional description on the left,
 * an actions slot on the right. Used across every admin module page.
 *
 * An optional `back` link renders above the title as a small muted
 * affordance (chevron + label), mirroring the detail-view pattern in the
 * Admin UI design reference.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { label: ReactNode; to: string };
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: PageHeaderProps): ReactNode {
  return (
    <header className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="space-y-1">
        {back ? (
          <Link
            to={back.to}
            className="-ml-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {back.label}
          </Link>
        ) : null}
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

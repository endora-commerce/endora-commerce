import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A titled content block used inside the order-detail tab card. Mirrors the
 * product-editor pattern where each tab panel is a set of plain sections
 * within a single card body (no nested cards).
 */
export function Section(props: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className={cn('space-y-3', props.className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{props.title}</h2>
        {props.action ?? null}
      </div>
      {props.children}
    </section>
  );
}

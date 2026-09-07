import { type ReactNode } from 'react';
import { cn } from '../lib/utils.js';

/**
 * A titled content block: a heading, an optional action beside it, and the
 * caller's children. Mirrors the product-editor pattern where each tab panel is
 * a set of plain sections within a single card body (no nested cards).
 *
 * **Published by feature 091, P8.** It sat under `orders`' admin directory and
 * was rendered by `quote_requests`' RFQ detail as well as by three of `orders`'
 * own tabs — fourteen lines of `<section>`, `cn` and an `<h2>`, with nothing of
 * `orders` inside it. It is a layout primitive rather than a composite, so its
 * home is `./ui` and not `./components`.
 */
export interface SectionProps {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Section(props: SectionProps): ReactNode {
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

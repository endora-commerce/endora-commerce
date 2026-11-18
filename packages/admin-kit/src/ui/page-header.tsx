import { useId, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { HelpTip } from './help-tip.js';

/**
 * The standard page header: the page's one `h1`, an optional one-line
 * description and an optional ⓘ on the left, an actions slot on the right.
 * Every admin page draws its heading through it — issue #1436 (UX audit
 * 2026-11-17, DS-02) retired the parallel `.b2b-page-head` markup, which drew
 * the title as a `<div>` and left those pages without an `h1`.
 *
 * An optional `back` link renders above the title as a small muted
 * affordance (chevron + label), mirroring the detail-view pattern in the
 * Admin UI design reference.
 */
export interface PageHeaderProps {
  title: ReactNode;
  /**
   * **Opt-in, one line, clamped to it.** Only for something the screen does not
   * already show — a count, a scope, a state — never a restatement of the
   * title. The content rule (≤ 80 characters) is in
   * `specs/conventions/module-i18n.md`; longer text goes to `help`.
   */
  description?: ReactNode;
  /**
   * A longer explanation of the page, behind a ⓘ beside the title — a
   * `HelpTip`, opened by click, tap or keyboard, named after the title.
   */
  help?: ReactNode;
  actions?: ReactNode;
  /**
   * `onClick` runs before the navigation; call `event.preventDefault()` to hold
   * it — an editor with unsaved changes asks first. A `back` with an `onClick`
   * is that editor's own guard, so the link carries `data-own-unsaved-guard`
   * and `useUnsavedChangesPrompt` does not ask a second time.
   */
  back?: { label: ReactNode; to: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  /**
   * Controls or badges that belong to the title — an *Edit* beside it, a
   * status — drawn next to the heading but outside it, so the heading's name
   * stays its words.
   */
  titleActions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  help,
  actions,
  back,
  titleActions,
  className,
}: PageHeaderProps): ReactNode {
  const headingId = useId();
  const heading = (
    <h1 id={headingId} className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
      {title}
    </h1>
  );
  return (
    <header className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        {back ? (
          <Link
            to={back.to}
            onClick={back.onClick}
            data-own-unsaved-guard={back.onClick ? '' : undefined}
            className="-ml-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            {back.label}
          </Link>
        ) : null}
        {help || titleActions ? (
          <div className="flex items-center gap-1">
            {heading}
            {/* Named "More information: <title>" — one of several ⓘ on a screen is still identifiable. */}
            {help ? (
              <HelpTip subjectId={headingId} className="ml-1">
                {help}
              </HelpTip>
            ) : null}
            {titleActions}
          </div>
        ) : (
          heading
        )}
        {description ? <p className="line-clamp-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

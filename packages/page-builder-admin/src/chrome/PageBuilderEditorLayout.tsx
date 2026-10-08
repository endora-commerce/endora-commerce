import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Where the operator's last choice about the settings panel is kept.
 *
 * **One slot for every Page Builder editor** — CMS pages, blocks and templates,
 * blog posts and blog categories. It is a preference about the editing surface
 * ("I want my fields beside the canvas" / "I want the canvas to myself"), not
 * about pages as opposed to posts, and an operator who put the panel away on a
 * page should not have to put it away again on a post.
 *
 * The value still says `cms-editor` because that is what the CMS editors wrote
 * before the shell was shared: renaming the slot would silently reset everyone
 * who had already chosen.
 */
export const PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY = 'b2b-admin.cms-editor.settings-panel';

/**
 * The width from which the settings panel is a column beside the Page Builder.
 * The classes below spell the same number as `min-[1800px]:` — Tailwind reads
 * class names as literals, so the two are kept in step by hand.
 *
 * Not the `2xl` breakpoint (1536px): with the admin navigation, the 20rem
 * panel and the builder's own two side panels, a 1536px viewport leaves the
 * canvas under 300px, and up to about 1780px the builder's toolbar does not
 * fit on one row — its title is clipped by the buttons either side of it.
 */
export const PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH = 1800;

function hasRoomBesideBuilder(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(`(min-width: ${PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH}px)`).matches;
}

/**
 * The operator's remembered choice, or — when they have never made one — open
 * only where the panel is a column beside the builder. Below that width an
 * open panel is a block above the canvas and pushes it off the first screen.
 */
function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* storage disabled or absent — fall through to the width default */
  }
  return hasRoomBesideBuilder();
}

function writePreference(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* storage full, disabled or absent — the in-memory value still holds */
  }
}

export interface PageBuilderEditorSettingsPanel {
  /** Whether the settings cards are showing. */
  open: boolean;
  /** The operator's own choice: flips the panel and remembers it. */
  toggle: () => void;
  /**
   * The screen's choice: open the panel because something in it needs the
   * operator — a save refused over a name, a code or a scope. Deliberately not
   * remembered, so being shown an error never rewrites a preference.
   */
  reveal: () => void;
  /** Bumped by every `reveal`, so the layout can bring the panel into view. */
  revealCount: number;
}

/**
 * State of the settings panel beside the Page Builder.
 *
 * The operator's choice is remembered. Until they make one it is open where the
 * viewport has room for it beside the builder and closed where it would sit
 * above the canvas. A new entity opens it regardless: nothing can be saved
 * without a name and a scope, so hiding those fields first would only make the
 * operator go and find them.
 */
export function usePageBuilderEditorSettingsPanel(isNew: boolean): PageBuilderEditorSettingsPanel {
  const [open, setOpen] = useState<boolean>(() => isNew || readPreference());
  const [revealCount, setRevealCount] = useState(0);

  // The router reuses an editor instance across `/:id` → `/new`.
  useEffect(() => {
    if (isNew) setOpen(true);
  }, [isNew]);

  const toggle = useCallback((): void => {
    const next = !open;
    writePreference(next);
    setOpen(next);
  }, [open]);

  const reveal = useCallback((): void => {
    setOpen(true);
    setRevealCount((count) => count + 1);
  }, []);

  return useMemo(
    () => ({ open, toggle, reveal, revealCount }),
    [open, toggle, reveal, revealCount],
  );
}

export interface PageBuilderEditorLayoutProps {
  /** The page header and whatever is announced under it — the save result, a refusal. */
  header: ReactNode;
  /**
   * What the canvas is edited **under**, on the row directly above it: the
   * content-language tabs, and anything else that says which content is on the
   * canvas or is part of composing it (an e-mail's subject). Never put away.
   */
  canvasBar?: ReactNode | undefined;
  /**
   * The canvas. `null` says the entity has **no canvas yet** — a blog post
   * cannot be given content before it exists — and then the settings are the
   * page: shown in full, with no control to hide them, because there is
   * nothing to give the room to.
   */
  builder: ReactNode | null;
  /** What is composed on the canvas, when "Page Builder" is not the best name for it. */
  builderLabel?: string | undefined;
  /**
   * The cards that describe the entity rather than compose it. Omit — together
   * with `settingsPanel` — on a screen that has none, and the canvas simply has
   * the page.
   */
  settings?: ReactNode | undefined;
  settingsPanel?: PageBuilderEditorSettingsPanel | undefined;
}

/**
 * The shell every Page Builder editor is laid out in: CMS pages, blocks and
 * templates, blog posts and categories, transactional e-mails and their
 * reusable blocks and templates.
 *
 * The canvas is the main column: it is what an editor spends the session in.
 * The cards that describe the entity are a secondary panel — a column to its
 * right where the viewport has room for one, a block above it where it does
 * not — and the panel can be put away to give the canvas the full width.
 *
 * Document order is header, the disclosure control, the panel, the canvas bar,
 * the builder. A disclosure's content follows its control, and a dozen form
 * fields ahead of the canvas cost a keyboard user far less than the canvas's
 * own controls ahead of the fields would. The panel is hidden with the
 * `hidden` attribute rather than unmounted, so the fields keep their state and
 * a picker does not re-read its options on every toggle.
 *
 * It lives in this package, and reads `core`'s copy, for the reason the rest of
 * the chrome does (D-192): it names no module, every builder composes it, and
 * a module that had to depend on `cms` in order to lay out an e-mail editor is
 * the inversion that ruling refused.
 */
export function PageBuilderEditorLayout({
  header,
  canvasBar,
  builder,
  builderLabel,
  settings,
  settingsPanel,
}: PageBuilderEditorLayoutProps): ReactNode {
  const t = useTranslation('core');
  const baseId = useId();
  const panelId = `${baseId}-settings`;
  const panelHeadingId = `${baseId}-settings-heading`;
  const builderHeadingId = `${baseId}-builder-heading`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const revealCount = settingsPanel?.revealCount ?? 0;

  // A panel opened on the operator's behalf is opened because a save was
  // refused, and the refusal is announced in the header above it. So what is
  // brought into view is the top of the editor — the message, then the fields
  // it is about — and not the panel alone: above the canvas the panel can be
  // two screens tall, and scrolling to it pushed the message that explains why
  // it opened off the top. `scroll-mt-24` keeps the header clear of the
  // admin's sticky top bar; at the top of the page the call is a no-op.
  useEffect(() => {
    if (revealCount === 0) return;
    rootRef.current?.scrollIntoView({ block: 'start' });
  }, [revealCount]);

  const settingsHeading = (
    <h2 id={panelHeadingId} className="sr-only">
      {t('pageBuilder.editorLayout.settings')}
    </h2>
  );

  if (builder === null) {
    return (
      <div className="b2b-page space-y-4">
        {header}
        {canvasBar}
        <section aria-labelledby={panelHeadingId}>
          {settingsHeading}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{settings}</div>
        </section>
      </div>
    );
  }

  const hasPanel = settings !== undefined && settingsPanel !== undefined;
  const open = hasPanel && settingsPanel.open;
  const ToggleIcon = open ? PanelRightClose : PanelRightOpen;

  return (
    <div ref={rootRef} className="b2b-page b2b-page--wide scroll-mt-24 space-y-4">
      {header}
      <div
        data-settings-open={hasPanel ? (open ? 'true' : 'false') : undefined}
        className={cn(
          'grid items-start gap-4',
          open
            ? 'grid-cols-1 min-[1800px]:grid-cols-[minmax(0,1fr)_auto_20rem] min-[1800px]:grid-rows-[auto_1fr]'
            : 'grid-cols-[minmax(0,1fr)_auto]',
        )}
      >
        {hasPanel ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={settingsPanel.toggle}
              className={cn(
                'justify-self-end',
                open ? 'min-[1800px]:col-start-2 min-[1800px]:row-start-1' : 'col-start-2 row-start-1',
              )}
            >
              <ToggleIcon aria-hidden="true" />
              {open
                ? t('pageBuilder.editorLayout.hideSettings')
                : t('pageBuilder.editorLayout.showSettings')}
            </Button>
            <aside
              id={panelId}
              aria-labelledby={panelHeadingId}
              hidden={!open}
              className="min-w-0 min-[1800px]:col-start-3 min-[1800px]:row-span-2 min-[1800px]:row-start-1"
            >
              {settingsHeading}
              {/* `grid-cols-1` is `minmax(0, 1fr)`: without it the implicit
                  column is as wide as its widest card's min-content, and a
                  picker with long unbreakable rows pushes every card past the
                  20rem column and off the viewport.

                  Above the canvas the cards flow in two balanced columns
                  rather than a two-column grid: a grid row is as tall as its
                  taller card, so a short card beside a long one leaves a hole
                  the height of the difference, and seven cards of uneven
                  height push the canvas a screen further down than they need
                  to. */}
              <div className="grid grid-cols-1 items-start gap-4 lg:max-[1799px]:block lg:max-[1799px]:columns-2 lg:max-[1799px]:[&>*]:mb-4 lg:max-[1799px]:[&>*]:break-inside-avoid">
                {settings}
              </div>
            </aside>
          </>
        ) : null}
        <div
          className={cn(
            'min-w-0 self-center',
            !hasPanel
              ? 'col-span-2'
              : open
                ? 'min-[1800px]:col-start-1 min-[1800px]:row-start-1'
                : 'col-start-1 row-start-1',
          )}
        >
          {canvasBar}
        </div>
        <section
          aria-labelledby={builderHeadingId}
          className={cn(
            'cms-content-editor__builder',
            open ? 'min-[1800px]:col-span-2 min-[1800px]:col-start-1 min-[1800px]:row-start-2' : 'col-span-2',
          )}
        >
          <h2 id={builderHeadingId} className="sr-only">
            {builderLabel ?? t('pageBuilder.editorLayout.builder')}
          </h2>
          {builder}
        </section>
      </div>
    </div>
  );
}

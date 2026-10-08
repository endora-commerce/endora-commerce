import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Where the operator's last choice about the settings panel is kept. One slot
 * for the three editors: it is a preference about the editing surface, not
 * about pages as opposed to blocks.
 */
export const CMS_EDITOR_SETTINGS_STORAGE_KEY = 'b2b-admin.cms-editor.settings-panel';

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function writePreference(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* storage full, disabled or absent — the in-memory value still holds */
  }
}

export interface CmsEditorSettingsPanel {
  /** Whether the metadata and scope cards are showing. */
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
 * Open by default, and the operator's choice is remembered. A new entity opens
 * it regardless: nothing can be saved without a name and a scope, and the
 * canvas has no language to edit until the scope names one, so hiding those
 * fields first would only make the operator go and find them.
 */
export function useCmsEditorSettingsPanel(isNew: boolean): CmsEditorSettingsPanel {
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

/**
 * CMS page/block/template editor shell.
 *
 * The Page Builder is the main column: it is what an editor spends the session
 * in. The metadata and scope cards are a secondary panel — a column to its
 * right where the viewport has room for one, a block above it where it does
 * not — and the panel can be put away to give the canvas the full width.
 *
 * Document order is header, the disclosure control, the panel, the language
 * tabs, the builder. A disclosure's content follows its control, and a dozen
 * form fields ahead of the canvas cost a keyboard user far less than the
 * canvas's own controls ahead of the fields would. The panel is hidden with
 * the `hidden` attribute rather than unmounted, so the fields keep their state
 * and the scope picker does not re-read its channels on every toggle.
 */
export function CmsContentEditorLayout({
  header,
  settings,
  languageTabs,
  builder,
  settingsPanel,
}: {
  header: ReactNode;
  settings: ReactNode;
  languageTabs: ReactNode;
  builder: ReactNode;
  settingsPanel: CmsEditorSettingsPanel;
}): ReactNode {
  const t = useTranslation('cms');
  const baseId = useId();
  const panelId = `${baseId}-settings`;
  const panelHeadingId = `${baseId}-settings-heading`;
  const builderHeadingId = `${baseId}-builder-heading`;
  const panelRef = useRef<HTMLElement | null>(null);
  const { open, toggle, revealCount } = settingsPanel;

  // Below the two-column breakpoint the panel sits above a canvas a viewport
  // tall, so a panel opened on the operator's behalf may be off-screen.
  useEffect(() => {
    if (revealCount === 0) return;
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [revealCount]);

  const ToggleIcon = open ? PanelRightClose : PanelRightOpen;

  return (
    <div className="b2b-page b2b-page--wide cms-content-editor space-y-4">
      {header}
      <div
        data-settings-open={open ? 'true' : 'false'}
        className={cn(
          'grid items-start gap-4',
          open
            ? 'grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_auto_20rem] 2xl:grid-rows-[auto_1fr]'
            : 'grid-cols-[minmax(0,1fr)_auto]',
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cn(
            'justify-self-end',
            open ? '2xl:col-start-2 2xl:row-start-1' : 'col-start-2 row-start-1',
          )}
        >
          <ToggleIcon aria-hidden="true" />
          {open ? t('editorLayout.hideSettings') : t('editorLayout.showSettings')}
        </Button>
        <aside
          ref={panelRef}
          id={panelId}
          aria-labelledby={panelHeadingId}
          hidden={!open}
          className="min-w-0 2xl:col-start-3 2xl:row-span-2 2xl:row-start-1"
        >
          <h2 id={panelHeadingId} className="sr-only">
            {t('editorLayout.settings')}
          </h2>
          <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-1">{settings}</div>
        </aside>
        <div
          className={cn(
            'min-w-0 self-center',
            open ? '2xl:col-start-1 2xl:row-start-1' : 'col-start-1 row-start-1',
          )}
        >
          {languageTabs}
        </div>
        <section
          aria-labelledby={builderHeadingId}
          className={cn(
            'cms-content-editor__builder',
            open ? '2xl:col-span-2 2xl:col-start-1 2xl:row-start-2' : 'col-span-2',
          )}
        >
          <h2 id={builderHeadingId} className="sr-only">
            {t('editorLayout.builder')}
          </h2>
          {builder}
        </section>
      </div>
    </div>
  );
}

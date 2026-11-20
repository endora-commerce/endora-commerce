'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { Data } from '@puckeditor/core';
import { Copy, Eraser, FileInput, Loader2, Maximize2, Minimize2, Save } from 'lucide-react';
import { slugify } from '@endora-commerce/contracts';
import { Button, InlineStatus, Input, Label, Select, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import {
  ModalDialog,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
} from '@endora-commerce/admin-kit/components';
import { isEmptyPageBuilderData } from './page-builder-data.js';

export type ApplyTemplateOption = { id: string; label: string };

/**
 * The template `code` prefill's length cut, and this caller's own.
 *
 * It used to reach `cms`' `codeFromTemplateName`, a one-line wrapper over
 * `slugify(input, { maxLength: 180 })` from `@endora-commerce/contracts`.
 * `admin-component-contribution.md` Z1.2 deletes the wrapper rather than
 * publishing it: this package cannot name `@/modules/cms`, and a wrapper whose
 * whole body is one call to a shared helper is a second name for that helper.
 * The fold is the helper's — issue #245's repair, which is why the call must
 * stay `slugify` and never grow a `.replace()` chain here
 * (`check:diacritic-folds`). 180 is `cmsCodeRe`'s limit and is passed
 * explicitly, because it is the API's constraint and not `slugify`'s.
 */
const TEMPLATE_CODE_MAX_LENGTH = 180;

/**
 * The translator a caller hands this file's component.
 *
 * **It reads `core`, and that is a contract rather than a convention** (feature
 * 091 P5a, `admin-kit-surface.md` R-1). This is the shared page-builder chrome:
 * `cms`, `document_templates` and the e-mail builder all render it, its copy
 * names `cms` nowhere, and the `t` prop makes the namespace the caller's
 * decision rather than this file's. A key the namespace does not carry renders
 * `<scope>.<key>` into the operator's screen instead of failing, so the keys
 * below live in `_i18n`'s bundle, which the admin serves under the synthetic
 * `core` scope, and every caller passes `useTranslation('core')`.
 * `admin/test/page-builder-admin/chrome-core-namespace.test.tsx` asserts both
 * halves against the shipped bundles, in both shipped languages.
 */
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Issue #1493 (UX audit CONTENT-03) — every dialog below is the kit's
 * `ModalDialog` on the `overlay` layer: it opens above the fullscreen builder
 * and Puck's floating action bar, traps focus, closes on Escape and returns
 * focus to the control that opened it. A failure is shown inside the dialog, in
 * a `role="alert"` region mounted before it has text; a success is shown next
 * to the buttons in an always-mounted `InlineStatus`, where the operator is
 * looking, rather than only to a screen reader.
 */

/** The busy state of a dialog's confirm button: a spinner beside its label. */
function BusyIcon({ busy }: { busy: boolean }): ReactElement | null {
  return busy ? <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 motion-safe:animate-spin" /> : null;
}

/**
 * One entry of the canvas "More" menu. An entry that cannot run says why **in
 * the entry**, under its label, rather than in a `title` only a mouse reaches:
 * the reason is part of the item's text, so a screen reader reads it too.
 */
function MenuEntry({
  icon,
  label,
  reason = null,
}: {
  /** A `lucide-react` icon element, `aria-hidden`. */
  icon: ReactElement;
  label: string;
  reason?: string | null;
}): ReactElement {
  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null}
      </span>
    </>
  );
}

type CanvasDialog = 'save' | 'apply' | 'copy' | 'clear';

export interface PageBuilderHeaderActionsProps {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  languages?: string[];
  activeLanguage?: string | null;
  currentData: Data | null;
  onCopyFromLanguage?: (sourceLanguage: string) => void | Promise<void>;
  onClearCanvas?: () => void;
  onSaveAsTemplate?: (meta: { name: string; code: string }, data: Data) => void | Promise<void>;
  /** Offered together with `onApplyTemplate`; either alone offers no "Apply template". */
  onListTemplatesForApply?: () => Promise<ApplyTemplateOption[]>;
  onApplyTemplate?: (templateId: string) => void | Promise<void>;
  /**
   * Module-owned actions drawn as visible `outline` buttons, first in the
   * toolbar (feature 151 — `cms`' Translate; the e-mail builder's Preview). The
   * chrome owns no copy, permission or endpoint for them; it only gives them a
   * place. Keep it to one or two: everything else belongs in the menu.
   */
  extraActions?: ReactNode;
  t: Translate;
}

/**
 * The Page Builder's **one** canvas toolbar — issue #1494 (UX audit CONTENT-11).
 *
 * It used to be two clusters in Puck's header: the template actions portalled
 * into the left column beside Puck's panel toggles, and on the right
 * Translate, Copy from language, a solid red Clear canvas and Fullscreen —
 * about eleven controls before the content, the destructive one the loudest.
 * It is now one group in Puck's right-hand slot:
 *
 * - the module's own one or two actions (`extraActions`), `outline`;
 * - a labelled **More** menu holding the long tail — Save as template, Apply
 *   template, Copy from language and, last and apart behind a separator, Clear
 *   canvas as a quiet destructive entry that still asks first (Hick: the long
 *   tail costs one press rather than a decision at every glance; Von Restorff:
 *   nothing red competes with the editor's Save; Fitts: the destructive entry
 *   is kept away from the frequent ones);
 * - **Fullscreen**, last, where a view toggle is expected (Jakob).
 *
 * The page's primary action — Save — stays in the admin page header, the only
 * filled button on the screen. The menu is the kit's `RowActionMenu`: it
 * portals out of Puck's header, takes arrow keys, typeahead and Escape, and
 * runs a chosen entry only once focus is back on "More", so each dialog below
 * keeps its focus and returns it there when it closes (WCAG 2.4.3).
 *
 * The result of the last action ("Template applied.") is said in one
 * always-mounted `InlineStatus` at the start of the group (WCAG 4.1.3).
 */
export function PageBuilderHeaderActions({
  fullscreen,
  onToggleFullscreen,
  languages = [],
  activeLanguage = null,
  currentData,
  onCopyFromLanguage,
  onClearCanvas,
  onSaveAsTemplate,
  onListTemplatesForApply,
  onApplyTemplate,
  extraActions,
  t,
}: PageBuilderHeaderActionsProps): ReactElement {
  const ids = useId();
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<CanvasDialog | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [applyOptions, setApplyOptions] = useState<ApplyTemplateOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();

  const canvasEmpty = isEmptyPageBuilderData(currentData);
  const otherLanguages = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage),
    [activeLanguage, languages],
  );
  const canApply = Boolean(onApplyTemplate && onListTemplatesForApply);
  const hasTemplateEntries = Boolean(onSaveAsTemplate) || canApply;
  const hasMenu = hasTemplateEntries || Boolean(onCopyFromLanguage) || Boolean(onClearCanvas);

  useEffect(() => {
    if (dialog !== 'apply' || !onListTemplatesForApply) return;
    let live = true;
    setLoadingOptions(true);
    setError(null);
    void onListTemplatesForApply()
      .then((options) => {
        if (!live) return;
        setApplyOptions(options);
        setSelectedTemplateId(options[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setApplyOptions([]);
        setSelectedTemplateId('');
      })
      .finally(() => {
        if (live) setLoadingOptions(false);
      });
    return (): void => {
      live = false;
    };
  }, [dialog, onListTemplatesForApply]);

  const openDialog = (next: CanvasDialog): void => {
    setError(null);
    status.clear();
    if (next === 'save') {
      setTemplateName('');
      setTemplateCode('');
      setCodeEdited(false);
    }
    if (next === 'copy') setSourceLanguage(otherLanguages[0] ?? '');
    setDialog(next);
  };
  const closeDialog = (): void => setDialog(null);

  const runSave = async (): Promise<void> => {
    if (!onSaveAsTemplate || !currentData) return;
    const name = templateName.trim();
    const code = templateCode.trim();
    if (!name || !code) {
      setError(t('pageBuilder.saveAsTemplate.requiredFields'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSaveAsTemplate({ name, code }, currentData);
      setDialog(null);
      setTemplateName('');
      setTemplateCode('');
      setCodeEdited(false);
      status.show(t('pageBuilder.saveAsTemplate.success'));
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw === 'EMPTY_CANVAS') {
        setError(t('pageBuilder.saveAsTemplate.emptyCanvas'));
      } else if (raw === 'MISSING_SCOPE') {
        setError(t('pageBuilder.saveAsTemplate.missingScope'));
      } else {
        setError(raw);
      }
    } finally {
      setBusy(false);
    }
  };

  const runApply = async (): Promise<void> => {
    if (!onApplyTemplate || !selectedTemplateId) return;
    setBusy(true);
    setError(null);
    try {
      await onApplyTemplate(selectedTemplateId);
      setDialog(null);
      setSelectedTemplateId('');
      status.show(t('pageBuilder.applyTemplate.success'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runCopy = async (): Promise<void> => {
    if (!onCopyFromLanguage || !sourceLanguage) return;
    setBusy(true);
    setError(null);
    try {
      await onCopyFromLanguage(sourceLanguage);
      setDialog(null);
      setSourceLanguage('');
      status.show(t('pageBuilder.copyLanguage.success', { language: sourceLanguage }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const descriptionId = `${ids}-description`;
  const warningId = `${ids}-warning`;
  const errorId = `${ids}-error`;
  const hasError = error !== null && error !== '';
  const describedBy = (...extra: Array<string | null>): string =>
    [descriptionId, ...extra, hasError ? errorId : null].filter(Boolean).join(' ');
  const errorRegion = (
    <p id={errorId} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
  const cancelButton = (label: string): ReactElement => (
    <Button type="button" variant="outline" disabled={busy} onClick={closeDialog}>
      {label}
    </Button>
  );
  const fullscreenLabel = fullscreen ? t('pageBuilder.fullscreen.exit') : t('pageBuilder.fullscreen.enter');

  return (
    <>
      <div className="cms-pb-header-actions">
        <InlineStatus {...status.props} className="whitespace-nowrap" />
        {extraActions ?? null}
        {hasMenu ? (
          <RowActionMenu label={t('common.action.more')} showLabel>
            {onSaveAsTemplate ? (
              <RowActionMenuItem disabled={canvasEmpty} onSelect={(): void => openDialog('save')}>
                <MenuEntry
                  icon={<Save aria-hidden="true" />}
                  label={t('pageBuilder.saveAsTemplate.button')}
                  reason={canvasEmpty ? t('pageBuilder.saveAsTemplate.emptyCanvas') : null}
                />
              </RowActionMenuItem>
            ) : null}
            {canApply ? (
              <RowActionMenuItem onSelect={(): void => openDialog('apply')}>
                <MenuEntry icon={<FileInput aria-hidden="true" />} label={t('pageBuilder.applyTemplate.button')} />
              </RowActionMenuItem>
            ) : null}
            {onCopyFromLanguage && hasTemplateEntries ? <RowActionMenuSeparator /> : null}
            {onCopyFromLanguage ? (
              <RowActionMenuItem disabled={otherLanguages.length === 0} onSelect={(): void => openDialog('copy')}>
                <MenuEntry
                  icon={<Copy aria-hidden="true" />}
                  label={t('pageBuilder.copyLanguage.button')}
                  reason={otherLanguages.length === 0 ? t('pageBuilder.copyLanguage.noTargets') : null}
                />
              </RowActionMenuItem>
            ) : null}
            {onClearCanvas && (hasTemplateEntries || onCopyFromLanguage) ? <RowActionMenuSeparator /> : null}
            {onClearCanvas ? (
              <RowActionMenuItem destructive disabled={canvasEmpty} onSelect={(): void => openDialog('clear')}>
                <MenuEntry
                  icon={<Eraser aria-hidden="true" />}
                  label={t('pageBuilder.clearCanvas.button')}
                  reason={canvasEmpty ? t('pageBuilder.clearCanvas.alreadyEmpty') : null}
                />
              </RowActionMenuItem>
            ) : null}
          </RowActionMenu>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          <span className="cms-pb-header-actions__label">{fullscreenLabel}</span>
        </Button>
      </div>

      {dialog === 'save' ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.saveAsTemplate.title')}
          onClose={closeDialog}
          busy={busy}
          // A stray click on the scrim must not drop a typed name.
          dismissOnScrim={false}
          widthClassName="max-w-md"
          aria-describedby={describedBy()}
          footer={
            <>
              {cancelButton(t('pageBuilder.saveAsTemplate.cancel'))}
              <Button
                type="button"
                disabled={busy || !templateName.trim() || !templateCode.trim()}
                aria-busy={busy}
                onClick={(): void => void runSave()}
              >
                <BusyIcon busy={busy} />
                {busy ? t('common.state.saving') : t('pageBuilder.saveAsTemplate.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {t('pageBuilder.saveAsTemplate.description')}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`${ids}-name`}>{t('common.field.name')}</Label>
              <Input
                id={`${ids}-name`}
                value={templateName}
                disabled={busy}
                onChange={(e): void => {
                  const name = e.target.value;
                  setTemplateName(name);
                  if (!codeEdited) setTemplateCode(slugify(name, { maxLength: TEMPLATE_CODE_MAX_LENGTH }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${ids}-code`}>{t('common.field.code')}</Label>
              <Input
                id={`${ids}-code`}
                className="font-mono"
                value={templateCode}
                disabled={busy}
                onChange={(e): void => {
                  setCodeEdited(true);
                  setTemplateCode(e.target.value.toLowerCase());
                }}
              />
            </div>
            {errorRegion}
          </div>
        </ModalDialog>
      ) : null}

      {dialog === 'apply' ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.applyTemplate.title')}
          onClose={closeDialog}
          busy={busy}
          widthClassName="max-w-md"
          aria-describedby={describedBy(canvasEmpty ? null : warningId)}
          footer={
            <>
              {cancelButton(t('pageBuilder.applyTemplate.cancel'))}
              <Button
                type="button"
                disabled={busy || loadingOptions || !selectedTemplateId}
                aria-busy={busy}
                onClick={(): void => void runApply()}
              >
                <BusyIcon busy={busy} />
                {busy ? t('common.state.saving') : t('pageBuilder.applyTemplate.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1">
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {t('pageBuilder.applyTemplate.description')}
              </p>
              {canvasEmpty ? null : (
                <p id={warningId} className="text-sm text-amber-700 dark:text-amber-400">
                  {t('pageBuilder.applyTemplate.replaceWarning')}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${ids}-template`}>{t('pageBuilder.applyTemplate.selectLabel')}</Label>
              <Select
                id={`${ids}-template`}
                value={selectedTemplateId}
                onChange={(e): void => setSelectedTemplateId(e.target.value)}
                disabled={busy || loadingOptions || applyOptions.length === 0}
                aria-busy={loadingOptions}
              >
                {loadingOptions ? (
                  <option value="">{t('common.state.loading')}</option>
                ) : applyOptions.length === 0 ? (
                  <option value="">{t('pageBuilder.applyTemplate.empty')}</option>
                ) : (
                  applyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))
                )}
              </Select>
            </div>
            {errorRegion}
          </div>
        </ModalDialog>
      ) : null}

      {dialog === 'copy' ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.copyLanguage.title')}
          onClose={closeDialog}
          busy={busy}
          widthClassName="max-w-md"
          aria-describedby={describedBy()}
          footer={
            <>
              {cancelButton(t('pageBuilder.copyLanguage.cancel'))}
              <Button
                type="button"
                disabled={busy || !sourceLanguage}
                aria-busy={busy}
                onClick={(): void => void runCopy()}
              >
                <BusyIcon busy={busy} />
                {busy ? t('common.state.saving') : t('pageBuilder.copyLanguage.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {t('pageBuilder.copyLanguage.description', { target: activeLanguage ?? '—' })}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`${ids}-source`}>{t('pageBuilder.copyLanguage.sourceLabel')}</Label>
              <Select
                id={`${ids}-source`}
                value={sourceLanguage}
                onChange={(e): void => setSourceLanguage(e.target.value)}
                disabled={busy}
              >
                {otherLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </Select>
            </div>
            {errorRegion}
          </div>
        </ModalDialog>
      ) : null}

      {dialog === 'clear' ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.clearCanvas.title')}
          onClose={closeDialog}
          // Destructive: focus starts on Cancel, so Enter on a dialog opened by accident keeps the canvas.
          initialFocusRef={clearCancelRef}
          widthClassName="max-w-md"
          aria-describedby={descriptionId}
          footer={
            <>
              <Button ref={clearCancelRef} type="button" variant="outline" onClick={closeDialog}>
                {t('pageBuilder.clearCanvas.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(): void => {
                  onClearCanvas?.();
                  setDialog(null);
                }}
              >
                {t('pageBuilder.clearCanvas.confirm')}
              </Button>
            </>
          }
        >
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {t('pageBuilder.clearCanvas.description')}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Data } from '@puckeditor/core';
import { Copy, Eraser, FileInput, Loader2, Maximize2, Minimize2, Save } from 'lucide-react';
import { slugify } from '@endora-commerce/contracts';
import { Button, InlineStatus, Input, Label, Select, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
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
 * The translator a caller hands this file's components.
 *
 * **It reads `core`, and that is a contract rather than a convention** (feature
 * 091 P5a, `admin-kit-surface.md` R-1). This is the shared page-builder chrome:
 * `cms`, `invoices` and the e-mail builder all render it, its copy names
 * `cms` nowhere, and the `t` prop makes the namespace the caller's decision
 * rather than this file's. Two of the three callers were supplying
 * `useTranslation('cms')` — module knowledge in a component that owns none, and
 * a defect nothing catches at compile time, because a key the namespace does not
 * carry renders `<scope>.<key>` into the operator's screen instead of failing.
 * So the keys below live in `_i18n`'s bundle, which the admin serves under the
 * synthetic `core` scope, and every caller passes `useTranslation('core')`.
 * `admin/test/page-builder-admin/chrome-core-namespace.test.tsx` asserts both
 * halves against the shipped bundles, in both shipped languages.
 */
type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Injects `leading` into Puck's left header column (after sidebar toggles). */
export function PageBuilderHeaderShell({
  children,
  leading,
}: {
  children: ReactNode;
  leading: ReactNode;
}): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = wrapRef.current;
    if (!root) {
      setMountNode(null);
      return;
    }

    // Prefer the left toggle column so the center title stays visually centered.
    const leftColumn =
      root.querySelector<HTMLElement>('[class*="PuckHeader-toggle"]') ??
      root.querySelector<HTMLElement>('[class*="PuckHeader-inner"]');
    if (!leftColumn) {
      setMountNode(null);
      return;
    }

    leftColumn.classList.add('cms-pb-header-left');
    let mount = leftColumn.querySelector<HTMLElement>(':scope > [data-cms-pb-leading]');
    if (!mount) {
      // Remove a stale mount left in the title from earlier iterations.
      root.querySelectorAll('[data-cms-pb-leading]').forEach((node) => {
        if (node.parentElement !== leftColumn) node.remove();
      });
      root.querySelectorAll('.cms-pb-header-title').forEach((node) => {
        node.classList.remove('cms-pb-header-title');
      });

      mount = document.createElement('span');
      mount.setAttribute('data-cms-pb-leading', '');
      mount.className = 'cms-pb-header-leading';
      leftColumn.appendChild(mount);
    }
    setMountNode(mount);
  }, [children]);

  return (
    <div ref={wrapRef} className="cms-pb-header-shell">
      {children}
      {mountNode && leading ? createPortal(leading, mountNode) : null}
    </div>
  );
}

/**
 * Issue #1493 (UX audit CONTENT-03) — every dialog below is the kit's
 * `ModalDialog` on the `overlay` layer: it opens above the fullscreen builder
 * and Puck's floating action bar, traps focus, closes on Escape and returns
 * focus to the button that opened it. A failure is shown inside the dialog, in
 * a `role="alert"` region mounted before it has text; a success is shown next
 * to the buttons in an always-mounted `InlineStatus`, where the operator is
 * looking, rather than only to a screen reader.
 */

/** The busy state of a dialog's confirm button: a spinner beside its label. */
function BusyIcon({ busy }: { busy: boolean }): ReactElement | null {
  return busy ? <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 motion-safe:animate-spin" /> : null;
}

/** Save as template / Apply template — meant for the left of the page title. */
export function PageBuilderTemplateActions({
  currentData,
  onSaveAsTemplate,
  onListTemplatesForApply,
  onApplyTemplate,
  t,
}: {
  currentData: Data | null;
  onSaveAsTemplate?: (meta: { name: string; code: string }, data: Data) => void | Promise<void>;
  onListTemplatesForApply?: () => Promise<ApplyTemplateOption[]>;
  onApplyTemplate?: (templateId: string) => void | Promise<void>;
  t: Translate;
}): ReactElement | null {
  const ids = useId();
  const [saveOpen, setSaveOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [applyOptions, setApplyOptions] = useState<ApplyTemplateOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();

  const canSave = Boolean(onSaveAsTemplate) && !isEmptyPageBuilderData(currentData);
  const canApply = Boolean(onApplyTemplate && onListTemplatesForApply);
  const canvasHasContent = !isEmptyPageBuilderData(currentData);

  useEffect(() => {
    if (!applyOpen || !onListTemplatesForApply) return;
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
  }, [applyOpen, onListTemplatesForApply]);

  if (!onSaveAsTemplate && !canApply) return null;

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
      setSaveOpen(false);
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
      setApplyOpen(false);
      setSelectedTemplateId('');
      status.show(t('pageBuilder.applyTemplate.success'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveDescriptionId = `${ids}-save-description`;
  const applyDescriptionId = `${ids}-apply-description`;
  const applyWarningId = `${ids}-apply-warning`;
  const errorId = `${ids}-error`;
  const hasError = error !== null && error !== '';
  const errorRegion = (
    <p id={errorId} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  return (
    <>
      <div className="cms-pb-header-actions">
        {onSaveAsTemplate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSave}
            title={
              isEmptyPageBuilderData(currentData)
                ? t('pageBuilder.saveAsTemplate.emptyCanvas')
                : t('pageBuilder.saveAsTemplate.button')
            }
            onClick={(): void => {
              setError(null);
              status.clear();
              setTemplateName('');
              setTemplateCode('');
              setCodeEdited(false);
              setSaveOpen(true);
            }}
          >
            <Save className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('pageBuilder.saveAsTemplate.button')}
          </Button>
        ) : null}
        {canApply ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(): void => {
              setError(null);
              status.clear();
              setApplyOpen(true);
            }}
          >
            <FileInput className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('pageBuilder.applyTemplate.button')}
          </Button>
        ) : null}
      </div>

      <InlineStatus {...status.props} className="whitespace-nowrap" />

      {saveOpen ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.saveAsTemplate.title')}
          onClose={(): void => setSaveOpen(false)}
          busy={busy}
          // A stray click on the scrim must not drop a typed name.
          dismissOnScrim={false}
          widthClassName="max-w-md"
          aria-describedby={hasError ? `${saveDescriptionId} ${errorId}` : saveDescriptionId}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setSaveOpen(false)}>
                {t('pageBuilder.saveAsTemplate.cancel')}
              </Button>
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
            <p id={saveDescriptionId} className="text-sm text-muted-foreground">
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

      {applyOpen ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.applyTemplate.title')}
          onClose={(): void => setApplyOpen(false)}
          busy={busy}
          widthClassName="max-w-md"
          aria-describedby={[applyDescriptionId, canvasHasContent ? applyWarningId : null, hasError ? errorId : null]
            .filter(Boolean)
            .join(' ')}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setApplyOpen(false)}>
                {t('pageBuilder.applyTemplate.cancel')}
              </Button>
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
              <p id={applyDescriptionId} className="text-sm text-muted-foreground">
                {t('pageBuilder.applyTemplate.description')}
              </p>
              {canvasHasContent ? (
                <p id={applyWarningId} className="text-sm text-amber-700 dark:text-amber-400">
                  {t('pageBuilder.applyTemplate.replaceWarning')}
                </p>
              ) : null}
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
    </>
  );
}

/** Right-side header tools: copy language, clear canvas, fullscreen. */
export function PageBuilderHeaderActions({
  fullscreen,
  onToggleFullscreen,
  languages = [],
  activeLanguage = null,
  currentData,
  onCopyFromLanguage,
  onClearCanvas,
  extraActions,
  t,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  languages?: string[];
  activeLanguage?: string | null;
  currentData: Data | null;
  onCopyFromLanguage?: (sourceLanguage: string) => void | Promise<void>;
  onClearCanvas?: () => void;
  /**
   * Module-owned actions rendered first in the right-hand header group (feature
   * 151 — `cms`' Translate). The chrome owns no copy, permission or endpoint for
   * them; it only gives them a place.
   */
  extraActions?: ReactNode;
  t: Translate;
}): ReactElement {
  const ids = useId();
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();

  const otherLanguages = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage),
    [activeLanguage, languages],
  );
  const canCopy = Boolean(onCopyFromLanguage) && otherLanguages.length > 0;
  const canClear = Boolean(onClearCanvas) && !isEmptyPageBuilderData(currentData);

  const runCopy = async (): Promise<void> => {
    if (!onCopyFromLanguage || !sourceLanguage) return;
    setBusy(true);
    setError(null);
    try {
      await onCopyFromLanguage(sourceLanguage);
      setCopyOpen(false);
      setSourceLanguage('');
      status.show(t('pageBuilder.copyLanguage.success', { language: sourceLanguage }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyDescriptionId = `${ids}-copy-description`;
  const copyErrorId = `${ids}-copy-error`;
  const clearDescriptionId = `${ids}-clear-description`;
  const hasError = error !== null && error !== '';

  return (
    <>
      <div className="cms-pb-header-actions">
        {extraActions ?? null}
        {onCopyFromLanguage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canCopy}
            title={
              otherLanguages.length === 0
                ? t('pageBuilder.copyLanguage.noTargets')
                : t('pageBuilder.copyLanguage.button')
            }
            aria-label={t('pageBuilder.copyLanguage.button')}
            onClick={(): void => {
              setError(null);
              status.clear();
              setSourceLanguage(otherLanguages[0] ?? '');
              setCopyOpen(true);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            <span className="cms-pb-header-actions__label">{t('pageBuilder.copyLanguage.button')}</span>
          </Button>
        ) : null}
        {onClearCanvas ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canClear}
            title={t('pageBuilder.clearCanvas.button')}
            aria-label={t('pageBuilder.clearCanvas.button')}
            onClick={(): void => {
              status.clear();
              setClearOpen(true);
            }}
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
            <span className="cms-pb-header-actions__label">{t('pageBuilder.clearCanvas.button')}</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
          title={fullscreen ? t('pageBuilder.fullscreen.exit') : t('pageBuilder.fullscreen.enter')}
          aria-label={fullscreen ? t('pageBuilder.fullscreen.exit') : t('pageBuilder.fullscreen.enter')}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          <span className="cms-pb-header-actions__label">
            {fullscreen ? t('pageBuilder.fullscreen.exit') : t('pageBuilder.fullscreen.enter')}
          </span>
        </Button>
      </div>

      {/* Only copy-from-language reports a result; clearing shows itself on the canvas. */}
      {onCopyFromLanguage ? <InlineStatus {...status.props} className="whitespace-nowrap" /> : null}

      {copyOpen ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.copyLanguage.title')}
          onClose={(): void => setCopyOpen(false)}
          busy={busy}
          widthClassName="max-w-md"
          aria-describedby={hasError ? `${copyDescriptionId} ${copyErrorId}` : copyDescriptionId}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setCopyOpen(false)}>
                {t('pageBuilder.copyLanguage.cancel')}
              </Button>
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
            <p id={copyDescriptionId} className="text-sm text-muted-foreground">
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
            <p id={copyErrorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          </div>
        </ModalDialog>
      ) : null}

      {clearOpen ? (
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.clearCanvas.title')}
          onClose={(): void => setClearOpen(false)}
          // Destructive: focus starts on Cancel, so Enter on a dialog opened by accident keeps the canvas.
          initialFocusRef={clearCancelRef}
          widthClassName="max-w-md"
          aria-describedby={clearDescriptionId}
          footer={
            <>
              <Button ref={clearCancelRef} type="button" variant="outline" onClick={(): void => setClearOpen(false)}>
                {t('pageBuilder.clearCanvas.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(): void => {
                  onClearCanvas?.();
                  setClearOpen(false);
                }}
              >
                {t('pageBuilder.clearCanvas.confirm')}
              </Button>
            </>
          }
        >
          <p id={clearDescriptionId} className="text-sm text-muted-foreground">
            {t('pageBuilder.clearCanvas.description')}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

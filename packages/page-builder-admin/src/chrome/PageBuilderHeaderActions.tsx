'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Data } from '@measured/puck';
import { Copy, Eraser, FileInput, Maximize2, Minimize2, Save } from 'lucide-react';
import { slugify } from '@endora-commerce/contracts';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [applyOptions, setApplyOptions] = useState<ApplyTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canSave = Boolean(onSaveAsTemplate) && !isEmptyPageBuilderData(currentData);
  const canApply = Boolean(onApplyTemplate && onListTemplatesForApply);
  const canvasHasContent = !isEmptyPageBuilderData(currentData);

  useEffect(() => {
    if (!applyOpen || !onListTemplatesForApply) return;
    let live = true;
    setBusy(true);
    setMessage(null);
    void onListTemplatesForApply()
      .then((options) => {
        if (!live) return;
        setApplyOptions(options);
        setSelectedTemplateId(options[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!live) return;
        setMessage(err instanceof Error ? err.message : String(err));
        setApplyOptions([]);
        setSelectedTemplateId('');
      })
      .finally(() => {
        if (live) setBusy(false);
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
      setMessage(t('pageBuilder.saveAsTemplate.requiredFields'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onSaveAsTemplate({ name, code }, currentData);
      setSaveOpen(false);
      setTemplateName('');
      setTemplateCode('');
      setCodeEdited(false);
      setMessage(t('pageBuilder.saveAsTemplate.success'));
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw === 'EMPTY_CANVAS') {
        setMessage(t('pageBuilder.saveAsTemplate.emptyCanvas'));
      } else if (raw === 'MISSING_SCOPE') {
        setMessage(t('pageBuilder.saveAsTemplate.missingScope'));
      } else {
        setMessage(raw);
      }
    } finally {
      setBusy(false);
    }
  };

  const runApply = async (): Promise<void> => {
    if (!onApplyTemplate || !selectedTemplateId) return;
    setBusy(true);
    setMessage(null);
    try {
      await onApplyTemplate(selectedTemplateId);
      setApplyOpen(false);
      setSelectedTemplateId('');
      setMessage(t('pageBuilder.applyTemplate.success'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
              setMessage(null);
              setTemplateName('');
              setTemplateCode('');
              setCodeEdited(false);
              setSaveOpen(true);
            }}
          >
            <Save className="mr-1 h-4 w-4" />
            {t('pageBuilder.saveAsTemplate.button')}
          </Button>
        ) : null}
        {canApply ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(): void => {
              setMessage(null);
              setApplyOpen(true);
            }}
          >
            <FileInput className="mr-1 h-4 w-4" />
            {t('pageBuilder.applyTemplate.button')}
          </Button>
        ) : null}
      </div>

      {message ? <p className="sr-only" role="status">{message}</p> : null}

      {saveOpen
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
              style={{ zIndex: 10000 }}
              role="presentation"
              onPointerDown={(e): void => {
                if (e.target === e.currentTarget && !busy) setSaveOpen(false);
              }}
            >
              <div
                className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pb-save-template-title"
                onPointerDown={(e): void => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <h2 id="pb-save-template-title" className="text-lg font-semibold">
                    {t('pageBuilder.saveAsTemplate.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('pageBuilder.saveAsTemplate.description')}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pb-save-template-name">{t('common.field.name')}</Label>
                  <Input
                    id="pb-save-template-name"
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
                  <Label htmlFor="pb-save-template-code">{t('common.field.code')}</Label>
                  <Input
                    id="pb-save-template-code"
                    className="font-mono"
                    value={templateCode}
                    disabled={busy}
                    onChange={(e): void => {
                      setCodeEdited(true);
                      setTemplateCode(e.target.value.toLowerCase());
                    }}
                  />
                </div>
                {message ? <p className="text-sm text-destructive">{message}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={(): void => setSaveOpen(false)}
                  >
                    {t('pageBuilder.saveAsTemplate.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !templateName.trim() || !templateCode.trim()}
                    onClick={(): void => void runSave()}
                  >
                    {busy ? t('common.state.saving') : t('pageBuilder.saveAsTemplate.confirm')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {applyOpen
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
              style={{ zIndex: 10000 }}
              role="presentation"
              onPointerDown={(e): void => {
                if (e.target === e.currentTarget && !busy) setApplyOpen(false);
              }}
            >
              <div
                className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pb-apply-template-title"
                onPointerDown={(e): void => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <h2 id="pb-apply-template-title" className="text-lg font-semibold">
                    {t('pageBuilder.applyTemplate.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('pageBuilder.applyTemplate.description')}
                  </p>
                  {canvasHasContent ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      {t('pageBuilder.applyTemplate.replaceWarning')}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pb-apply-template-select">
                    {t('pageBuilder.applyTemplate.selectLabel')}
                  </Label>
                  <Select
                    id="pb-apply-template-select"
                    value={selectedTemplateId}
                    onChange={(e): void => setSelectedTemplateId(e.target.value)}
                    disabled={busy || applyOptions.length === 0}
                  >
                    {applyOptions.length === 0 ? (
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
                {message ? <p className="text-sm text-destructive">{message}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={(): void => setApplyOpen(false)}
                  >
                    {t('pageBuilder.applyTemplate.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !selectedTemplateId}
                    onClick={(): void => void runApply()}
                  >
                    {busy ? t('common.state.saving') : t('pageBuilder.applyTemplate.confirm')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
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
  t,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  languages?: string[];
  activeLanguage?: string | null;
  currentData: Data | null;
  onCopyFromLanguage?: (sourceLanguage: string) => void | Promise<void>;
  onClearCanvas?: () => void;
  t: Translate;
}): ReactElement {
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const otherLanguages = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage),
    [activeLanguage, languages],
  );
  const canCopy = Boolean(onCopyFromLanguage) && otherLanguages.length > 0;
  const canClear = Boolean(onClearCanvas) && !isEmptyPageBuilderData(currentData);

  const runCopy = async (): Promise<void> => {
    if (!onCopyFromLanguage || !sourceLanguage) return;
    setBusy(true);
    setMessage(null);
    try {
      await onCopyFromLanguage(sourceLanguage);
      setCopyOpen(false);
      setSourceLanguage('');
      setMessage(t('pageBuilder.copyLanguage.success', { language: sourceLanguage }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="cms-pb-header-actions">
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
              setMessage(null);
              setSourceLanguage(otherLanguages[0] ?? '');
              setCopyOpen(true);
            }}
          >
            <Copy className="h-4 w-4" />
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
              setMessage(null);
              setClearOpen(true);
            }}
          >
            <Eraser className="h-4 w-4" />
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
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="cms-pb-header-actions__label">
            {fullscreen ? t('pageBuilder.fullscreen.exit') : t('pageBuilder.fullscreen.enter')}
          </span>
        </Button>
      </div>

      {message ? <p className="sr-only" role="status">{message}</p> : null}

      {copyOpen
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
              style={{ zIndex: 10000 }}
              role="presentation"
              onPointerDown={(e): void => {
                if (e.target === e.currentTarget && !busy) setCopyOpen(false);
              }}
            >
              <div
                className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pb-copy-lang-title"
                onPointerDown={(e): void => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <h2 id="pb-copy-lang-title" className="text-lg font-semibold">
                    {t('pageBuilder.copyLanguage.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('pageBuilder.copyLanguage.description', {
                      target: activeLanguage ?? '—',
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pb-copy-lang-select">{t('pageBuilder.copyLanguage.sourceLabel')}</Label>
                  <Select
                    id="pb-copy-lang-select"
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
                {message && copyOpen ? (
                  <p className="text-sm text-destructive">{message}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={(): void => setCopyOpen(false)}
                  >
                    {t('pageBuilder.copyLanguage.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !sourceLanguage}
                    onClick={(): void => void runCopy()}
                  >
                    {busy ? t('common.state.saving') : t('pageBuilder.copyLanguage.confirm')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {clearOpen
        ? createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
              style={{ zIndex: 10000 }}
              role="presentation"
              onPointerDown={(e): void => {
                if (e.target === e.currentTarget) setClearOpen(false);
              }}
            >
              <div
                className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pb-clear-title"
                onPointerDown={(e): void => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <h2 id="pb-clear-title" className="text-lg font-semibold">
                    {t('pageBuilder.clearCanvas.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('pageBuilder.clearCanvas.description')}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={(): void => setClearOpen(false)}>
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
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

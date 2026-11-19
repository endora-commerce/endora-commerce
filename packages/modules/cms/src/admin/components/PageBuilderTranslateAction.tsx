import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Data } from '@puckeditor/core';
import { Languages, Loader2 } from 'lucide-react';
import type {
  BlockTranslatableText,
  CmsPageBuilderTranslateRequest,
  CmsPageBuilderTranslateResponse,
  CmsPageBuilderTranslationCapability,
  CmsPageBuilderTranslationScope,
} from '@endora-commerce/contracts';
import { Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { isEmptyPageBuilderData } from '@endora-commerce/page-builder-admin';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor/use-page-builder-puck';
import { cmsClient } from '../api/cms-client.js';

/**
 * Feature 151 — the Page Builder's **Translate** action
 * (`specs/151-page-builder-translate/contracts/admin-surfaces.md` §2–§3a).
 *
 * Rendered by `PageBuilderEditor` into the shared chrome's `extraActions` slot.
 * It decides nothing about the canvas itself: it sends the canvas (or another
 * tab's), the target language and the selection scope, and hands the server's
 * answer to `onTranslated`, which applies it as an unsaved change.
 */

/** A text selection inside the editor, and the component it lies in when known. */
export interface EditorTextSelection {
  text: string;
  componentId: string | null;
}

/**
 * The block selected in Puck. `blockType` rather than `type`: an object with
 * `type` and `props` reads as a stored node, which is not what this is.
 */
export interface SelectedComponent {
  id: string;
  blockType: string;
  props: Record<string, unknown>;
}

export type TranslationScopeState =
  | { kind: 'canvas' }
  | { kind: 'component'; componentId: string; blocked: boolean }
  | { kind: 'text'; componentId: string | null; selectedText: string };

function hasChildComponents(props: Record<string, unknown>): boolean {
  return Object.values(props).some(
    (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'object' && item !== null && 'type' in item && 'props' in item),
  );
}

/**
 * The scope the button acts on (research R22): a text selection wins, then the
 * selected block, then the whole canvas. A selected block is **blocked** when
 * the platform cannot translate anything in it — no declaration at all, or an
 * empty one on a block with no children.
 */
export function translationScopeOf(input: {
  textSelection: EditorTextSelection | null;
  selected: SelectedComponent | null;
  declarationOf: (blockType: string) => readonly BlockTranslatableText[] | undefined;
}): TranslationScopeState {
  const { textSelection, selected } = input;
  if (textSelection && textSelection.text.trim() !== '') {
    return {
      kind: 'text',
      componentId: textSelection.componentId ?? selected?.id ?? null,
      selectedText: textSelection.text,
    };
  }
  if (selected) {
    const declaration = input.declarationOf(selected.blockType);
    const blocked =
      declaration === undefined ? !hasChildComponents(selected.props) : declaration.length === 0 && !hasChildComponents(selected.props);
    return { kind: 'component', componentId: selected.id, blocked };
  }
  return { kind: 'canvas' };
}

function toRequestScope(scope: TranslationScopeState): CmsPageBuilderTranslationScope | undefined {
  if (scope.kind === 'component') return { kind: 'component', componentId: scope.componentId };
  if (scope.kind === 'text') {
    return { kind: 'text', componentId: scope.componentId, selectedText: scope.selectedText };
  }
  return undefined;
}

/**
 * The last non-collapsed text selection inside the editor — its own document
 * (the fields panel) or Puck's canvas iframe — with the component it lies in
 * when the canvas tells (`data-puck-component`). Cleared when the selection
 * collapses.
 */
export function useEditorTextSelection(): EditorTextSelection | null {
  const [selection, setSelection] = useState<EditorTextSelection | null>(null);
  useEffect(() => {
    const read = (doc: Document, inCanvas: boolean): void => {
      const current = doc.getSelection();
      const text = current && !current.isCollapsed ? current.toString() : '';
      if (text.trim() === '') {
        setSelection((previous) => (previous === null ? previous : null));
        return;
      }
      const anchor = current?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      if (!inCanvas && !element?.closest('.cms-page-builder')) return;
      const owner = element?.closest('[data-puck-component]');
      setSelection({ text, componentId: owner?.getAttribute('data-puck-component') ?? null });
    };
    const onMain = (): void => read(document, false);
    document.addEventListener('selectionchange', onMain);
    let frameDoc: Document | null = null;
    const onFrame = (): void => {
      if (frameDoc) read(frameDoc, true);
    };
    // The canvas iframe mounts after the editor and remounts with it.
    const attach = (): void => {
      const next =
        document.querySelector<HTMLIFrameElement>('iframe#preview-frame')?.contentDocument ?? null;
      if (next === frameDoc) return;
      frameDoc?.removeEventListener('selectionchange', onFrame);
      frameDoc = next;
      frameDoc?.addEventListener('selectionchange', onFrame);
    };
    attach();
    const timer = window.setInterval(attach, 1000);
    return (): void => {
      window.clearInterval(timer);
      document.removeEventListener('selectionchange', onMain);
      frameDoc?.removeEventListener('selectionchange', onFrame);
    };
  }, []);
  return selection;
}

export interface PageBuilderTranslateActionProps {
  capability: CmsPageBuilderTranslationCapability;
  activeLanguage: string;
  languages: readonly string[];
  currentData: Data;
  scope: TranslationScopeState;
  resource?: { type: string; id: string | null } | undefined;
  onResolveLanguageContent?: ((language: string) => Data | null | Promise<Data | null>) | undefined;
  /** Apply the result as an unsaved change. */
  onTranslated: (response: CmsPageBuilderTranslateResponse, targetLanguage: string) => void | Promise<void>;
  /** Told when there was nothing to translate. */
  onNothingToTranslate: () => void;
  /** Injectable for tests; defaults to the cms admin client. */
  translate?: (
    body: CmsPageBuilderTranslateRequest,
    signal: AbortSignal,
  ) => Promise<CmsPageBuilderTranslateResponse>;
}

const CURRENT = '__current__';

export function PageBuilderTranslateAction({
  capability,
  activeLanguage,
  languages,
  currentData,
  scope,
  resource,
  onResolveLanguageContent,
  onTranslated,
  onNothingToTranslate,
  translate = (body, signal) => cmsClient.translatePageBuilder(body, signal),
}: PageBuilderTranslateActionProps): ReactElement | null {
  const t = useTranslation('cms');
  const reasonId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [openScope, setOpenScope] = useState<TranslationScopeState>({ kind: 'canvas' });
  const [source, setSource] = useState(CURRENT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const otherLanguages = useMemo(
    () => languages.filter((language) => language !== activeLanguage),
    [languages, activeLanguage],
  );
  const canvasEmpty = isEmptyPageBuilderData(currentData);

  if (capability.status === 'disabled') return null;

  const label =
    scope.kind === 'text'
      ? t('pageBuilder.translate.scope.text')
      : scope.kind === 'component'
        ? t('pageBuilder.translate.scope.component')
        : t('pageBuilder.translate.scope.canvas');

  const disabledReason =
    capability.status === 'not_configured'
      ? t('pageBuilder.translate.notConfigured')
      : capability.status === 'unavailable'
        ? t('pageBuilder.translate.unavailable')
        : scope.kind === 'component' && scope.blocked
          ? t('pageBuilder.translate.selectionNotTranslatable')
          : scope.kind === 'canvas' && canvasEmpty && otherLanguages.length === 0
            ? t('pageBuilder.translate.nothing')
            : null;

  const close = (): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setOpen(false);
  };

  const run = async (): Promise<void> => {
    if (capability.status !== 'ready') return;
    setMessage(null);
    let data: Data = currentData;
    let sourceLanguage: string | null = null;
    if (openScope.kind === 'canvas' && source !== CURRENT) {
      const resolved = (await onResolveLanguageContent?.(source)) ?? null;
      if (isEmptyPageBuilderData(resolved)) {
        setMessage(t('pageBuilder.translate.nothing'));
        return;
      }
      data = structuredClone(resolved as Data);
      sourceLanguage = source;
    }
    const requestScope = toRequestScope(openScope);
    const body: CmsPageBuilderTranslateRequest = {
      targetLanguage: activeLanguage,
      sourceLanguage,
      context: 'cms',
      data: data as CmsPageBuilderTranslateRequest['data'],
      ...(resource ? { resource } : {}),
      ...(requestScope ? { scope: requestScope } : {}),
    };
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const response = await translate(body, controller.signal);
      if (controller.signal.aborted) return;
      if (response.report.translatedSegments === 0 && response.report.untranslatedSegments === 0) {
        setOpen(false);
        onNothingToTranslate();
        return;
      }
      await onTranslated(response, activeLanguage);
      setOpen(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(
        error instanceof ApiError
          ? error.envelope.error.message
          : error instanceof Error
            ? error.message
            : t('pageBuilder.translate.failed'),
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const scopeDescription =
    openScope.kind === 'text'
      ? t('pageBuilder.translate.scopeDescription.text')
      : openScope.kind === 'component'
        ? t('pageBuilder.translate.scopeDescription.component')
        : t('pageBuilder.translate.scopeDescription.canvas');

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabledReason !== null}
        aria-label={label}
        title={disabledReason ?? label}
        {...(disabledReason !== null ? { 'aria-describedby': reasonId } : {})}
        // Keep the editor's text selection: a press must not move focus or
        // collapse what the operator selected.
        onMouseDown={(event): void => event.preventDefault()}
        onClick={(): void => {
          setMessage(null);
          setSource(CURRENT);
          setOpenScope(scope);
          setOpen(true);
        }}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span className="cms-pb-header-actions__label">{label}</span>
      </Button>
      {disabledReason !== null ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}

      {open && capability.status === 'ready' ? (
        // Issue #1493 (CONTENT-03): the kit's dialog, above the fullscreen
        // builder — focus trapped, Escape closes it while nothing is running,
        // and focus returns to this button, which a press never focused (it
        // keeps the editor's text selection).
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.translate.title')}
          onClose={close}
          busy={busy}
          finalFocusRef={buttonRef}
          widthClassName="max-w-md"
          aria-describedby={descriptionId}
          footer={
            <>
              {/* Stays enabled while running: it is how a running translation is stopped. */}
              <Button type="button" variant="outline" onClick={close}>
                {t('pageBuilder.translate.cancel')}
              </Button>
              <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void run()}>
                {busy ? <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 motion-safe:animate-spin" /> : null}
                {busy ? t('pageBuilder.translate.running') : t('pageBuilder.translate.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div id={descriptionId} className="space-y-1">
              <p className="text-sm">{t('pageBuilder.translate.target', { language: activeLanguage })}</p>
              <p className="text-sm text-muted-foreground">{scopeDescription}</p>
            </div>
            {openScope.kind === 'canvas' && otherLanguages.length > 0 ? (
              <div className="space-y-1">
                <Label htmlFor={`${titleId}-source`}>{t('pageBuilder.translate.sourceLabel')}</Label>
                <Select
                  id={`${titleId}-source`}
                  value={source}
                  disabled={busy}
                  onChange={(event): void => setSource(event.target.value)}
                >
                  <option value={CURRENT}>{t('pageBuilder.translate.sourceCurrent')}</option>
                  {otherLanguages.map((language) => (
                    <option key={language} value={language}>
                      {t('pageBuilder.translate.sourceLanguage', { language })}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t('pageBuilder.translate.provider', {
                provider: capability.provider,
                model: capability.model,
              })}
            </p>
            {openScope.kind === 'canvas' && source !== CURRENT && !canvasEmpty ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">{t('pageBuilder.translate.replaceWarning')}</p>
            ) : null}
            {/* Mounted before it has text, so a failure is announced. */}
            <p className="text-sm text-destructive" role="alert">
              {message}
            </p>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

/**
 * The action as the editor renders it inside Puck: it reads the selected block
 * from Puck's store and the text selection from the documents, and derives the
 * scope. Must be rendered inside `<Puck>` (the header-actions override is).
 */
export function PuckPageBuilderTranslateAction(
  props: Omit<PageBuilderTranslateActionProps, 'scope'> & {
    declarationOf: (blockType: string) => readonly BlockTranslatableText[] | undefined;
  },
): ReactElement | null {
  const { declarationOf, ...rest } = props;
  const selectedItem = usePageBuilderPuck((state) => state.selectedItem);
  const textSelection = useEditorTextSelection();
  const selected: SelectedComponent | null =
    selectedItem && typeof selectedItem.props?.id === 'string'
      ? {
          id: selectedItem.props.id,
          blockType: String(selectedItem.type),
          props: selectedItem.props as Record<string, unknown>,
        }
      : null;
  const scope = translationScopeOf({ textSelection, selected, declarationOf });
  return <PageBuilderTranslateAction {...rest} scope={scope} />;
}

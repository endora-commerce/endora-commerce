import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ComponentConfig, Config, Data, Field } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import type {
  DocumentBuilderComponent,
  DocumentBuilderConfig,
  DocumentFieldDescriptor,
  DocumentTemplateDetail,
  DocumentTypeDetail,
} from '@endora-commerce/contracts';
import { ApiError, cn, isDraftEqual, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  InlineStatus,
  PageHeader,
  SaveButtonGroup,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog, UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useBlockContributions } from '@endora-commerce/admin-kit/zones';
import {
  PageBuilderEditorLayout,
  PageBuilderHeaderActions,
  PageBuilderLoadingSkeleton,
  PageBuilderOverlayBridge,
} from '@endora-commerce/page-builder-admin';
import { countComponentNames, createColorField } from '@endora-commerce/page-builder-core';
import {
  BlockRenderEnvironmentProvider,
  DocumentSampleProvider,
  editorConfigFromDescriptor,
  neutralBlockPreview,
  type DocumentBlockEditorConfig,
} from '@endora-commerce/page-builder-core/contributions';
import {
  PageBuilderOutline,
  Puck,
  PUCK_LEGACY_DND,
  PUCK_LEGACY_VIEWPORTS,
  withPuckLegacySideBar,
} from '@endora-commerce/page-builder-core/editor';
import {
  clearDefaultTemplate,
  getBuilderConfig,
  getDocumentType,
  getTemplate,
  listContentLanguages,
  previewDocument,
  saveTemplateContent,
  setDefaultTemplate,
} from '../api.js';
import { coreBlockCanvas } from '../blocks/core-block-editors.js';
import { DocumentCollectionsProvider } from '../blocks/items-table/index.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';
import { MergeFieldsPanel } from '../components/MergeFieldsPanel.js';
import { PdfPreviewDialog, usePdfPreview } from '../components/PdfPreviewDialog.js';

/**
 * The document-template editor (`specs/152-compare-pdf-template/contracts/admin-ui.md` §3).
 *
 * **The palette is the template's document type and nothing else** (owner Q1):
 * the builder descriptor of that type lists exactly its blocks, each described
 * by its declaring module; the canvas renderer of a block is the facility's own
 * for a core block, the owning module's `document` contribution for a type
 * block, and a neutral stand-in for anything without one — a block another
 * module contributes to invoices, or a stored block whose owner is absent,
 * whose props are kept through a save (FR-018).
 *
 * The canvas draws over the type's **served** sample, the same object the
 * server's *Preview PDF* renders (FR-016). Saving sends the loaded version, and a
 * stale version opens a blocking dialog — never a silent overwrite (FR-006).
 * Without `document_templates:write` the editor previews and saves nothing.
 *
 * Issue #1532 (UX audit CONTENT-12) — laid out in `PageBuilderEditorLayout`,
 * the shell of every other Page Builder editor (Jakob, Similarity): the canvas
 * has the page, with no card around its own border (Common Region); the
 * language and the merge fields are the row above it (`canvasBar`), because
 * they say what is on the canvas; Save is the shared `SaveButtonGroup` with
 * *Save and exit*, its result an `InlineStatus` beside it; the *Default* badge
 * is a fact about the template and sits beside its title; and *Preview PDF*
 * opens the PDF in a dialog rather than a tab a pop-up blocker could stop.
 * Like the e-mail editor, the screen has no settings panel: nothing on it
 * describes the template rather than composes it, the name and scope being set
 * in the list's dialog.
 */

const EMPTY: Data = { root: { props: {} }, content: [] };
const editorPlugins = withPuckLegacySideBar([
  {
    overrides: {
      outline: ({ children }: { children: ReactNode }) => <PageBuilderOutline>{children}</PageBuilderOutline>,
    },
  },
]);

/** A descriptor field as a Puck field: colours get the picker, the rest map one to one. */
function puckField(field: DocumentFieldDescriptor): Field {
  const label = field.label ?? '';
  switch (field.type) {
    case 'color':
      return createColorField({ label }) as Field;
    case 'select':
    case 'radio':
      return (field.options?.length ?? 0) > 0
        ? ({ type: field.type, label, options: [...(field.options ?? [])] } as Field)
        : { type: 'text', label };
    case 'number':
      return { type: 'number', label };
    case 'textarea':
    case 'richtext':
      return { type: 'textarea', label };
    default:
      return { type: 'text', label };
  }
}

/** Declared defaults under stored props, so radios and selects show their value. */
function hydrate(tree: Data, defaults: ReadonlyMap<string, Readonly<Record<string, unknown>>>): Data {
  return {
    ...tree,
    root: tree.root ?? { props: {} },
    content: (tree.content ?? []).map((node) => {
      const base = defaults.get(node.type);
      if (!base) return node;
      const merged: Record<string, unknown> = { ...base };
      for (const [key, value] of Object.entries(node.props as Record<string, unknown>)) {
        if (value !== undefined) merged[key] = value;
      }
      return { ...node, props: merged } as Data['content'][number];
    }),
  };
}

function isEditorConfig(value: unknown): value is DocumentBlockEditorConfig {
  return typeof value === 'object' && value !== null && typeof (value as { render?: unknown }).render === 'function';
}

export function DocumentTemplateEditor(): ReactNode {
  const t = useTranslation('document_templates');
  const tCore = useTranslation('core');
  const { t: translateIn } = useTranslationContext();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('document_templates:write');
  const contributions = useBlockContributions('document');

  const [template, setTemplate] = useState<DocumentTemplateDetail | null>(null);
  const [type, setType] = useState<DocumentTypeDetail | null>(null);
  const [descriptor, setDescriptor] = useState<DocumentBuilderConfig | null>(null);
  const [editors, setEditors] = useState<Readonly<Record<string, DocumentBlockEditorConfig>> | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [language, setLanguage] = useState<string>('');
  const [draft, setDraft] = useState<Data>(EMPTY);
  /** The language `draft` was loaded for — behind `language` until the effect below has run. */
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();
  const pdf = usePdfPreview();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<'save' | 'preview' | 'default' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** The language left for one the template does not hold yet, with its canvas — what "Start from" copies. */
  const [copyFrom, setCopyFrom] = useState<{ language: string; tree: Data } | null>(null);

  const errorText = useCallback(
    (err: unknown, fallbackKey: string): string => {
      if (err instanceof ApiError) {
        const code = err.envelope.error.code;
        const translated = t(`errors.${code}`);
        return translated === `document_templates.errors.${code}` ? err.envelope.error.message : translated;
      }
      return t(fallbackKey);
    },
    [t],
  );

  // The template, its type (with the sample) and the type's palette.
  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const loaded = await getTemplate(id);
      const [detail, config] = await Promise.all([
        getDocumentType(loaded.documentType),
        getBuilderConfig(loaded.documentType),
      ]);
      const offered = detail.languages ?? (await listContentLanguages().catch(() => []));
      const stored = Object.keys(loaded.content.languages);
      const all = [...new Set([...offered, ...stored.filter((code) => detail.languages === null || offered.includes(code))])];
      setTemplate(loaded);
      setType(detail);
      setDescriptor(config);
      setLanguages(all.length > 0 ? all : stored);
      setLanguage((current) => (current && all.includes(current) ? current : (stored[0] ?? all[0] ?? 'en-US')));
    } catch (err) {
      setError(errorText(err, 'editor.loadError'));
    }
  }, [id, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  // The sample in the edited language.
  useEffect(() => {
    if (!template || !language) return undefined;
    let live = true;
    getDocumentType(template.documentType, language)
      .then((detail) => {
        if (live) setType(detail);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [template, language]);

  // The owning modules' canvas renderers for this type's blocks.
  useEffect(() => {
    if (!descriptor) return undefined;
    const wanted = new Set(descriptor.components.map((component) => component.name));
    const selected = contributions.filter((contribution) => wanted.has(contribution.name));
    let live = true;
    void Promise.all(
      selected.map(async (contribution) => {
        try {
          const loaded = (await contribution.component()).default;
          return isEditorConfig(loaded) ? ([contribution.name, loaded] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      setEditors(Object.fromEntries(entries.filter((entry): entry is readonly [string, DocumentBlockEditorConfig] => entry !== null)));
    });
    return () => {
      live = false;
    };
  }, [descriptor, contributions]);

  const declaredDefaults = useMemo(
    () => new Map((descriptor?.components ?? []).map((component) => [component.name, component.defaultProps ?? {}])),
    [descriptor],
  );

  // The edited language's tree, whenever the template or the language changes.
  useEffect(() => {
    if (!template || !language) return;
    const tree = template.content.languages[language] as Data | undefined;
    setDraft(tree ? hydrate(tree, declaredDefaults) : EMPTY);
    setDraftOf(language);
    setEpoch((n) => n + 1);
  }, [template, language, declaredDefaults]);

  const labelOf = useCallback(
    (component: DocumentBuilderComponent): string => {
      if (component.labelKey) {
        const translated = translateIn(component.ownerModule, component.labelKey);
        if (translated !== `${component.ownerModule}.${component.labelKey}`) return translated;
      }
      return component.label ?? component.name;
    },
    [translateIn],
  );

  const canvasEnvironment = useMemo(() => ({ language, preview: true }), [language]);

  const storedNamesKey = [...countComponentNames(draft).keys()].sort().join('\n');
  const puckConfig = useMemo((): Config | null => {
    if (!descriptor || !editors) return null;
    const components: Record<string, ComponentConfig> = {};
    const core = (coreBlockCanvas.components ?? {}) as Record<string, DocumentBlockEditorConfig>;
    for (const component of descriptor.components) {
      const fields = Object.fromEntries(
        Object.entries(component.fields).map(([key, field]) => [key, field.type === 'color' ? { type: 'text' as const, label: field.label } : field]),
      ) as Parameters<typeof editorConfigFromDescriptor>[0]['fields'];
      const editor =
        core[component.name] ??
        editors[component.name] ??
        ({ render: neutralBlockPreview(component.name, t('editor.standIn', { label: labelOf(component) })) } as DocumentBlockEditorConfig);
      const config = editorConfigFromDescriptor({ fields, defaultProps: component.defaultProps }, editor) as ComponentConfig;
      // Colour fields the descriptor declares get the picker unless the editor brought its own.
      const puckFields = { ...(config.fields ?? {}) } as Record<string, Field>;
      for (const [key, field] of Object.entries(component.fields)) {
        if (field.type === 'color' && !(editor.fields && key in editor.fields)) puckFields[key] = puckField(field);
      }
      components[component.name] = { ...config, label: labelOf(component), fields: puckFields } as ComponentConfig;
    }
    // A stored block this type no longer offers or nothing renders: kept, editable as-is (FR-018).
    for (const name of storedNamesKey === '' ? [] : storedNamesKey.split('\n')) {
      if (name in components) continue;
      components[name] = {
        label: name,
        fields: {},
        render: neutralBlockPreview(name, t('editor.placeholder')),
      } as ComponentConfig;
    }
    const categories: NonNullable<Config['categories']> = {};
    for (const category of [...descriptor.categories].sort((a, b) => (a.weight ?? 9999) - (b.weight ?? 9999))) {
      const title = translateIn(category.ownerModule, category.titleKey);
      categories[category.key] = {
        title: title === `${category.ownerModule}.${category.titleKey}` ? category.key : title,
        components: descriptor.components.filter((c) => c.category === category.key).map((c) => c.name),
      };
    }
    const uncategorised = descriptor.components.filter((c) => !c.category).map((c) => c.name);
    if (uncategorised.length > 0) categories['blocks'] = { title: t('editor.otherBlocks'), components: uncategorised };
    categories['other'] = { ...(categories['other'] ?? {}), visible: false };
    const rootFields = Object.fromEntries(Object.entries(descriptor.rootFields).map(([key, field]) => [key, puckField(field)]));
    return {
      components,
      categories,
      root: { fields: rootFields, defaultProps: { ...(type?.pageDefaults ?? {}) } },
    } as Config;
  }, [descriptor, editors, storedNamesKey, labelOf, translateIn, t, type?.pageDefaults]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!template || !canWrite) return false;
    setBusy('save');
    setError(null);
    status.clear();
    try {
      const summary = await saveTemplateContent(template.id, language, draft, template.version);
      setTemplate({
        ...template,
        version: summary.version,
        languages: summary.languages,
        content: { schemaVersion: 1, languages: { ...template.content.languages, [language]: draft } },
      });
      status.show(t('editor.saved'));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') setConflict(true);
      else setError(errorText(err, 'editor.saveError'));
      return false;
    } finally {
      setBusy(null);
    }
  }, [template, canWrite, language, draft, t, errorText, status]);

  const listPath = template ? `/document-templates?type=${encodeURIComponent(template.documentType)}` : '/document-templates';
  const saveAndExit = useCallback(async (): Promise<void> => {
    if (await save()) void navigate(listPath);
  }, [save, navigate, listPath]);

  /**
   * Issue #1461 (CONTENT-02) — the canvas against the language's stored tree,
   * hydrated the same way the canvas was. A language started from another one
   * is unsaved until the first save stores it. Switching language replaces the
   * canvas, so it asks first too — not only a link out of the editor.
   */
  const storedTree = (template?.content.languages[language] as Data | undefined) ?? undefined;
  const dirty =
    template !== null &&
    draftOf === language &&
    (!isDraftEqual(draft, storedTree ? hydrate(storedTree, declaredDefaults) : EMPTY) ||
      (storedTree !== undefined && !template.languages.includes(language)));
  const unsavedGuard = useUnsavedChangesGuard({
    dirty,
    onSave: canWrite ? save : undefined,
    onDiscard: () => {
      setDraft(storedTree ? hydrate(storedTree, declaredDefaults) : EMPTY);
      setEpoch((n) => n + 1);
    },
  });

  const toggleDefault = useCallback(async (): Promise<void> => {
    if (!template || !canWrite) return;
    setBusy('default');
    setError(null);
    status.clear();
    try {
      const summary = template.isDefault
        ? await clearDefaultTemplate(template.id, template.version)
        : await setDefaultTemplate(template.id, template.version);
      setTemplate({ ...template, isDefault: summary.isDefault, version: summary.version });
      status.show(t(summary.isDefault ? 'page.defaultSet' : 'page.defaultCleared', { name: template.name }));
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') setConflict(true);
      else setError(errorText(err, 'editor.saveError'));
    } finally {
      setBusy(null);
    }
  }, [template, canWrite, errorText, status, t]);

  const preview = useCallback(async (): Promise<void> => {
    if (!template) return;
    setBusy('preview');
    setError(null);
    try {
      const blob = await previewDocument(template.documentType, language, draft);
      pdf.show(blob, t('editor.previewTitle', { name: template.name }));
    } catch {
      setError(t('editor.previewError'));
    } finally {
      setBusy(null);
    }
  }, [template, language, draft, t, pdf]);

  const selectLanguage = useCallback(
    (target: string): void => {
      const stored = template?.content.languages[language] as Data | undefined;
      if (template && !template.content.languages[target] && stored) {
        // A switch made before the edited language's canvas has loaded copies
        // what is stored rather than the empty canvas it would otherwise see.
        setCopyFrom({ language, tree: draftOf === language ? draft : hydrate(stored, declaredDefaults) });
      }
      setLanguage(target);
    },
    [template, language, draft, draftOf, declaredDefaults],
  );

  const startLanguage = useCallback(
    (target: string): void => {
      if (!template || template.content.languages[target] || !copyFrom) return;
      // A new language starts as a copy of the one being edited (FR-014); it
      // is stored when the operator saves.
      const copy = structuredClone(copyFrom.tree);
      setTemplate({ ...template, content: { schemaVersion: 1, languages: { ...template.content.languages, [target]: copy } } });
      setCopyFrom(null);
    },
    [template, copyFrom],
  );

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const typeLabel = type ? translateIn(type.moduleId, type.labelKey) : '';

  const builder =
    puckConfig && template && type ? (
      <div className={cn('cms-page-builder', fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4')}>
        {/* The canvas's one border: no card around it (Common Region, issue #1532). */}
        <div className={cn('overflow-hidden rounded-md border', fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]')}>
          {/* The edited tree's language is what a block draws in, as the PDF
              prints it (issue #888), read through `useBlockRenderEnvironment`. */}
          <BlockRenderEnvironmentProvider value={canvasEnvironment}>
            <DocumentSampleProvider value={type.sample}>
              <DocumentCollectionsProvider value={type.collections ?? []} language={language}>
                <Puck
                  key={`${id}:${language}:${epoch}`}
                  config={puckConfig}
                  data={draft}
                  onChange={setDraft}
                  plugins={editorPlugins}
                  viewports={PUCK_LEGACY_VIEWPORTS}
                  dnd={PUCK_LEGACY_DND}
                  overrides={{
                    headerActions: () => (
                      <PageBuilderHeaderActions
                        fullscreen={fullscreen}
                        onToggleFullscreen={(): void => setFullscreen((value) => !value)}
                        currentData={draft}
                        onClearCanvas={(): void => {
                          setDraft(EMPTY);
                          setEpoch((n) => n + 1);
                        }}
                        t={tCore}
                      />
                    ),
                    componentOverlay: ({ children, hover, isSelected, componentId, componentType }) => (
                      <PageBuilderOverlayBridge hover={hover} isSelected={isSelected} componentId={componentId} componentType={componentType}>
                        {children}
                      </PageBuilderOverlayBridge>
                    ),
                  }}
                />
              </DocumentCollectionsProvider>
            </DocumentSampleProvider>
          </BlockRenderEnvironmentProvider>
        </div>
      </div>
    ) : error ? null : (
      // Issue #1540 (CONTENT-23): the builder's shape while it loads, not a sentence.
      <PageBuilderLoadingSkeleton label={t('editor.loading')} className="min-h-[560px]" />
    );

  return (
    <>
      <PageBuilderEditorLayout
        header={
          <>
            <PageHeader
              back={{ label: tCore('common.action.back'), to: listPath }}
              title={template?.name ?? t('editor.title')}
              titleActions={template?.isDefault ? <Badge>{t('page.default')}</Badge> : undefined}
              description={template ? `${typeLabel} · ${template.salesChannelName ?? t('page.allChannels')}` : undefined}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canWrite ? <UnsavedChangesHint dirty={dirty} /> : null}
                  <InlineStatus {...status.props} data-testid="document-template-status" />
                  <Button
                    variant="outline"
                    disabled={!template || busy !== null}
                    aria-busy={busy === 'preview' || undefined}
                    onClick={() => void preview()}
                  >
                    {busy === 'preview' ? t('editor.previewing') : t('editor.preview')}
                  </Button>
                  {canWrite && template ? (
                    <>
                      <Button
                        variant="outline"
                        disabled={busy !== null}
                        aria-busy={busy === 'default' || undefined}
                        onClick={() => void toggleDefault()}
                      >
                        {template.isDefault ? t('page.clearDefault') : t('page.setDefault')}
                      </Button>
                      <SaveButtonGroup
                        onSave={() => void save()}
                        onSaveAndExit={() => void saveAndExit()}
                        saving={busy === 'save'}
                        disabled={busy !== null && busy !== 'save'}
                        saveLabel={t('editor.save')}
                        savingLabel={t('editor.saving')}
                        saveAndExitLabel={tCore('common.action.saveAndExit')}
                      />
                    </>
                  ) : null}
                </div>
              }
            />
            {!canWrite ? (
              <Alert>
                <AlertDescription>{t('editor.readOnly')}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{error}</span>
                  {template === null ? (
                    <Button variant="outline" size="sm" onClick={() => void navigate('/document-templates')}>
                      {tCore('common.action.back')}
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        }
        canvasBar={
          template && type ? (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <LanguageSwitcher
                languages={languages}
                current={language}
                stored={Object.keys(template.content.languages)}
                copyFrom={copyFrom?.language ?? null}
                onSelect={(target) => unsavedGuard.confirm(() => selectLanguage(target))}
                onStart={startLanguage}
              />
              <MergeFieldsPanel variables={type.variables} />
            </div>
          ) : undefined
        }
        builderLabel={typeLabel || undefined}
        builder={builder}
      />
      {conflict ? (
        <ModalDialog
          title={t('editor.conflict.title')}
          onClose={() => setConflict(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConflict(false)}>
                {t('editor.conflict.keepEditing')}
              </Button>
              <Button
                onClick={() => {
                  setConflict(false);
                  void load();
                }}
              >
                {t('editor.conflict.reload')}
              </Button>
            </>
          }
        >
          <p>{t('editor.conflict.body')}</p>
        </ModalDialog>
      ) : null}
      <PdfPreviewDialog preview={pdf.preview} onClose={pdf.close} />
      {unsavedGuard.dialog}
    </>
  );
}

export default DocumentTemplateEditor;

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import { slugify, type CmsBlockDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, EditorSection, FormField, Input, PageHeader, SaveButtonGroup, Textarea } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ContentLanguageTabs, ScopePicker, UnsavedChangesHint, type ScopePickerValue } from '@endora-commerce/admin-kit/components';
import { isDraftEqual } from '@endora-commerce/admin-kit/lib';
import { PageBuilderEditor } from '../components/PageBuilderEditor.js';
import { CanvasLanguagePanel } from '../components/CanvasLanguagePanel.js';
import {
  emptyPageBuilderData,
  hasUnsavedCanvas,
  PageBuilderEditorLayout,
  usePageBuilderEditorSettingsPanel,
} from '@endora-commerce/page-builder-admin';
import {
  listCmsTemplatesForApply,
  loadCmsTemplateCanvas,
  saveCanvasAsCmsTemplate,
} from '../components/cms-template-layout.js';
import { isSameScope, resolveScopedContentLanguage } from '../components/scope-utils.js';
import { cmsClient } from '../api/cms-client.js';
import { useDuplicatedLanding } from '../components/duplicate-record.js';

interface FormState {
  name: string;
  code: string;
  active: boolean;
  description: string;
}

const blankForm: FormState = { name: '', code: '', active: true, description: '' };

/**
 * Derive a CMS block code from a free-text name (so `Łatwy blok` gives
 * `latwy-blok`). The result is a subset of the `cmsCodeRe` charset
 * (`[a-z0-9._-]`), so it always validates.
 *
 * `slugify` from `@endora-commerce/contracts`, **imported, never re-implemented** (issue
 * #245). This site's four-line chain was already correct — it and `PageEditor`
 * were the only two of eight that cut to length *before* stripping the trailing
 * separator — so nothing about its output moves; it is here because eight
 * copies of a correct chain are still eight places for the ninth to be wrong.
 * The 180-character cap is passed explicitly, as every caller's is.
 */
function codeFromName(input: string): string {
  return slugify(input, { maxLength: 180 });
}

function formFor(block: CmsBlockDetail | null): FormState {
  if (!block) return blankForm;
  return { name: block.name, code: block.code, active: block.active, description: block.description ?? '' };
}

function scopeFor(block: CmsBlockDetail | null): ScopePickerValue {
  return block ? { salesChannelIds: block.salesChannelIds, languages: block.languages } : { salesChannelIds: [], languages: [] };
}

function dataFor(block: CmsBlockDetail | null, language: string | null): Data | null {
  if (!block || !language) return null;
  const data = block.content.languages[language];
  if (data && typeof data === 'object') return data as Data;
  return { root: { props: {} }, content: [] };
}

/** The content-language strip's ids: its tabs name the canvas (`CanvasLanguagePanel`). */
const LANGUAGE_TABS_ID = 'cms-block-content-language';

export function BlockEditor(): ReactNode {
  const t = useTranslation('cms');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
  const [block, setBlock] = useState<CmsBlockDetail | null>(null);
  // Issue #1495 (DEC-17) — opened on a fresh copy: the notice, and focus on its name.
  const nameRef = useRef<HTMLInputElement>(null);
  const landedOnCopy = useDuplicatedLanding({
    ready: block !== null,
    reveal: settingsPanel.reveal,
    open: settingsPanel.open,
    nameRef,
  });
  const [form, setForm] = useState<FormState>(blankForm);
  // For a new block the code auto-derives from the name until the editor types
  // into the code field, at which point it stops auto-syncing.
  const [codeEdited, setCodeEdited] = useState(false);
  const [scope, setScope] = useState<ScopePickerValue>({ salesChannelIds: [], languages: [] });
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [languageContentOverrides, setLanguageContentOverrides] = useState<Record<string, Data>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const loaded = await cmsClient.getBlock(id);
    setBlock(loaded);
    setForm(formFor(loaded));
    setScope(scopeFor(loaded));
    setActiveLanguage(loaded.languages[0] ?? null);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  useEffect(() => {
    if (!isNew) return;
    setBlock(null);
    setForm(blankForm);
    setScope({ salesChannelIds: [], languages: [] });
    setActiveLanguage(null);
    setDraftData(null);
    setLanguageContentOverrides({});
    setCodeEdited(false);
    setError(null);
  }, [isNew, id]);

  // React Router reuses this component instance across `/cms/blocks/:id`
  // navigations, so local state survives an id change. Drop any unsaved draft
  // when the edited block changes, otherwise the previous block's edits would
  // mask the newly-loaded content.
  useEffect(() => {
    setDraftData(null);
    setLanguageContentOverrides({});
  }, [id]);

  useEffect(() => {
    if (!activeLanguage && scope.languages.length > 0) setActiveLanguage(scope.languages[0] ?? null);
    if (activeLanguage && !scope.languages.includes(activeLanguage)) {
      setActiveLanguage(scope.languages[0] ?? null);
    }
  }, [activeLanguage, scope.languages]);

  const currentData = useMemo(() => {
    if (draftData) return draftData;
    if (activeLanguage && languageContentOverrides[activeLanguage]) {
      return languageContentOverrides[activeLanguage] ?? null;
    }
    return dataFor(block, activeLanguage);
  }, [activeLanguage, block, draftData, languageContentOverrides]);

  // Issue #1461 (CONTENT-02) — the draft against the last saved version.
  const dirty =
    !isDraftEqual(form, formFor(block)) ||
    !isSameScope(scope, scopeFor(block)) ||
    hasUnsavedCanvas({
      draft: draftData,
      activeLanguage,
      overrides: languageContentOverrides,
      saved: (language) => (block ? dataFor(block, language) : null),
    });

  const discard = (): void => {
    setForm(formFor(block));
    setScope(scopeFor(block));
    setDraftData(null);
    setLanguageContentOverrides({});
  };

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('blockEditor.errors.selectChannel'));
      settingsPanel.reveal();
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('blockEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('blockEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      let saved = isNew
        ? await cmsClient.createBlock({
            name: form.name,
            code: form.code,
            active: form.active,
            description: form.description || null,
            salesChannelIds: scope.salesChannelIds,
            languages: scope.languages,
          })
        : await cmsClient.patchBlock(block!.id, {
            name: form.name,
            code: form.code,
            active: form.active,
            description: form.description || null,
            salesChannelIds: scope.salesChannelIds,
            languages: scope.languages,
            version: block!.version,
          });
      if (currentData) {
        saved = await cmsClient.putBlockContent(saved.id, contentLanguage, {
          data: currentData,
          version: saved.version,
        });
      }
      for (const [lang, data] of Object.entries(languageContentOverrides)) {
        if (lang === contentLanguage) continue;
        saved = await cmsClient.putBlockContent(saved.id, lang, {
          data,
          version: saved.version,
        });
      }
      setBlock(saved);
      setDraftData(null);
      setLanguageContentOverrides({});
      if (isNew) navigate(`/cms/blocks/${saved.id}`, { replace: true });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Name, slug, code and scope all live in the settings panel, and they
      // are what a refused save is nearly always about.
      settingsPanel.reveal();
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/cms/blocks');
  };

  // The tab the strip shows selected — the active language, else the scope's first.
  const canvasLanguage = resolveScopedContentLanguage(scope, activeLanguage);

  return (
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      dirty={dirty}
      onSave={save}
      onDiscard={discard}
      header={
        <>
          <PageHeader
            back={{ label: t('blocksList.title'), to: '/cms/blocks' }}
            title={isNew ? t('blockEditor.title.new') : form.name || t('blockEditor.title.edit')}
            actions={
              <div className="flex items-center gap-2">
                <UnsavedChangesHint dirty={dirty} />
                <SaveButtonGroup
                  onSave={() => void save()}
                  onSaveAndExit={() => void saveAndExit()}
                  saving={saving}
                  saveLabel={t('common.save')}
                  savingLabel={t('common.saving')}
                  saveAndExitLabel={t('common.saveAndExit')}
                />
              </div>
            }
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {landedOnCopy ? (
            <Alert live="polite">
              <AlertDescription>{t('duplicate.created')}</AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      settings={
        <>
          <EditorSection as="h3" title={t('blockEditor.metadata')}>
            <FormField label={t('fields.name')}>
              <Input
                ref={nameRef}
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    ...(isNew && !codeEdited ? { code: codeFromName(name) } : {}),
                  }));
                }}
              />
            </FormField>
            <FormField label={t('fields.code')}>
              <Input
                value={form.code}
                className="font-mono"
                onChange={(event) => {
                  setCodeEdited(true);
                  setForm((f) => ({ ...f, code: event.target.value.toLowerCase() }));
                }}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              {t('fields.active')}
            </label>
            <FormField label={t('fields.description')}>
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </FormField>
          </EditorSection>
          <ScopePicker value={scope} onChange={setScope} titleAs="h3" />
        </>
      }
      canvasBar={
        <ContentLanguageTabs
          languages={scope.languages}
          activeLanguage={activeLanguage}
          idBase={canvasLanguage === null ? undefined : LANGUAGE_TABS_ID}
          onChange={(language) => {
            if (activeLanguage && draftData) {
              setLanguageContentOverrides((prev) => ({
                ...prev,
                [activeLanguage]: draftData,
              }));
            }
            setDraftData(null);
            setActiveLanguage(language);
          }}
        />
      }
      builder={
        <CanvasLanguagePanel idBase={LANGUAGE_TABS_ID} language={canvasLanguage}>
          <PageBuilderEditor
            data={currentData}
            onChange={setDraftData}
            contentKey={`${id ?? 'new'}:${activeLanguage ?? ''}`}
            // Feature 151 — the translation's audit subject, and the version whose
            // change (a save) retires its *Restore previous content*.
            resource={{ type: 'cms_block', id: block?.id ?? null }}
            savedVersion={block?.version ?? null}
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onResolveLanguageContent={(language) => {
              if (language === activeLanguage && draftData) {
                return structuredClone(draftData);
              }
              if (languageContentOverrides[language]) {
                return structuredClone(languageContentOverrides[language]!);
              }
              return structuredClone(dataFor(block, language) ?? emptyPageBuilderData());
            }}
            onSaveAsTemplate={async (meta, canvasData) => {
              await saveCanvasAsCmsTemplate({
                ...meta,
                data: canvasData,
                salesChannelIds: scope.salesChannelIds,
                languages: scope.languages,
                activeLanguage,
              });
            }}
            onListTemplatesForApply={listCmsTemplatesForApply}
            onResolveTemplateLayout={(templateId) =>
              loadCmsTemplateCanvas(templateId, activeLanguage)
            }
          />
        </CanvasLanguagePanel>
      }
    />
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlockEditor;

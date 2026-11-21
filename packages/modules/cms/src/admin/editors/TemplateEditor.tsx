import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type { CmsTemplateDetail } from '@endora-commerce/contracts';
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
  description: string;
}

const blankForm: FormState = { name: '', code: '', description: '' };

function formFor(template: CmsTemplateDetail | null): FormState {
  if (!template) return blankForm;
  return { name: template.name, code: template.code, description: template.description ?? '' };
}

function scopeFor(template: CmsTemplateDetail | null): ScopePickerValue {
  return template
    ? { salesChannelIds: template.salesChannelIds, languages: template.languages }
    : { salesChannelIds: [], languages: [] };
}

function dataFor(template: CmsTemplateDetail | null, language: string | null): Data | null {
  if (!template || !language) return null;
  const data = template.content.languages[language];
  if (data && typeof data === 'object') return data as Data;
  return { root: { props: {} }, content: [] };
}

/** The content-language strip's ids: its tabs name the canvas (`CanvasLanguagePanel`). */
const LANGUAGE_TABS_ID = 'cms-template-content-language';

export function TemplateEditor(): ReactNode {
  const t = useTranslation('cms');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
  const [template, setTemplate] = useState<CmsTemplateDetail | null>(null);
  // Issue #1495 (DEC-17) — opened on a fresh copy: the notice, and focus on its name.
  const nameRef = useRef<HTMLInputElement>(null);
  const landedOnCopy = useDuplicatedLanding({
    ready: template !== null,
    reveal: settingsPanel.reveal,
    open: settingsPanel.open,
    nameRef,
  });
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<ScopePickerValue>({ salesChannelIds: [], languages: [] });
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [languageContentOverrides, setLanguageContentOverrides] = useState<Record<string, Data>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const loaded = await cmsClient.getTemplate(id);
    setTemplate(loaded);
    setForm(formFor(loaded));
    setScope(scopeFor(loaded));
    setActiveLanguage(loaded.languages[0] ?? null);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  useEffect(() => {
    if (!isNew) return;
    setTemplate(null);
    setForm(blankForm);
    setScope({ salesChannelIds: [], languages: [] });
    setActiveLanguage(null);
    setDraftData(null);
    setLanguageContentOverrides({});
    setError(null);
  }, [isNew, id]);

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
    return dataFor(template, activeLanguage);
  }, [activeLanguage, draftData, languageContentOverrides, template]);

  // Issue #1461 (CONTENT-02) — the draft against the last saved version.
  const dirty =
    !isDraftEqual(form, formFor(template)) ||
    !isSameScope(scope, scopeFor(template)) ||
    hasUnsavedCanvas({
      draft: draftData,
      activeLanguage,
      overrides: languageContentOverrides,
      saved: (language) => (template ? dataFor(template, language) : null),
    });

  const discard = (): void => {
    setForm(formFor(template));
    setScope(scopeFor(template));
    setDraftData(null);
    setLanguageContentOverrides({});
  };

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('templateEditor.errors.selectChannel'));
      settingsPanel.reveal();
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('templateEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('templateEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      let saved = isNew
        ? await cmsClient.createTemplate({
            name: form.name,
            code: form.code,
            description: form.description || null,
            salesChannelIds: scope.salesChannelIds,
            languages: scope.languages,
          })
        : await cmsClient.patchTemplate(template!.id, {
            name: form.name,
            code: form.code,
            description: form.description || null,
            salesChannelIds: scope.salesChannelIds,
            languages: scope.languages,
            version: template!.version,
          });
      if (currentData) {
        saved = await cmsClient.putTemplateContent(saved.id, contentLanguage, {
          data: currentData,
          version: saved.version,
        });
      }
      for (const [lang, data] of Object.entries(languageContentOverrides)) {
        if (lang === contentLanguage) continue;
        saved = await cmsClient.putTemplateContent(saved.id, lang, {
          data,
          version: saved.version,
        });
      }
      setTemplate(saved);
      setDraftData(null);
      setLanguageContentOverrides({});
      if (isNew) navigate(`/cms/templates/${saved.id}`, { replace: true });
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
    if (await save()) navigate('/cms/templates');
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
            back={{ label: t('common.back'), to: '/cms/templates' }}
            title={isNew ? t('templateEditor.title.new') : form.name || t('templateEditor.title.edit')}
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
          <EditorSection as="h3" title={t('templateEditor.metadata')}>
            <FormField label={t('fields.name')}>
              <Input ref={nameRef} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </FormField>
            <FormField label={t('fields.code')}>
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            </FormField>
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
            resource={{ type: 'cms_template', id: template?.id ?? null }}
            savedVersion={template?.version ?? null}
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onResolveLanguageContent={(language) => {
              if (language === activeLanguage && draftData) {
                return structuredClone(draftData);
              }
              if (languageContentOverrides[language]) {
                return structuredClone(languageContentOverrides[language]!);
              }
              return structuredClone(dataFor(template, language) ?? emptyPageBuilderData());
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
export default TemplateEditor;

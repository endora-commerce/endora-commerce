import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { CmsBlockDetail } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/useTranslation';
import { normalize } from '@/lib/text-normalization';
import { ContentLanguageTabs } from '../components/ContentLanguageTabs';
import { CmsContentEditorLayout } from '../components/CmsContentEditorLayout';
import { PageBuilderEditor } from '../components/PageBuilderEditor';
import { emptyPageBuilderData } from '../components/page-builder-data';
import {
  listCmsTemplatesForApply,
  loadCmsTemplateCanvas,
  saveCanvasAsCmsTemplate,
} from '../components/cms-template-layout';
import { ScopePicker, type CmsScopeValue } from '../components/ScopePicker';
import { resolveScopedContentLanguage } from '../components/scope-utils';
import { cmsClient } from '../api/cms-client';

interface FormState {
  name: string;
  code: string;
  active: boolean;
  description: string;
}

const blankForm: FormState = { name: '', code: '', active: true, description: '' };

/**
 * Derive a CMS block code from a free-text name. Folds diacritics via the
 * shared `normalize` helper (so "Łatwy blok" → "latwy-blok"), collapses any
 * run of non-alphanumerics to a single hyphen, trims stray hyphens, and caps
 * at the 180-char limit. The result is a subset of the `cmsCodeRe` charset
 * (`[a-z0-9._-]`), so it always validates.
 */
function codeFromName(input: string): string {
  return normalize(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 180)
    .replace(/-+$/, '');
}

function dataFor(block: CmsBlockDetail | null, language: string | null): Data | null {
  if (!block || !language) return null;
  const data = block.content.languages[language];
  if (data && typeof data === 'object') return data as Data;
  return { root: { props: {} }, content: [] };
}

export function BlockEditor(): ReactNode {
  const t = useTranslation('cms');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [block, setBlock] = useState<CmsBlockDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  // For a new block the code auto-derives from the name until the editor types
  // into the code field, at which point it stops auto-syncing.
  const [codeEdited, setCodeEdited] = useState(false);
  const [scope, setScope] = useState<CmsScopeValue>({ salesChannelIds: [], languages: [] });
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [languageContentOverrides, setLanguageContentOverrides] = useState<Record<string, Data>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const loaded = await cmsClient.getBlock(id);
    setBlock(loaded);
    setForm({
      name: loaded.name,
      code: loaded.code,
      active: loaded.active,
      description: loaded.description ?? '',
    });
    setScope({ salesChannelIds: loaded.salesChannelIds, languages: loaded.languages });
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

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('blockEditor.errors.selectChannel'));
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('blockEditor.errors.selectLanguage'));
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('blockEditor.errors.selectLanguage'));
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
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/cms/blocks');
  };

  return (
    <CmsContentEditorLayout
      header={
        <>
          <PageHeader
            title={isNew ? t('blockEditor.title.new') : form.name || t('blockEditor.title.edit')}
            description={t('blockEditor.description')}
            actions={
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link to="/cms/blocks">{t('common.back')}</Link>
                </Button>
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
        </>
      }
      settings={
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('blockEditor.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t('fields.name')}</Label>
                <Input
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
              </div>
              <div className="space-y-1">
                <Label>{t('fields.code')}</Label>
                <Input
                  value={form.code}
                  className="font-mono"
                  onChange={(event) => {
                    setCodeEdited(true);
                    setForm((f) => ({ ...f, code: event.target.value.toLowerCase() }));
                  }}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                />
                {t('fields.active')}
              </label>
              <div className="space-y-1">
                <Label>{t('fields.description')}</Label>
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
            </CardContent>
          </Card>
          <ScopePicker value={scope} onChange={setScope} />
        </>
      }
      languageTabs={
        <ContentLanguageTabs
          languages={scope.languages}
          activeLanguage={activeLanguage}
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
        <PageBuilderEditor
          data={currentData}
          onChange={setDraftData}
          contentKey={`${id ?? 'new'}:${activeLanguage ?? ''}`}
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
      }
    />
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { CmsTemplateDetail } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentLanguageTabs } from '../components/ContentLanguageTabs';
import { CmsContentEditorLayout } from '../components/CmsContentEditorLayout';
import { PageBuilderEditor } from '../components/PageBuilderEditor';
import { emptyPageBuilderData } from '../components/page-builder-data';
import { ScopePicker, type CmsScopeValue } from '../components/ScopePicker';
import { resolveScopedContentLanguage } from '../components/scope-utils';
import { cmsClient } from '../api/cms-client';

interface FormState {
  name: string;
  code: string;
  description: string;
}

const blankForm: FormState = { name: '', code: '', description: '' };

function dataFor(template: CmsTemplateDetail | null, language: string | null): Data | null {
  if (!template || !language) return null;
  const data = template.content.languages[language];
  if (data && typeof data === 'object') return data as Data;
  return { root: { props: {} }, content: [] };
}

export function TemplateEditor(): ReactNode {
  const t = useTranslation('cms');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [template, setTemplate] = useState<CmsTemplateDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<CmsScopeValue>({ salesChannelIds: [], languages: [] });
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [languageContentOverrides, setLanguageContentOverrides] = useState<Record<string, Data>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const loaded = await cmsClient.getTemplate(id);
    setTemplate(loaded);
    setForm({
      name: loaded.name,
      code: loaded.code,
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

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('templateEditor.errors.selectChannel'));
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('templateEditor.errors.selectLanguage'));
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('templateEditor.errors.selectLanguage'));
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
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/cms/templates');
  };

  return (
    <CmsContentEditorLayout
      header={
        <>
          <PageHeader
            title={isNew ? t('templateEditor.title.new') : form.name || t('templateEditor.title.edit')}
            description={t('templateEditor.description')}
            actions={
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link to="/cms/templates">{t('common.back')}</Link>
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
              <CardTitle className="text-base">{t('templateEditor.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t('fields.name')}</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t('fields.code')}</Label>
                <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
              </div>
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
            return structuredClone(dataFor(template, language) ?? emptyPageBuilderData());
          }}
        />
      }
    />
  );
}

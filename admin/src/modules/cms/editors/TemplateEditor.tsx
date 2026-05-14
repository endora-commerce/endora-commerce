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
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentLanguageTabs } from '../components/ContentLanguageTabs';
import { PageBuilderEditor } from '../components/PageBuilderEditor';
import { ScopePicker, type CmsScopeValue } from '../components/ScopePicker';
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
    if (!activeLanguage && scope.languages.length > 0) setActiveLanguage(scope.languages[0] ?? null);
    if (activeLanguage && !scope.languages.includes(activeLanguage)) {
      setActiveLanguage(scope.languages[0] ?? null);
    }
  }, [activeLanguage, scope.languages]);

  const currentData = useMemo(
    () => draftData ?? dataFor(template, activeLanguage),
    [activeLanguage, template, draftData],
  );

  const save = async (): Promise<void> => {
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
      if (activeLanguage && currentData) {
        saved = await cmsClient.putTemplateContent(saved.id, activeLanguage, {
          data: currentData,
          version: saved.version,
        });
      }
      setTemplate(saved);
      setDraftData(null);
      if (isNew) navigate(`/cms/templates/${saved.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? t('templateEditor.title.new') : form.name || t('templateEditor.title.edit')}
        description={t('templateEditor.description')}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/cms/templates">{t('common.back')}</Link>
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-4">
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
        </div>
        <div className="col-span-8 space-y-3">
          <ContentLanguageTabs
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onChange={(language) => {
              setDraftData(null);
              setActiveLanguage(language);
            }}
          />
          <PageBuilderEditor data={currentData} onChange={setDraftData} />
        </div>
      </div>
    </div>
  );
}

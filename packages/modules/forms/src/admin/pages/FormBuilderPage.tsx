import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Copy, History, Languages, Lock, MousePointerClick, Trash2, Unlock } from 'lucide-react';
import {
  FORMS_LIMITS,
  textCompleteness,
  type FormDefinition,
  type FormDefinitionIssue,
  type FormDefinitionIssueCode,
  type FormDetail,
  type FormFieldType,
} from '@endora-commerce/contracts';
import { ContentLanguageTabs, StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { formsApi, type FormVersionItem } from '../api.js';
import { BuilderCanvas } from '../components/BuilderCanvas.js';
import { FieldInspector } from '../components/FieldInspector.js';
import { FieldPalette } from '../components/FieldPalette.js';
import { FormPreview } from '../components/FormPreview.js';
import { DeleteFormDialog, FormStatusBadge, FormWarningList } from '../components/FormStatus.js';
import { FormSettingsPanel } from '../components/FormSettingsPanel.js';
import { NotificationsPanel } from '../components/NotificationsPanel.js';
import { TranslatableText } from '../components/TranslatableText.js';
import {
  addSection,
  findField,
  insertField,
  isInputField,
  locateField,
  newField,
  newSection,
  removeField,
  setText,
  textOf,
} from '../lib/definition-draft.js';
import { definitionIssuesOf, errorMessage } from '../lib/errors.js';
import { firstMissingText, placeOfText } from '../lib/text-catalogue.js';

type Tab = 'fields' | 'settings' | 'notifications' | 'versions';
const TABS: readonly Tab[] = ['fields', 'settings', 'notifications', 'versions'];
type Busy = 'save' | 'publish' | 'status' | null;

interface Draft {
  readonly name: string;
  readonly definition: FormDefinition;
}

/**
 * The form builder (`specs/170-forms-module/` User Story 1, FR-008 – FR-018; contracts/admin-surfaces
 * §4): the field palette, the canvas of sections and fields (reordered with admin-kit's
 * `useGroupedReorder`), the inspector of the field being edited and the live preview — the
 * storefront's renderer — with the publish bar under them.
 *
 * One draft is edited on screen and saved as the working copy (shape only, FR-011); publishing saves
 * first, so the version frozen is the copy on screen, and names the revision it saved (R-26). A
 * refused publish shows each reason next to its element and in the bar, where it is a link to the
 * element; the warnings (FR-018) are said and never block. The *Notifications* tab (User Story 5)
 * saves the recipients on its own and edits the confirmation e-mail in the draft; the *Settings*
 * tab (User Story 6) edits what follows a submission, the restrictions and the CAPTCHA switch in
 * the draft.
 *
 * **The content language** (User Story 7, FR-068; 2026-11-03 owner review, which replaced the
 * *Translations* tab) is page state, chosen in the header with admin-kit's `ContentLanguageTabs` —
 * the storefront languages, the form's default first — and shared by every tab: the canvas, the
 * inspector, the settings, the confirmation e-mail and the preview all show and edit that
 * language's texts. In the default language everything is editable; in another one only the texts
 * are, and the structure is locked with a note saying where it is edited (one structure, texts per
 * language — US7-1). Each incomplete language is marked beside the switch with the number of its
 * missing texts — the contracts' `textCompleteness`, the rule of the server's `untranslated`
 * warning (US7-2) — and the mark takes the operator to the first missing text, in reading order.
 */
export function FormBuilderPage(): ReactNode {
  const t = useTranslation('forms');
  const { language: adminLanguage } = useAppLanguage();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('forms:write');
  const nameId = useId();
  const tabsId = useId();
  const formTextsId = useId();

  const [form, setForm] = useState<FormDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<FormDefinitionIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [tab, setTab] = useState<Tab>('fields');
  const [versions, setVersions] = useState<FormVersionItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [languages, setLanguages] = useState<readonly string[] | null>(null);
  const [contentLanguage, setContentLanguage] = useState<string | null>(null);
  /** A text to focus once the screen shows it (the *go to the first missing text* of the switch). */
  const [focusText, setFocusText] = useState<string | null>(null);

  const adopt = useCallback((detail: FormDetail) => {
    setForm(detail);
    setDraft({ name: detail.name, definition: detail.definition });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    formsApi
      .get(id)
      .then((detail) => {
        if (alive) adopt(detail);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [id, adopt]);

  useEffect(() => {
    let alive = true;
    formsApi
      .languages()
      .then((answer) => {
        if (alive) setLanguages(answer.languages);
      })
      .catch(() => {
        // The form's own language is always one it may be written in.
        if (alive) setLanguages([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (focusText === null) return;
    const target = document.querySelector<HTMLElement>(`[data-text-id="${focusText}"]`);
    target?.focus();
    setFocusText(null);
  }, [focusText]);

  useEffect(() => {
    if (tab !== 'versions') return undefined;
    let alive = true;
    formsApi
      .versions(id)
      .then((answer) => {
        if (alive) setVersions(answer.items);
      })
      .catch(() => {
        if (alive) setVersions(null);
      });
    return () => {
      alive = false;
    };
  }, [id, tab, form?.publishedVersionNumber]);

  const dirty = useMemo(
    () =>
      form !== null &&
      draft !== null &&
      (draft.name !== form.name || JSON.stringify(draft.definition) !== JSON.stringify(form.definition)),
    [form, draft],
  );

  const issuesByElement = useMemo(() => {
    const map = new Map<string, FormDefinitionIssueCode[]>();
    for (const issue of issues ?? []) {
      if (issue.elementId === null) continue;
      map.set(issue.elementId, [...(map.get(issue.elementId) ?? []), issue.code]);
    }
    return map;
  }, [issues]);

  const publishedKeys = useMemo(() => {
    const keys = new Map<string, string>();
    for (const section of form?.publishedDefinition?.sections ?? []) {
      for (const field of section.fields) if (isInputField(field)) keys.set(field.id, field.key);
    }
    return keys;
  }, [form?.publishedDefinition]);

  const defaultLanguage = form?.defaultLanguage ?? '';
  // The storefront languages, the form's own first — it is always one it may be written in.
  const contentLanguages = useMemo(
    () => (defaultLanguage === '' ? [] : [defaultLanguage, ...(languages ?? []).filter((code) => code !== defaultLanguage)]),
    [languages, defaultLanguage],
  );
  const completeness = useMemo(
    () => (draft === null || defaultLanguage === '' ? [] : textCompleteness(draft.definition, contentLanguages, defaultLanguage)),
    [draft, contentLanguages, defaultLanguage],
  );

  if (loadFailed) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('list.title')} back={{ label: t('builder.back'), to: '/forms' }} />
        <Alert variant="destructive">
          <AlertDescription>{t('builder.loadError')}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!form || !draft) return <p className="text-sm text-muted-foreground">{t('builder.loading')}</p>;

  const definition = draft.definition;
  const edit = (next: FormDefinition): void => setDraft({ ...draft, definition: next });
  const language = contentLanguage !== null && contentLanguages.includes(contentLanguage) ? contentLanguage : defaultLanguage;
  const translating = language !== defaultLanguage;
  const incomplete = completeness.filter((entry) => entry.missing.length > 0);
  const activeMissing = completeness.find((entry) => entry.language === language)?.missing.length ?? 0;

  /** Opens `code` and takes the operator to its first missing text, in the form's reading order. */
  const goToMissing = (code: string): void => {
    const missing = completeness.find((entry) => entry.language === code)?.missing ?? [];
    const first = firstMissingText(definition, missing);
    setContentLanguage(code);
    if (first === null) return;
    const place = placeOfText(first);
    setTab(place.tab);
    if (place.fieldId && findField(definition, place.fieldId)) setSelectedId(place.fieldId);
    setFocusText(first);
  };

  const save = async (): Promise<FormDetail | null> => {
    setBusy('save');
    setError(null);
    try {
      const saved = await formsApi.update(form.id, {
        expectedRevision: form.revision,
        ...(draft.name.trim() !== form.name && draft.name.trim() !== '' ? { name: draft.name.trim() } : {}),
        definition,
      });
      adopt(saved);
      return saved;
    } catch (failure) {
      setError(errorMessage(failure, t('builder.error')));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async (): Promise<void> => {
    const current = dirty ? await save() : form;
    if (!current) return;
    setBusy('publish');
    setError(null);
    try {
      adopt(await formsApi.publish(current.id, current.revision));
      setIssues(null);
    } catch (failure) {
      const refused = definitionIssuesOf(failure);
      if (refused) setIssues(refused);
      else setError(errorMessage(failure, t('builder.error')));
    } finally {
      setBusy(null);
    }
  };

  const move = async (to: 'close' | 'reopen'): Promise<void> => {
    setBusy('status');
    setError(null);
    try {
      adopt(await (to === 'close' ? formsApi.close(form.id, form.revision) : formsApi.reopen(form.id, form.revision)));
    } catch (failure) {
      setError(errorMessage(failure, t('builder.error')));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (): Promise<void> => {
    setError(null);
    try {
      const copy = await formsApi.duplicate(form.id);
      navigate(`/forms/${copy.id}`);
    } catch (failure) {
      setError(errorMessage(failure, t('builder.error')));
    }
  };

  /** The section a palette press adds to: the one being edited, else the last. */
  const targetSection = (): string => {
    const place = selectedId ? locateField(definition, selectedId) : null;
    return place?.section.id ?? definition.sections[definition.sections.length - 1]!.id;
  };

  const addField = (sectionId: string, type: FormFieldType): void => {
    const field = newField(definition, type);
    let next = insertField(definition, sectionId, field);
    if (isInputField(field)) next = setText(next, defaultLanguage, `fields.${field.id}.label`, t(`fieldTypes.${type}`));
    if (type === 'section_break') next = setText(next, defaultLanguage, `fields.${field.id}.title`, t(`fieldTypes.${type}`));
    edit(next);
    setSelectedId(field.id);
  };

  /** The name an issue's element goes by in the bar. */
  const elementName = (elementId: string | null): string => {
    if (elementId === null) return t('builder.formLevel');
    const field = findField(definition, elementId);
    if (field) return textOf(definition, defaultLanguage, `fields.${field.id}.label`) || t(`fieldTypes.${field.type}`);
    const index = definition.sections.findIndex((section) => section.id === elementId);
    return index >= 0 ? t('canvas.section', { number: index + 1 }) : t('builder.formLevel');
  };

  const writing = !canWrite || busy !== null;
  const updated = new Intl.DateTimeFormat(adminLanguage, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {form.name} <FormStatusBadge status={form.status} />
          </span>
        }
        description={
          <span>
            <code className="text-xs">{form.key}</code> ·{' '}
            {form.publishedVersionNumber > 0 ? t('builder.liveVersion', { number: form.publishedVersionNumber }) : t('builder.notPublished')}
          </span>
        }
        back={{ label: t('builder.back'), to: '/forms' }}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {form.status === 'published' ? (
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void move('close')}>
                  <Lock size={14} aria-hidden="true" />
                  {t('builder.close')}
                </Button>
              ) : null}
              {form.status === 'closed' ? (
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void move('reopen')}>
                  <Unlock size={14} aria-hidden="true" />
                  {t('builder.reopen')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void duplicate()}>
                <Copy size={14} aria-hidden="true" />
                {t('builder.duplicate')}
              </Button>
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setDeleting(true)}>
                <Trash2 size={14} aria-hidden="true" />
                {t('builder.delete')}
              </Button>
            </div>
          ) : null
        }
      />

      {form.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>{t('warnings.title')}</AlertTitle>
          <AlertDescription>
            <FormWarningList warnings={form.warnings} />
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {contentLanguages.length > 1 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Languages size={16} aria-hidden="true" className="text-muted-foreground" />
              {t('language.title')}
            </span>
            <ContentLanguageTabs
              languages={contentLanguages}
              activeLanguage={language}
              onChange={(code) => setContentLanguage(code)}
            />
            {incomplete.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-1">
                {incomplete.map((entry) => (
                  <li key={entry.language}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-amber-700 dark:text-amber-400"
                      aria-label={t('language.goToMissing', { language: entry.language, count: entry.missing.length })}
                      onClick={() => goToMissing(entry.language)}
                    >
                      <AlertCircle size={14} aria-hidden="true" />
                      {t('language.missing', { language: entry.language, count: entry.missing.length })}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p aria-live="polite" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              {translating && activeMissing === 0 ? (
                <>
                  <CheckCircle2 size={14} aria-hidden="true" className="text-emerald-600" />
                  <span>{t('language.complete', { language })}</span>
                </>
              ) : null}
            </p>
          </CardContent>
          {translating ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-3 py-2 text-sm">
              <Lock size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              <span className="flex-1">{t('language.structureLocked', { language, default: defaultLanguage })}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setContentLanguage(defaultLanguage)}>
                {t('language.switchToDefault', { language: defaultLanguage })}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div role="tablist" aria-label={t('builder.tabs.label')} className="flex gap-2 overflow-x-auto border-b border-border">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${tabsId}-${name}`}
            aria-selected={tab === name}
            aria-controls={`${tabsId}-${name}-panel`}
            onClick={() => setTab(name)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === name ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground',
            )}
          >
            {t(`builder.tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'fields' ? (
        <div role="tabpanel" id={`${tabsId}-fields-panel`} aria-labelledby={`${tabsId}-fields`} className="space-y-4">
          <Card role="region" aria-labelledby={`${formTextsId}-title`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle>
                <h2 id={`${formTextsId}-title`}>{t('builder.formCard')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 pt-0 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={nameId}>{t('builder.name')}</Label>
                <Input
                  id={nameId}
                  value={draft.name}
                  maxLength={200}
                  disabled={writing || translating}
                  aria-describedby={`${nameId}-hint`}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <p id={`${nameId}-hint`} className="text-xs text-muted-foreground">
                  {t('builder.nameHint')}
                </p>
              </div>
              <TranslatableText
                id={`${formTextsId}-form-title`}
                label={t('builder.formTitle')}
                definition={definition}
                language={language}
                defaultLanguage={defaultLanguage}
                textId="form.title"
                maxLength={FORMS_LIMITS.singleLineChars}
                disabled={writing}
                onChange={edit}
              />
              <TranslatableText
                id={`${formTextsId}-form-description`}
                label={t('builder.formDescription')}
                definition={definition}
                language={language}
                defaultLanguage={defaultLanguage}
                textId="form.description"
                rows={2}
                disabled={writing}
                onChange={edit}
              />
              <TranslatableText
                id={`${formTextsId}-submit`}
                label={t('builder.submitLabel')}
                definition={definition}
                language={language}
                defaultLanguage={defaultLanguage}
                textId="form.submitLabel"
                maxLength={FORMS_LIMITS.singleLineChars}
                disabled={writing}
                onChange={edit}
              />
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
            <FieldPalette
              onAdd={(type) => addField(targetSection(), type)}
              disabled={writing}
              lockedFor={translating ? defaultLanguage : null}
            />
            <BuilderCanvas
              definition={definition}
              language={language}
              defaultLanguage={defaultLanguage}
              selectedId={selectedId}
              issues={issuesByElement}
              disabled={writing}
              onChange={edit}
              onSelect={setSelectedId}
              onAddField={addField}
              onAddSection={() => edit(addSection(definition, newSection()))}
            />
            {selectedId && findField(definition, selectedId) ? (
              <FieldInspector
                definition={definition}
                fieldId={selectedId}
                language={language}
                defaultLanguage={defaultLanguage}
                publishedKeys={publishedKeys}
                issues={issues ?? []}
                disabled={writing}
                onChange={edit}
                onRemove={(fieldId) => {
                  edit(removeField(definition, fieldId));
                  setSelectedId(null);
                }}
              />
            ) : (
              <Card className="border-dashed lg:sticky lg:top-4">
                <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
                  <MousePointerClick size={24} aria-hidden="true" className="text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('inspector.empty')}</p>
                </CardContent>
              </Card>
            )}
          </div>
          <FormPreview formId={form.id} language={language} version={form.revision} stale={dirty} />
        </div>
      ) : tab === 'settings' ? (
        <div role="tabpanel" id={`${tabsId}-settings-panel`} aria-labelledby={`${tabsId}-settings`}>
          <FormSettingsPanel
            form={form}
            definition={definition}
            language={language}
            defaultLanguage={defaultLanguage}
            disabled={writing}
            onDefinitionChange={edit}
            // Retention is live and not part of the draft: the form takes the new revision.
            onSaved={(saved) => setForm(saved)}
          />
        </div>
      ) : tab === 'notifications' ? (
        <div role="tabpanel" id={`${tabsId}-notifications-panel`} aria-labelledby={`${tabsId}-notifications`}>
          <NotificationsPanel
            form={form}
            definition={definition}
            language={language}
            defaultLanguage={defaultLanguage}
            disabled={writing}
            onDefinitionChange={edit}
            // The recipients are live and not part of the draft: the form takes the new revision and
            // the unsaved draft stays on screen.
            onSaved={(saved) => setForm(saved)}
          />
        </div>
      ) : (
        <div role="tabpanel" id={`${tabsId}-versions-panel`} aria-labelledby={`${tabsId}-versions`}>
          <Card>
            <CardHeader className="p-4">
              <CardTitle>
                <h2>{t('versions.title')}</h2>
              </CardTitle>
              <CardDescription>
                {form.publishedVersionNumber > 0 ? t('builder.liveVersion', { number: form.publishedVersionNumber }) : t('builder.notPublished')}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {versions === null ? null : versions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-8 text-center">
                  <History size={24} aria-hidden="true" className="text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('versions.empty')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {versions.map((version) => (
                    <li key={version.number} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="inline-flex items-center gap-2 font-medium">
                        {t('versions.item', { number: version.number })}
                        {version.number === form.publishedVersionNumber ? (
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                            {t('versions.live')}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground">
                        {t('versions.publishedAt', { date: updated.format(new Date(version.publishedAt)) })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {canWrite ? (
        <StickyFormActions>
          <div role="region" aria-label={t('builder.publishBar')} className="w-full space-y-2">
            {issues && issues.length > 0 ? (
              <div className="space-y-1" role="alert">
                <p className="text-sm font-medium text-destructive">{t('builder.publishRefused')}</p>
                <ul className="space-y-0.5">
                  {issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.elementId ?? 'form'}-${index}`}>
                      <button
                        type="button"
                        className="inline-flex items-start gap-1 text-left text-sm text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setTab('fields');
                          if (issue.elementId && findField(definition, issue.elementId)) setSelectedId(issue.elementId);
                        }}
                      >
                        <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                        <span>
                          {elementName(issue.elementId)}: {t(`issues.${issue.code}`)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-muted-foreground">{dirty ? t('builder.unsaved') : t('builder.saved')}</span>
              <Button type="button" variant="outline" disabled={busy !== null || !dirty} onClick={() => void save()}>
                {busy === 'save' ? t('builder.saving') : t('builder.save')}
              </Button>
              <Button type="button" disabled={busy !== null} onClick={() => void publish()}>
                {busy === 'publish' ? t('builder.publishing') : t('builder.publish')}
              </Button>
            </div>
          </div>
        </StickyFormActions>
      ) : null}

      {deleting ? (
        <DeleteFormDialog
          name={form.name}
          entryCount={form.entryCount}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await formsApi.remove(form.id, form.revision, form.entryCount > 0);
            navigate('/forms');
          }}
        />
      ) : null}
    </div>
  );
}

export default FormBuilderPage;

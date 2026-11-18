import { useEffect, useState, useCallback } from 'react';
import { slugify, type CustomFieldType, type NewsletterCustomField, type NewsletterTag } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';
import { describeDeleteError } from '../describe-delete-error.js';
import { customFieldTypeLabels } from '../lib/labels.js';

/** Backend requires tag codes / field keys to match this pattern. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Normalise free-text into a backend-valid code: lowercase, diacritics folded,
 * non-alphanumerics collapsed to underscores, trimmed. A leading digit still
 * fails `CODE_RE`, so callers validate the result before sending.
 *
 * The generator is `slugify` from `@endora-commerce/contracts`, **imported, never
 * re-implemented** (issues #239, #245). The private NFD one-liner it started as
 * did not fold `ł` — U+0142 has no canonical decomposition, so the strip had
 * nothing to remove — it *deleted* it: `Metody płatności` produced
 * `metody_p_atnosci`, a code with a hole in it that the operator could not
 * connect to anything typed.
 *
 * `_` is this caller's separator, passed explicitly, because the stored tag
 * code grammar is `^[a-z][a-z0-9_]*$` and every other caller kebab-cases. There
 * is no length option: the backend caps the column, not this prefill.
 *
 * Codes already stored are **not** migrated (owner's ruling, 2026-08-19): only
 * two developer environments exist, so renaming live tags buys nobody
 * anything. New codes are correct from here on.
 */
function slugifyCode(input: string): string {
  return slugify(input, { separator: '_' });
}

export function TagsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const tn = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const canWrite = hasPermission('newsletter:write');
  const [tags, setTags] = useState<NewsletterTag[]>([]);
  const [fields, setFields] = useState<NewsletterCustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagCode, setTagCode] = useState('');
  const [tagName, setTagName] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [editTag, setEditTag] = useState<{ id: string; name: string; description: string } | null>(null);
  const [editField, setEditField] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(() => {
    newsletterClient.listTags().then((r) => setTags(r.items)).catch((e: unknown) => setError(String(e)));
    newsletterClient.listCustomFields().then((r) => setFields(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  /** Issue #1464 — a delete asks first, and runs inside the dialog. */
  async function confirmDeleteTag(tag: NewsletterTag): Promise<void> {
    setError(null);
    await confirm({
      title: tn('delete.tag.title'),
      message: tn('delete.tag.message', { name: tag.name, code: tag.code }),
      confirmLabel: tn('delete.tag.action'),
      destructive: true,
      action: async () => {
        await newsletterClient.deleteTag(tag.id);
        load();
      },
      describeError: describeDeleteError(tn),
    });
  }

  async function confirmDeleteField(field: NewsletterCustomField): Promise<void> {
    setError(null);
    await confirm({
      title: tn('delete.field.title'),
      message: tn('delete.field.message', { label: field.label, key: field.key }),
      confirmLabel: tn('delete.field.action'),
      destructive: true,
      action: async () => {
        await newsletterClient.deleteCustomField(field.id);
        load();
      },
      describeError: describeDeleteError(tn),
    });
  }

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const addTag = (): void =>
    void run(async () => {
      if (tagName.trim() === '') throw new Error(tn('tags.nameRequired'));
      const code = slugifyCode(tagCode.trim() || tagName);
      if (!CODE_RE.test(code)) {
        throw new Error(tn('tags.codeInvalid'));
      }
      await newsletterClient.createTag({ code, name: tagName.trim() });
      setTagCode('');
      setTagName('');
    });

  const addField = (): void =>
    void run(async () => {
      if (fieldLabel.trim() === '') throw new Error(tn('fields.labelRequired'));
      const key = slugifyCode(fieldKey.trim() || fieldLabel);
      if (!CODE_RE.test(key)) {
        throw new Error(tn('fields.keyInvalid'));
      }
      await newsletterClient.createCustomField({ key, label: fieldLabel.trim(), type: fieldType });
      setFieldKey('');
      setFieldLabel('');
      setFieldType('text');
    });

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{tn('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={tn('tags.title')} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{tn('tags.section')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="flex flex-wrap items-start gap-3">
              <FormField label={tn('tags.field.name')} className="w-full max-w-[220px]">
                <Input value={tagName} onChange={(e) => setTagName(e.target.value)} />
              </FormField>
              <FormField label={tn('tags.field.code')} hint={tn('tags.field.codeHint')} className="w-full max-w-[220px]">
                <Input value={tagCode} onChange={(e) => setTagCode(e.target.value)} className="font-mono" />
              </FormField>
              <Button size="sm" onClick={addTag} className="mt-6">
                {tn('tags.add')}
              </Button>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {tags.map((t) => {
              const et = editTag && editTag.id === t.id ? editTag : null;
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  {et ? (
                    <div className="flex flex-1 flex-wrap items-start gap-3">
                      <span className="mt-8 font-mono text-xs text-muted-foreground">{t.code}</span>
                      <FormField label={tn('tags.field.name')} className="w-full max-w-[220px]">
                        <Input value={et.name} onChange={(e) => setEditTag({ ...et, name: e.target.value })} />
                      </FormField>
                      <FormField label={tn('tags.field.description')} className="w-full max-w-[260px]">
                        <Input
                          value={et.description}
                          onChange={(e) => setEditTag({ ...et, description: e.target.value })}
                        />
                      </FormField>
                    </div>
                  ) : (
                    <span>
                      <span className="font-mono text-xs">{t.code}</span> — {t.name}
                      {t.description ? <span className="text-muted-foreground"> · {t.description}</span> : null}
                    </span>
                  )}
                  {canWrite ? (
                    <div className="flex items-center gap-1">
                      {et ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void run(async () => {
                                if (et.name.trim() === '') throw new Error(tn('tags.nameRequired'));
                                await newsletterClient.updateTag(t.id, {
                                  name: et.name.trim(),
                                  description: et.description.trim() === '' ? null : et.description.trim(),
                                });
                                setEditTag(null);
                              })
                            }
                          >
                            {tc('common.action.save')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditTag(null)}>
                            {tc('common.action.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditTag({ id: t.id, name: t.name, description: t.description ?? '' })}
                          >
                            {tc('common.action.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void confirmDeleteTag(t)}>
                            {tc('common.action.delete')}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {tags.length === 0 ? <p className="text-sm text-muted-foreground">{tn('tags.empty')}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{tn('fields.section')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="flex flex-wrap items-start gap-3">
              <FormField label={tn('fields.field.label')} className="w-full max-w-[220px]">
                <Input value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} />
              </FormField>
              <FormField label={tn('fields.field.key')} hint={tn('fields.field.keyHint')} className="w-full max-w-[220px]">
                <Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} className="font-mono" />
              </FormField>
              <FormField label={tn('fields.field.type')} className="w-full max-w-[160px]">
                <Select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
                  {customFieldTypeLabels.options(tn).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button size="sm" onClick={addField} className="mt-6">
                {tn('fields.add')}
              </Button>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {fields.map((f) => {
              const ef = editField && editField.id === f.id ? editField : null;
              return (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                  {ef ? (
                    <div className="flex flex-1 flex-wrap items-start gap-3">
                      <span className="mt-8 font-mono text-xs text-muted-foreground">{f.key}</span>
                      <FormField label={tn('fields.field.label')} className="w-full max-w-[260px]">
                        <Input value={ef.label} onChange={(e) => setEditField({ ...ef, label: e.target.value })} />
                      </FormField>
                      <span className="mt-8 text-xs text-muted-foreground">({customFieldTypeLabels.label(tn, f.type)})</span>
                    </div>
                  ) : (
                    <span>
                      <span className="font-mono text-xs">{f.key}</span> — {f.label} ({customFieldTypeLabels.label(tn, f.type)})
                    </span>
                  )}
                  {canWrite ? (
                    <div className="flex items-center gap-1">
                      {ef ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void run(async () => {
                                if (ef.label.trim() === '') throw new Error(tn('fields.labelRequired'));
                                await newsletterClient.updateCustomField(f.id, { label: ef.label.trim() });
                                setEditField(null);
                              })
                            }
                          >
                            {tc('common.action.save')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditField(null)}>
                            {tc('common.action.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditField({ id: f.id, label: f.label })}
                          >
                            {tc('common.action.edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void confirmDeleteField(f)}
                          >
                            {tc('common.action.delete')}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {fields.length === 0 ? <p className="text-sm text-muted-foreground">{tn('fields.empty')}</p> : null}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default TagsPage;

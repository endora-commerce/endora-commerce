import { useEffect, useState, useCallback } from 'react';
import { slugify, type CustomFieldType, type NewsletterCustomField, type NewsletterTag } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

/** Backend requires tag codes / field keys to match this pattern. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;
const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'boolean', 'date'];

/**
 * Normalise free-text into a backend-valid code: lowercase, diacritics folded,
 * non-alphanumerics collapsed to underscores, trimmed. A leading digit still
 * fails `CODE_RE`, so callers validate the result before sending.
 *
 * The generator is `slugify` from `@b2b/contracts`, **imported, never
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
      if (tagName.trim() === '') throw new Error('Tag name is required.');
      const code = slugifyCode(tagCode.trim() || tagName);
      if (!CODE_RE.test(code)) {
        throw new Error('Code must start with a letter and use only lowercase letters, digits and underscores.');
      }
      await newsletterClient.createTag({ code, name: tagName.trim() });
      setTagCode('');
      setTagName('');
    });

  const addField = (): void =>
    void run(async () => {
      if (fieldLabel.trim() === '') throw new Error('Field label is required.');
      const key = slugifyCode(fieldKey.trim() || fieldLabel);
      if (!CODE_RE.test(key)) {
        throw new Error('Key must start with a letter and use only lowercase letters, digits and underscores.');
      }
      await newsletterClient.createCustomField({ key, label: fieldLabel.trim(), type: fieldType });
      setFieldKey('');
      setFieldLabel('');
      setFieldType('text');
    });

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Newsletter — Tags &amp; fields" description="Segmentation tags and custom subscriber fields." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input placeholder="code (optional)" value={tagCode} onChange={(e) => setTagCode(e.target.value)} className="max-w-[160px]" />
                <Input placeholder="name" value={tagName} onChange={(e) => setTagName(e.target.value)} className="max-w-[200px]" />
                <Button size="sm" onClick={addTag}>
                  Add tag
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Code uses lowercase letters, digits and underscores. Spaces and other characters are converted
                automatically; leave it empty to derive one from the name.
              </p>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {tags.map((t) => {
              const et = editTag && editTag.id === t.id ? editTag : null;
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  {et ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                      <Input
                        value={et.name}
                        placeholder="name"
                        onChange={(e) => setEditTag({ ...et, name: e.target.value })}
                        className="max-w-[200px]"
                      />
                      <Input
                        value={et.description}
                        placeholder="description"
                        onChange={(e) => setEditTag({ ...et, description: e.target.value })}
                        className="max-w-[240px]"
                      />
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
                                if (et.name.trim() === '') throw new Error('Tag name is required.');
                                await newsletterClient.updateTag(t.id, {
                                  name: et.name.trim(),
                                  description: et.description.trim() === '' ? null : et.description.trim(),
                                });
                                setEditTag(null);
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditTag(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditTag({ id: t.id, name: t.name, description: t.description ?? '' })}
                          >
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void run(() => newsletterClient.deleteTag(t.id))}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Custom subscriber fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input placeholder="key (optional)" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} className="max-w-[160px]" />
                <Input placeholder="label" value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} className="max-w-[200px]" />
                <Select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                  className="max-w-[130px]"
                >
                  {CUSTOM_FIELD_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {ty}
                    </option>
                  ))}
                </Select>
                <Button size="sm" onClick={addField}>
                  Add field
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Key uses lowercase letters, digits and underscores. Spaces and other characters are converted
                automatically; leave it empty to derive one from the label. Key and type cannot be changed later.
              </p>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {fields.map((f) => {
              const ef = editField && editField.id === f.id ? editField : null;
              return (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                  {ef ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{f.key}</span>
                      <Input
                        value={ef.label}
                        placeholder="label"
                        onChange={(e) => setEditField({ ...ef, label: e.target.value })}
                        className="max-w-[240px]"
                      />
                      <span className="text-xs text-muted-foreground">({f.type})</span>
                    </div>
                  ) : (
                    <span>
                      <span className="font-mono text-xs">{f.key}</span> — {f.label} ({f.type})
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
                                if (ef.label.trim() === '') throw new Error('Field label is required.');
                                await newsletterClient.updateCustomField(f.id, { label: ef.label.trim() });
                                setEditField(null);
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditField(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditField({ id: f.id, label: f.label })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void run(() => newsletterClient.deleteCustomField(f.id))}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

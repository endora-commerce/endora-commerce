import { useEffect, useState, useCallback, type FormEvent, type ReactNode } from 'react';
import { ListPlus, Plus, Tags } from 'lucide-react';
import { slugify, type CustomFieldType, type NewsletterCustomField, type NewsletterTag } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, FormField, Input, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
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
  // Issue #1439 (DS-05): the add forms are dialogs opened from each section's header.
  const [adding, setAdding] = useState<'tag' | 'field' | null>(null);
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
        <SectionHeader title={tn('tags.section')} addLabel={canWrite ? tn('tags.add') : null} onAdd={() => setAdding('tag')} />
        <CardContent className="space-y-3">
          {tags.length === 0 ? (
            <EmptyState icon={<Tags size={20} />} title={tn('tags.empty')} description={tn('tags.emptyBody')} />
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
        </CardContent>
      </Card>
      <Card>
        <SectionHeader title={tn('fields.section')} addLabel={canWrite ? tn('fields.add') : null} onAdd={() => setAdding('field')} />
        <CardContent className="space-y-3">
          {fields.length === 0 ? (
            <EmptyState icon={<ListPlus size={20} />} title={tn('fields.empty')} description={tn('fields.emptyBody')} />
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
        </CardContent>
      </Card>
      {adding === 'tag' ? (
        <TagDialog
          onClose={() => setAdding(null)}
          onCreated={() => {
            setAdding(null);
            load();
          }}
        />
      ) : null}
      {adding === 'field' ? (
        <FieldDialog
          onClose={() => setAdding(null)}
          onCreated={() => {
            setAdding(null);
            load();
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/**
 * A section's header: its title and, for an operator who may write, an outline
 * *Add …*. Outline, not filled: the screen manages two lists and neither add is
 * its one primary (issue #1441, DS-07; Von Restorff).
 */
function SectionHeader(props: { title: string; addLabel: string | null; onAdd: () => void }): ReactNode {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle>{props.title}</CardTitle>
      {props.addLabel ? (
        <Button variant="outline" size="sm" onClick={props.onAdd}>
          <Plus />
          {props.addLabel}
        </Button>
      ) : null}
    </CardHeader>
  );
}

/** The submit and cancel row both create dialogs share; the submit is the dialog's one primary. */
function DialogActions(props: { busy: boolean; submitLabel: string; onCancel: () => void }): ReactNode {
  const tc = useTranslation('core');
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button className="min-h-11 sm:min-h-9" type="button" variant="outline" disabled={props.busy} onClick={props.onCancel}>
        {tc('common.action.cancel')}
      </Button>
      <Button className="min-h-11 sm:min-h-9" type="submit" disabled={props.busy} aria-busy={props.busy}>
        {props.busy ? tc('common.state.saving') : props.submitLabel}
      </Button>
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create a tag. The name is required; the code is derived from it when left
 * empty (Tesler). A missing name or an invalid code is marked on its field; a
 * server refusal stays inside the dialog with what was typed.
 */
function TagDialog(props: { onClose: () => void; onCreated: () => void }): ReactNode {
  const tn = useTranslation('newsletter');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (name.trim() === '') {
      setErrors({ name: tn('tags.nameRequired') });
      return;
    }
    const derived = slugifyCode(code.trim() || name);
    if (!CODE_RE.test(derived)) {
      setErrors({ code: tn('tags.codeInvalid') });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await newsletterClient.createTag({ code: derived, name: name.trim() });
      props.onCreated();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <ModalDialog title={tn('tags.dialog.title')} busy={busy} dismissOnScrim={false} onClose={props.onClose}>
      <form noValidate className="space-y-4" onSubmit={(event): void => void submit(event)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={tn('tags.field.name')} error={errors.name} required>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={tn('tags.field.code')} hint={tn('tags.field.codeHint')} error={errors.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
        </FormField>
        <DialogActions busy={busy} submitLabel={tn('tags.add')} onCancel={props.onClose} />
      </form>
    </ModalDialog>
  );
}

/** Create a custom subscriber field; the key is derived from the label when left empty. */
function FieldDialog(props: { onClose: () => void; onCreated: () => void }): ReactNode {
  const tn = useTranslation('newsletter');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [errors, setErrors] = useState<{ label?: string; key?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (label.trim() === '') {
      setErrors({ label: tn('fields.labelRequired') });
      return;
    }
    const derived = slugifyCode(key.trim() || label);
    if (!CODE_RE.test(derived)) {
      setErrors({ key: tn('fields.keyInvalid') });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await newsletterClient.createCustomField({ key: derived, label: label.trim(), type });
      props.onCreated();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <ModalDialog title={tn('fields.dialog.title')} busy={busy} dismissOnScrim={false} onClose={props.onClose}>
      <form noValidate className="space-y-4" onSubmit={(event): void => void submit(event)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={tn('fields.field.label')} error={errors.label} required>
          <Input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </FormField>
        <FormField label={tn('fields.field.key')} hint={tn('fields.field.keyHint')} error={errors.key}>
          <Input value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
        </FormField>
        <FormField label={tn('fields.field.type')}>
          <Select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
            {customFieldTypeLabels.options(tn).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <DialogActions busy={busy} submitLabel={tn('fields.add')} onCancel={props.onClose} />
      </form>
    </ModalDialog>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default TagsPage;

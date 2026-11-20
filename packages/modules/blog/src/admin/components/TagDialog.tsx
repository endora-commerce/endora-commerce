import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ERROR_CODES, type BlogTagDetail } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { Button, FormField, Input } from '@endora-commerce/admin-kit/ui';
import { useDerivedKey } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient } from '../api/blog-client.js';
import { apiErrorCode } from './list-errors.js';

/** A tag code: lower-case letters, digits and hyphens, 1–64, not starting or ending with a hyphen. */
const TAG_CODE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TAG_CODE_MAX = 64;

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

export interface TagFormErrors {
  name?: string;
  code?: string;
}

/**
 * The tag form's refusals, before anything is sent: a name, and a code of the
 * shape the server takes. Exported for the tests.
 */
export function validateTagForm(
  form: { name: string; code: string },
  t: (key: string) => string,
): TagFormErrors {
  const errors: TagFormErrors = {};
  if (!form.name.trim()) errors.name = t('tagList.validation.nameRequired');
  if (!TAG_CODE.test(form.code)) errors.code = t('tagList.validation.codeInvalid');
  return errors;
}

export interface TagDialogProps {
  /** The tag to edit; without one the dialog creates a tag. */
  tag?: BlogTagDetail | null;
  onClose: () => void;
  /** After a successful save, with the code it was saved under. */
  onSaved: (code: string) => void;
}

/**
 * Create or edit a blog tag in a dialog (issue #1538, UX audit CONTENT-21),
 * opened from the list's *New tag* or a row's *Edit*, instead of a form card
 * drawn open above the list. Three fields: the code follows the name while
 * creating, until the operator types one (Tesler); each refusal is said at its
 * field and linked to it; a code already taken is the server's refusal, shown
 * at the code.
 */
export function TagDialog({ tag = null, onClose, onSaved }: TagDialogProps): ReactNode {
  const t = useTranslation('blog');
  const formId = useId();
  const editing = tag !== null;
  const [name, setName] = useState(tag ? pickName(tag.name, tag.code) : '');
  const [code, setCode] = useState(tag?.code ?? '');
  const [description, setDescription] = useState(tag ? pickName(tag.description, '') : '');
  const [errors, setErrors] = useState<TagFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const codeField = useDerivedKey({
    source: name,
    value: code,
    onChange: setCode,
    maxLength: TAG_CODE_MAX,
    enabled: !editing,
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const sentCode = codeField.commit();
    const found = validateTagForm({ name, code: sentCode }, t);
    setErrors(found);
    setFailure(null);
    if (found.name || found.code) return;
    setSaving(true);
    try {
      if (tag) {
        await blogClient.patchTag(tag.id, {
          name: { 'en-US': name.trim() },
          code: sentCode,
          description: description.trim() ? { 'en-US': description.trim() } : null,
          version: tag.version,
        });
      } else {
        await blogClient.createTag({
          name: { 'en-US': name.trim() },
          code: sentCode,
          ...(description.trim() ? { description: { 'en-US': description.trim() } } : {}),
        });
      }
      onSaved(sentCode);
    } catch (err) {
      if (apiErrorCode(err) === ERROR_CODES.BLOG_TAG_CODE_TAKEN) {
        setErrors({ code: t('tagList.validation.codeTaken') });
      } else {
        setFailure(t('tagList.saveFailed'));
      }
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={editing ? t('tagList.editTag') : t('tagList.newTag')}
      onClose={onClose}
      busy={saving}
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {saving ? t('common.saving') : editing ? t('tagList.saveTag') : t('tagList.createTag')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormField label={t('tagList.nameLabel')} required error={errors.name}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <FormField label={t('tagList.codeLabel')} required error={errors.code}>
          <Input
            value={code}
            onChange={codeField.onChange}
            onBlur={codeField.onBlur}
            className="font-mono"
            placeholder={t('tagList.codePlaceholder')}
          />
        </FormField>
        <FormField label={t('tagList.descriptionLabel')}>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </FormField>
        {/* Mounted before it has text, so a failure that arrives is announced. */}
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      </form>
    </ModalDialog>
  );
}

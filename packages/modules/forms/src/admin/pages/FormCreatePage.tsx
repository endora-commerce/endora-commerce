import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FORMS_LIMITS, formKeySchema, type FormLanguagesResponse } from '@endora-commerce/contracts';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, Input, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { formsApi } from '../api.js';
import { errorMessage } from '../lib/errors.js';

/**
 * Creating a form (`specs/170-forms-module/` User Story 1, US1-1): a name, an optional key (made from
 * the name when left empty, R-4) and the default language — one of the storefront languages. The
 * new draft opens in the builder with one empty section.
 */
export function FormCreatePage(): ReactNode {
  const t = useTranslation('forms');
  const navigate = useNavigate();
  const nameId = useId();
  const keyId = useId();
  const languageId = useId();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [languages, setLanguages] = useState<FormLanguagesResponse | null>(null);
  const [language, setLanguage] = useState('');
  const [nameError, setNameError] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    formsApi
      .languages()
      .then((answer) => {
        if (!alive) return;
        setLanguages(answer);
        setLanguage((current) => current || answer.defaultLanguage);
      })
      .catch((failure: unknown) => {
        if (alive) setError(errorMessage(failure, t('create.error.generic')));
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    const keyInvalid = key !== '' && !formKeySchema.safeParse(key).success;
    setNameError(trimmed === '');
    setKeyError(keyInvalid);
    if (trimmed === '' || keyInvalid || language === '') return;
    setBusy(true);
    setError(null);
    try {
      const created = await formsApi.create({ name: trimmed, ...(key !== '' ? { key } : {}), defaultLanguage: language });
      navigate(`/forms/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure, t('create.error.generic')));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('create.title')} description={t('create.description')} back={{ label: t('create.back'), to: '/forms' }} />
      <Card>
        <CardContent className="pt-6">
          <form noValidate onSubmit={(event) => void submit(event)} className="max-w-xl space-y-4">
            <p className="text-xs text-muted-foreground">{t('create.requiredHint')}</p>
            <div className="space-y-1">
              <Label htmlFor={nameId}>{t('create.name')} *</Label>
              <Input
                id={nameId}
                value={name}
                maxLength={FORMS_LIMITS.nameChars}
                required
                aria-required="true"
                aria-invalid={nameError || undefined}
                {...(nameError ? { 'aria-describedby': `${nameId}-error` } : {})}
                onChange={(event) => setName(event.target.value)}
              />
              {nameError ? (
                <p id={`${nameId}-error`} className="text-xs text-destructive">
                  {t('create.error.name')}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor={keyId}>{t('create.key')}</Label>
              <Input
                id={keyId}
                value={key}
                maxLength={FORMS_LIMITS.keyChars}
                aria-invalid={keyError || undefined}
                aria-describedby={`${keyId}-hint`}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
              />
              <p id={`${keyId}-hint`} className={cn('text-xs', keyError ? 'text-destructive' : 'text-muted-foreground')}>
                {keyError ? t('issues.invalid_key') : t('create.keyHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={languageId}>{t('create.language')}</Label>
              <Select
                id={languageId}
                value={language}
                disabled={languages === null}
                aria-describedby={`${languageId}-hint`}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {(languages?.languages ?? []).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
              <p id={`${languageId}-hint`} className="text-xs text-muted-foreground">
                {t('create.languageHint')}
              </p>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <StickyFormActions>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {t('create.submit')}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/forms')} disabled={busy}>
                  {t('create.cancel')}
                </Button>
              </div>
            </StickyFormActions>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default FormCreatePage;

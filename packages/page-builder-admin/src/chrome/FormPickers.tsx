'use client';

import { useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import { PB_DATA_METADATA, PB_FIELD_INPUT_CLASS } from '@endora-commerce/page-builder-core';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/170-forms-module/` contracts/blocks-and-storefront.md §6 (FR-004, US2-2) — the form of a
 * `forms.Form` block, picked from the forms the editor may see rather than typed as an id.
 *
 * The list is the `forms` module's own admin list (`GET /api/v1/admin/forms?pageSize=100`), read
 * over HTTP as the newsletter pickers read the newsletter's — `cms` gains no dependency on `forms`.
 * Each form shows its name and status; the list is read again whenever the window regains focus, so
 * a form created through "Create a new form" (the forms screen, in a new tab) can be picked without
 * reloading the editor. A stored id the list does not hold stays selected with a note; without
 * `forms:read` the control says why there is nothing to pick and keeps the stored id.
 *
 * The words are the `core` bundle's (`pageBuilder.formPicker.*`), as every picker of this package's:
 * this package belongs to no module, so it names no module's namespace (`check:admin-zones`).
 */

interface FormOption {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; options: FormOption[] }
  | { state: 'forbidden' }
  | { state: 'failed' };

/** The statuses a form can have (data-model §1), each with its word in the `core` bundle. */
const STATUSES = new Set(['draft', 'published', 'closed']);

export const FORM_PICKER_LIST_PATH = '/api/v1/admin/forms?pageSize=100';

/** Where a new form is created: the forms screen, opened in another tab. */
export const FORM_PICKER_CREATE_PATH = '/forms/new';

function readForm(item: unknown): FormOption | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const id = record['id'];
  if (typeof id !== 'string' || id === '') return null;
  const name = typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : id;
  return { id, name, status: typeof record['status'] === 'string' ? record['status'] : '' };
}

function useForms(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const load = useCallback((signal: { cancelled: boolean }) => {
    void apiClient
      .get<{ data?: { items?: unknown } }>(FORM_PICKER_LIST_PATH)
      .then((response) => {
        if (signal.cancelled) return;
        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        setLoaded({ state: 'ready', options: items.map(readForm).filter((form): form is FormOption => form !== null) });
      })
      .catch((error: unknown) => {
        if (signal.cancelled) return;
        setLoaded(error instanceof ApiError && error.status === 403 ? { state: 'forbidden' } : { state: 'failed' });
      });
  }, []);
  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    // A form created in another tab is offered once the editor's tab is back in front.
    const onFocus = (): void => load(signal);
    window.addEventListener('focus', onFocus);
    return (): void => {
      signal.cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);
  return loaded;
}

export function FormPickerControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (formId: string) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const t = useTranslation('core');
  const loaded = useForms();
  const noteId = useId();
  const formId = value ?? '';
  const readOnlyProps = readOnly === true ? { readOnly: true } : {};
  const create = (
    <a href={FORM_PICKER_CREATE_PATH} target="_blank" rel="noopener noreferrer" className="text-sm underline">
      {t('pageBuilder.formPicker.create')} <span className="sr-only">{t('pageBuilder.formPicker.newTab')}</span>
    </a>
  );

  if (loaded.state === 'forbidden' || loaded.state === 'failed') {
    return (
      <FieldLabel label={label} {...readOnlyProps}>
        <p role="note" className="text-sm">
          {t(loaded.state === 'forbidden' ? 'pageBuilder.formPicker.forbidden' : 'pageBuilder.formPicker.loadFailed')}
        </p>
      </FieldLabel>
    );
  }

  if (loaded.state === 'loading') {
    return (
      <FieldLabel label={label} {...readOnlyProps}>
        <select className={PB_FIELD_INPUT_CLASS} disabled value={formId} aria-busy="true" onChange={(): void => {}}>
          <option value={formId}>{t('pageBuilder.formPicker.choose')}</option>
        </select>
      </FieldLabel>
    );
  }

  const known = loaded.options.some((option) => option.id === formId);
  const missing = formId !== '' && !known;
  return (
    <FieldLabel label={label} {...readOnlyProps}>
      <select
        className={PB_FIELD_INPUT_CLASS}
        disabled={readOnly === true}
        value={formId}
        aria-invalid={missing || undefined}
        aria-describedby={missing ? noteId : undefined}
        onChange={(event): void => onChange(event.target.value)}
      >
        <option value="">{t('pageBuilder.formPicker.choose')}</option>
        {missing ? <option value={formId}>{formId}</option> : null}
        {loaded.options.map((option) => (
          <option key={option.id} value={option.id}>
            {STATUSES.has(option.status) ? `${option.name} (${t(`pageBuilder.formPicker.status.${option.status}`)})` : option.name}
          </option>
        ))}
      </select>
      {missing ? (
        <p id={noteId} role="note" className="text-sm">
          {t('pageBuilder.formPicker.notFound')}
        </p>
      ) : null}
      {create}
    </FieldLabel>
  );
}

/** The form of a `forms.Form` block, by id (FR-004); on the Data tab. */
export function createFormPickerField(label = 'Form'): CustomField<string | undefined> {
  return {
    type: 'custom',
    label,
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FormPickerControl value={value} onChange={onChange} readOnly={readOnly} label={field.label ?? label} />
    ),
  };
}

'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import { PB_FIELD_INPUT_CLASS } from '@endora-commerce/page-builder-core';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/169-page-builder-contact-form/` US7, FR-024, FR-025, research R-11 —
 * `newsletter.Signup`'s topic tag and subscriber attribute, picked from the
 * newsletter's own lists rather than typed.
 *
 * - A topic's tag: the tags by name (`GET /api/v1/admin/newsletter/tags`);
 *   the field stores the code it always stored.
 * - An attribute's custom field (`GET /api/v1/admin/newsletter/custom-fields`):
 *   the pick writes the key, the field's type and its label together — the
 *   type is safe to snapshot because a custom field's type never changes.
 *
 * On `BlogCategoryPicker`'s pattern: while the list loads, when it cannot be
 * read (no `newsletter:read`, the module off, the network) or when it is
 * empty, the control is the text box of before (with a type select for an
 * attribute); a stored value the list lacks stays selected, so nothing is lost
 * by opening the block.
 */

interface NewsletterTagOption {
  code: string;
  name: string;
}

interface NewsletterCustomFieldOption {
  key: string;
  label: string;
  type: NewsletterAttributeType;
}

const ATTRIBUTE_TYPES = ['text', 'number', 'boolean', 'date'] as const;
type NewsletterAttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** What an attribute's custom-field control reads and writes. */
export interface NewsletterAttributePick {
  key?: string;
  type?: NewsletterAttributeType;
  fieldLabel?: string;
}

type Loaded<T> = { state: 'loading' } | { state: 'ready'; options: T[] } | { state: 'failed' };

function useAdminList<T>(path: string, read: (item: Record<string, unknown>) => T | null): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void apiClient
      .get<{ data?: { items?: unknown } }>(path)
      .then((response) => {
        if (cancelled) return;
        const items = Array.isArray(response?.data?.items) ? (response.data.items as Record<string, unknown>[]) : [];
        const options = items.map(read).filter((option): option is T => option !== null);
        // Nothing to choose from: the text box, so a code can still be typed.
        setLoaded(options.length > 0 ? { state: 'ready', options } : { state: 'failed' });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: 'failed' });
      });
    return (): void => {
      cancelled = true;
    };
    // `read` is a module-level function for each list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return loaded;
}

function readTag(item: Record<string, unknown>): NewsletterTagOption | null {
  const code = item['code'];
  const name = item['name'];
  if (typeof code !== 'string' || code === '') return null;
  return { code, name: typeof name === 'string' && name !== '' ? name : code };
}

function readCustomField(item: Record<string, unknown>): NewsletterCustomFieldOption | null {
  const key = item['key'];
  const label = item['label'];
  const type = item['type'];
  if (typeof key !== 'string' || key === '' || !(ATTRIBUTE_TYPES as readonly unknown[]).includes(type)) return null;
  return { key, label: typeof label === 'string' && label !== '' ? label : key, type: type as NewsletterAttributeType };
}

const readOnlyProps = (readOnly: boolean | undefined): { readOnly?: true } => (readOnly === true ? { readOnly: true } : {});

export function NewsletterTagCodeControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (code: string) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const t = useTranslation('core');
  const loaded = useAdminList('/api/v1/admin/newsletter/tags', readTag);
  const code = value ?? '';

  if (loaded.state !== 'ready') {
    return (
      <FieldLabel label={label} {...readOnlyProps(readOnly)}>
        <input
          type="text"
          className={PB_FIELD_INPUT_CLASS}
          readOnly={readOnly === true}
          value={code}
          placeholder={t('pageBuilder.newsletterTag.codePlaceholder')}
          onChange={(event): void => onChange(event.target.value)}
        />
      </FieldLabel>
    );
  }

  const known = loaded.options.some((option) => option.code === code);
  return (
    <FieldLabel label={label} {...readOnlyProps(readOnly)}>
      <select
        className={PB_FIELD_INPUT_CLASS}
        disabled={readOnly === true}
        value={code}
        onChange={(event): void => onChange(event.target.value)}
      >
        <option value="">{t('pageBuilder.newsletterTag.choose')}</option>
        {code !== '' && !known ? <option value={code}>{code}</option> : null}
        {loaded.options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

export function NewsletterCustomFieldControl({
  value,
  onPick,
  readOnly,
  label,
}: {
  value: NewsletterAttributePick;
  onPick: (pick: NewsletterAttributePick) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const t = useTranslation('core');
  const loaded = useAdminList('/api/v1/admin/newsletter/custom-fields', readCustomField);
  const key = value.key ?? '';
  const type = value.type ?? 'text';

  if (loaded.state !== 'ready') {
    return (
      <>
        <FieldLabel label={label} {...readOnlyProps(readOnly)}>
          <input
            type="text"
            className={PB_FIELD_INPUT_CLASS}
            readOnly={readOnly === true}
            value={key}
            placeholder={t('pageBuilder.newsletterField.keyPlaceholder')}
            onChange={(event): void => onPick({ key: event.target.value, type })}
          />
        </FieldLabel>
        <FieldLabel label={t('pageBuilder.newsletterField.type')} {...readOnlyProps(readOnly)}>
          <select
            className={PB_FIELD_INPUT_CLASS}
            disabled={readOnly === true}
            value={type}
            onChange={(event): void => onPick({ key, type: event.target.value as NewsletterAttributeType })}
          >
            {ATTRIBUTE_TYPES.map((option) => (
              <option key={option} value={option}>
                {t(`pageBuilder.newsletterField.types.${option}`)}
              </option>
            ))}
          </select>
        </FieldLabel>
      </>
    );
  }

  const known = loaded.options.some((option) => option.key === key);
  return (
    <FieldLabel label={label} {...readOnlyProps(readOnly)}>
      <select
        className={PB_FIELD_INPUT_CLASS}
        disabled={readOnly === true}
        value={key}
        onChange={(event): void => {
          const picked = loaded.options.find((option) => option.key === event.target.value);
          onPick(picked ? { key: picked.key, type: picked.type, fieldLabel: picked.label } : { key: event.target.value, type });
        }}
      >
        <option value="">{t('pageBuilder.newsletterField.choose')}</option>
        {key !== '' && !known ? <option value={key}>{key}</option> : null}
        {loaded.options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

const ITEM_FIELD_RE = /^([A-Za-z_]\w*)\[(\d+)\]\.\w+$/;

/** The array item a field of an array item belongs to (`attributes[2].key` → the third attribute). */
function attributeAt(props: unknown, name: string): Record<string, unknown> | undefined {
  const match = ITEM_FIELD_RE.exec(name);
  if (!match) return undefined;
  const list = (props as Record<string, unknown> | null | undefined)?.[match[1]!];
  const item = Array.isArray(list) ? list[Number(match[2])] : undefined;
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined;
}

/**
 * `props` with `pick` written into the array item the field `name`
 * (`attributes[1].key`) belongs to — the key, the type and the field's label
 * together, the item's other props kept. A key typed by hand (no label in the
 * pick) drops the label picked for an earlier key. `null` when `name` names
 * no array item.
 */
export function withNewsletterAttributePick(
  props: Record<string, unknown>,
  name: string,
  pick: NewsletterAttributePick,
): Record<string, unknown> | null {
  const match = ITEM_FIELD_RE.exec(name);
  if (!match) return null;
  const listKey = match[1]!;
  const index = Number(match[2]);
  const list = Array.isArray(props[listKey]) ? [...(props[listKey] as unknown[])] : [];
  const current = (list[index] && typeof list[index] === 'object' ? list[index] : {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current, ...pick };
  if (pick.fieldLabel === undefined && pick.key !== current['key']) delete next['fieldLabel'];
  list[index] = next;
  return { ...props, [listKey]: list };
}

/** A topic's tag of `newsletter.Signup`, by code (feature 169, FR-024). */
export function createNewsletterTagCodeField(label = 'Newsletter tag'): CustomField<string | undefined> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <NewsletterTagCodeControl value={value} onChange={onChange} readOnly={readOnly} label={field.label ?? label} />
    ),
  };
}

function NewsletterCustomFieldPuckControl({
  name,
  value,
  onChange,
  readOnly,
  label,
}: {
  name: string;
  value: string | undefined;
  onChange: (key: string) => void;
  readOnly: boolean | undefined;
  label: string;
}): ReactElement {
  const selectedItem = usePageBuilderPuck((state) => state.selectedItem);
  const getSelectorForId = usePageBuilderPuck((state) => state.getSelectorForId);
  const dispatch = usePageBuilderPuck((state) => state.dispatch);
  const item = attributeAt(selectedItem?.props, name);
  const type = item?.['type'];
  const fieldLabel = item?.['fieldLabel'];
  const current: NewsletterAttributePick = {
    ...(value !== undefined ? { key: value } : {}),
    ...((ATTRIBUTE_TYPES as readonly unknown[]).includes(type) ? { type: type as NewsletterAttributeType } : {}),
    ...(typeof fieldLabel === 'string' ? { fieldLabel } : {}),
  };

  const onPick = (pick: NewsletterAttributePick): void => {
    // The key is this field's value; the type and the label are its siblings, which a field of an array
    // item cannot write — so the whole item is replaced in the selected block, in one step.
    const props = selectedItem ? withNewsletterAttributePick(selectedItem.props as Record<string, unknown>, name, pick) : null;
    const selector = selectedItem ? getSelectorForId(String(selectedItem.props.id)) : undefined;
    if (!selectedItem || !props || !selector) {
      onChange(pick.key ?? '');
      return;
    }
    dispatch({
      type: 'replace',
      destinationIndex: selector.index,
      destinationZone: selector.zone,
      data: { ...selectedItem, props: props as typeof selectedItem.props },
    });
  };

  return <NewsletterCustomFieldControl value={current} onPick={onPick} readOnly={readOnly} label={label} />;
}

/** A subscriber attribute's custom field of `newsletter.Signup`: writes `key`, `type` and `fieldLabel` (FR-025). */
export function createNewsletterCustomFieldField(label = 'Custom field'): CustomField<string | undefined> {
  return {
    type: 'custom',
    label,
    render: ({ name, value, onChange, readOnly, field }): ReactElement => (
      <NewsletterCustomFieldPuckControl
        name={name}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? label}
      />
    ),
  };
}

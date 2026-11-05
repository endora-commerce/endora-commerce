import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { AdminProductContentList } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { MultiSelect } from '@endora-commerce/admin-kit/ui';
import { ScopedFieldGrid, type ScopedFieldControlProps } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import { EditorField, useProductEditor } from './editor/editor-context.js';
import { PRODUCT_CONTENT_LANGUAGES, ProductContentCard, type ProductContentCardBlocker } from './ProductContentCard.js';
import { BooleanControl, NumberControl, SelectControl, TextControl, type SelectOption } from './editor/scoped-controls.js';

/**
 * The product's Attributes tab at the editor scope (feature 174, T027 / T100;
 * `contracts/editor-ui.md` §4).
 *
 * Every attribute of the product's set is one `attribute:<key>` field of the read, with its
 * scope set derived from the definition: a text attribute is set at Global, per channel or per
 * channel and language; any other type at Global or per channel; a non-scopable attribute at
 * Global only. The value at the scope is a plain value — never a per-language map — so a text
 * attribute renders as text at every scope (US1 #2, the F2 regression).
 *
 * The option lists of select attributes come from the attribute definitions, read once per set.
 *
 * A Page Builder content attribute (`specs/172-product-content-attributes/`, FR-020) is no scoped
 * value — the read does not list it — but a card below the fields: its label, a chip per editing
 * language, a summary and **Edit content**, which opens the product content screen. The cards come
 * from the content summaries (`GET …/content`, research R-3), read once per saved attribute set,
 * and are the same at every scope: a document is per language, and its own screen edits every one.
 */

interface SetAttribute {
  id: string;
  key: string;
}

interface AttributeOption {
  id: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  sortOrder: number;
}

const OPTION_TYPES = new Set(['enum', 'select', 'multiselect']);

/** A label in the admin's language (`pl` reads `pl-PL`), then English, then any. */
function pickLabel(label: Record<string, string>, fallback: string, language = 'en'): string {
  const entries = Object.entries(label);
  const own = entries.find(([code]) => code === language || code.split('-')[0] === language)?.[1];
  return own ?? label['en-US'] ?? entries[0]?.[1] ?? fallback;
}

type ContentAttribute = AdminProductContentList['attributes'][number];

/** Never called: the card only counts the editor's contributors (Z15). */
const NO_EDIT = (): void => undefined;

/** Why a content card offers no editing, or `null` (172 contracts/admin-surfaces.md §4). */
function contentCardBlocker(input: { savedSetId: string; stagedSetId: string | undefined; editors: number }): ProductContentCardBlocker {
  // The content screen judges membership against the saved set, so an unsaved choice blocks it.
  if (input.stagedSetId !== undefined && input.stagedSetId !== input.savedSetId) return 'saveSetFirst';
  if (input.editors === 0) return 'noEditor';
  return null;
}

/** A value read as text, whatever it is; an object is never stringified into the field. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function ProductAttributesTab(): ReactNode {
  const t = useTranslation('catalog');
  const adminLanguage = useContext(AppLanguageContext)?.language ?? 'en';
  const ctx = useProductEditor();
  const data = ctx.state.data;
  const setId = data?.product.attributeSetId ?? '';
  const [options, setOptions] = useState<Record<string, SelectOption[]>>({});
  const [content, setContent] = useState<ContentAttribute[]>([]);
  const staged = ctx.state.staged.get('product:attributeSetId');
  const stagedSetId = staged?.op === 'set' && typeof staged.value === 'string' ? staged.value : undefined;

  // Feature 172 — the content summaries of the saved set's content attributes, once per set.
  useEffect(() => {
    if (!setId) {
      setContent([]);
      return undefined;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await apiClient.get<{ data: AdminProductContentList }>(
          `/api/v1/admin/catalog/products/${encodeURIComponent(ctx.productId)}/content`,
        );
        if (!cancelled) setContent([...(res.data?.attributes ?? [])].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)));
      } catch {
        // No cards rather than a broken tab: the ordinary values do not depend on this read.
        if (!cancelled) setContent([]);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [ctx.productId, setId]);

  // Z15 — whether anyone contributes the content editor, counted with the same zone the content
  // screen mounts, so the card and the screen cannot disagree.
  const contentEditors = useAdminZone('product.content.editor', {
    productId: ctx.productId,
    attributeKey: '',
    language: PRODUCT_CONTENT_LANGUAGES[0],
    data: null,
    onChange: NO_EDIT,
  });

  useEffect(() => {
    if (!setId || !data) return undefined;
    const optionKeys = new Set(data.attributes.filter((a) => OPTION_TYPES.has(a.valueType)).map((a) => a.key));
    if (optionKeys.size === 0) return undefined;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const set = await apiClient.get<{ data: { attributes: SetAttribute[] } }>(
          `/api/v1/admin/catalog/attribute-sets/${encodeURIComponent(setId)}`,
        );
        const entries = await Promise.all(
          (set.data.attributes ?? [])
            .filter((a) => optionKeys.has(a.key))
            .map(async (a) => {
              const res = await apiClient.get<{ data: { items: AttributeOption[] } }>(
                `/api/v1/admin/catalog/attributes/${encodeURIComponent(a.id)}/options`,
              );
              const list = [...(res.data.items ?? [])]
                .sort((x, y) => x.sortOrder - y.sortOrder)
                .map((o) => ({ value: o.value, label: pickLabel(o.label, o.labelDefault, adminLanguage) }));
              return [a.key, list] as const;
            }),
        );
        if (!cancelled) setOptions(Object.fromEntries(entries));
      } catch {
        // The values still render; a select without its options shows the stored value.
      }
    })();
    return (): void => {
      cancelled = true;
    };
    // The option lists depend on the set only, not on the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  if (!data) return null;
  if (data.attributes.length === 0 && content.length === 0) {
    return <div className="b2b-help">{t('productEditor.attributes.empty')}</div>;
  }
  const blocker = contentCardBlocker({ savedSetId: setId, stagedSetId, editors: contentEditors.length });

  return (
    <div className="b2b-col" style={{ gap: 16 }}>
      <p className="b2b-help" style={{ marginTop: 0 }}>
        {t('productEditor.attributes.scopedHelp')}
      </p>
      <ScopedFieldGrid>
        {data.attributes.map((attr) => {
          const label = pickLabel(attr.label, attr.key, adminLanguage);
          const opts = options[attr.key] ?? [];
          const render = (p: ScopedFieldControlProps<unknown>): ReactNode => {
            switch (attr.valueType) {
              case 'boolean':
                return (
                  <BooleanControl
                    {...(p as unknown as ScopedFieldControlProps<boolean>)}
                    value={typeof p.value === 'boolean' ? p.value : null}
                    trueLabel={t('productEditor.attributes.yes')}
                    falseLabel={t('productEditor.attributes.no')}
                  />
                );
              case 'number':
              case 'price':
                return (
                  <NumberControl
                    {...(p as unknown as ScopedFieldControlProps<number>)}
                    value={typeof p.value === 'number' ? p.value : null}
                    integer={false}
                  />
                );
              case 'enum':
              case 'select':
                return <SelectControl {...(p as ScopedFieldControlProps<string>)} value={asText(p.value)} options={opts} />;
              case 'multiselect': {
                const selected = Array.isArray(p.value) ? (p.value as string[]) : [];
                if (p.readOnly) {
                  const text = selected.map((v) => opts.find((o) => o.value === v)?.label ?? v).join(', ');
                  return <TextControl {...(p as ScopedFieldControlProps<string>)} value={text || null} onChange={(): void => undefined} />;
                }
                return (
                  <MultiSelect
                    options={opts}
                    selected={selected}
                    onChange={(next): void => p.onChange(next.length === 0 ? null : next)}
                    placeholder={t('productEditor.attributes.selectNone')}
                    ariaLabel={label}
                  />
                );
              }
              case 'date':
                return (
                  <TextControl
                    {...(p as ScopedFieldControlProps<string>)}
                    value={asText(p.value)?.slice(0, 10) ?? null}
                  />
                );
              default:
                return <TextControl {...(p as ScopedFieldControlProps<string>)} value={asText(p.value)} />;
            }
          };
          return (
              <EditorField<unknown>
                key={attr.key}
                fieldPath={`attribute:${attr.key}`}
                label={label}
                textField={attr.valueType === 'string'}
                emptyMeaning={t('productEditor.emptyMeaning.noValue')}
                note={
                  <AdminZone
                    name="product.editor.field.after"
                    props={{ productId: ctx.productId, fieldPath: `attributeValues.${attr.key}`, scope: ctx.state.scope, languageCodes: null }}
                  />
                }
                render={render}
              />
          );
        })}
        {content.map((attr) => (
          <ProductContentCard
            key={attr.attributeId}
            productId={ctx.productId}
            attributeKey={attr.key}
            label={pickLabel(attr.label, attr.labelDefault || attr.key, adminLanguage)}
            languages={[...new Set<string>([...PRODUCT_CONTENT_LANGUAGES, ...attr.languages.map((status) => status.language)])]}
            stored={attr.languages}
            preferredLanguage={PRODUCT_CONTENT_LANGUAGES[0]}
            blocker={blocker}
          />
        ))}
      </ScopedFieldGrid>
    </div>
  );
}

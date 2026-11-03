import type { ReactNode } from 'react';
import { CategoryTreePicker, OrganizationPickerMulti, ScopedFieldGrid, type ScopedFieldControlProps } from '@endora-commerce/admin-kit/components';
import { Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { PRODUCT_NAME_MAX } from '@endora-commerce/contracts';
import { EditorField, globalOnlyView, useProductEditor } from './editor-context.js';
import { SelectControl, TextControl, TextareaControl, WindowControl, type WindowValue } from './scoped-controls.js';
import { ProductUrlRedirects } from '../ProductUrlRedirects.js';

/**
 * Feature 170 (T095, T100, T102; `contracts/editor-ui.md` §4, §6, §11) — the Details tab at the
 * editor scope: Identity (global only), Content (name, URL key, description), Availability
 * (status, audience, publication window) and Categories (global only). Every field is a
 * `ScopedField`; nothing here saves on its own.
 *
 * The URL key renders here, outside the `product.editor.seo` zone, so it stays when `seo` is
 * off (§11).
 */

export interface DetailsTabProps {
  attributeSets: ReadonlyArray<{ id: string; code: string; isSystem: boolean }>;
  categories: ReadonlyArray<{ id: string; parentCategoryId: string | null; name: Record<string, string>; slug: string; sortOrder: number }>;
  categoriesLoading: boolean;
}

type Audience = { visibility: 'public' | 'logged_in_only' | 'organization_restricted'; allowedOrganizationIds: string[] };
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="space-y-2">
      <h3 className="b2b-label">{title}</h3>
      <ScopedFieldGrid>{children}</ScopedFieldGrid>
    </section>
  );
}

export function DetailsTab({ attributeSets, categories, categoriesLoading }: DetailsTabProps): ReactNode {
  const t = useTranslation('catalog');
  const ctx = useProductEditor();
  const data = ctx.state.data;
  if (!data) return null;
  const product = data.product;
  const scope = ctx.state.scope;
  const zoneProps = (fieldPath: string) => ({ productId: ctx.productId, fieldPath, scope, languageCodes: null });
  const orgName = new Map(data.organizations.map((o) => [o.id, o.name]));
  const categoryName = (id: string): string => {
    const category = categories.find((c) => c.id === id);
    return category ? (category.name['en-US'] ?? Object.values(category.name)[0] ?? category.slug) : id.slice(0, 8);
  };

  return (
    <div className="b2b-col" style={{ gap: 18 }}>
      <AdminZone name="product.editor.details.before" props={{ productId: ctx.productId }} />

      <Section title={t('productEditor.section.identity')}>
        <EditorField<string>
          fieldPath="product:sku"
          label={t('productEditor.field.sku')}
          view={globalOnlyView(product.sku, true)}
          globalOnly
          required
          render={(p): ReactNode => <TextControl {...p} mono maxLength={255} />}
        />
        <EditorField<string>
          fieldPath="product:type"
          label={t('productEditor.field.type')}
          view={globalOnlyView(t(`productEditor.type.${product.type}`))}
          globalOnly
          note={scope.level === 'global' ? t('productEditor.field.type.fixed') : undefined}
          render={(p): ReactNode => <Input {...p.inputProps} readOnly value={p.value ?? ''} />}
        />
        <EditorField<string>
          fieldPath="product:attributeSetId"
          label={t('productEditor.field.attributeSet')}
          view={globalOnlyView(product.attributeSetId, true)}
          globalOnly
          required
          render={(p): ReactNode => (
            <SelectControl
              {...p}
              options={attributeSets.map((s) => ({
                value: s.id,
                label: `${s.code}${s.isSystem ? t('productEditor.attributeSet.systemSuffix') : ''}`,
              }))}
            />
          )}
        />
      </Section>

      <Section title={t('productEditor.section.content')}>
        <EditorField<string>
          fieldPath="name"
          label={t('productEditor.field.name')}
          textField
          note={<AdminZone name="product.editor.field.after" props={zoneProps('name')} />}
          render={(p): ReactNode => <TextControl {...p} maxLength={PRODUCT_NAME_MAX} />}
        />
        <EditorField<string>
          fieldPath="urlKey"
          label={t('productEditor.field.urlKey')}
          note={scope.level === 'global' ? t('productEditor.field.urlKey.help') : undefined}
          render={(p): ReactNode => <TextControl {...p} mono />}
        />
        <EditorField<string>
          fieldPath="description"
          label={t('productEditor.field.description')}
          textField
          wide
          emptyMeaning={t('productEditor.emptyMeaning.nothingShown')}
          note={<AdminZone name="product.editor.field.after" props={zoneProps('description')} />}
          render={(p): ReactNode => <TextareaControl {...p} rows={4} />}
        />
        <ProductUrlRedirects productId={ctx.productId} canWrite={!ctx.readOnly} />
      </Section>

      <Section title={t('productEditor.section.availability')}>
        <EditorField<string>
          fieldPath="status"
          label={t('productEditor.field.status')}
          note={
            <>
              {t('productEditor.field.status.help')}
              {product.archivedAt ? <> {t('productEditor.field.status.archivedNote')}</> : null}
            </>
          }
          render={(p): ReactNode => (
            <SelectControl
              {...p}
              options={[
                { value: 'active', label: t('productEditor.statusValue.active') },
                { value: 'inactive', label: t('productEditor.statusValue.inactive') },
              ]}
            />
          )}
        />
        <EditorField<Audience>
          fieldPath="audience"
          label={t('productEditor.field.visibility')}
          render={(p): ReactNode => <AudienceControl {...p} orgName={orgName} />}
        />
        <EditorField<WindowValue>
          fieldPath="window"
          label={t('productEditor.field.publishWindow')}
          wide
          emptyMeaning={t('productEditor.emptyMeaning.noLimit')}
          note={t('productEditor.field.publishWindow.help')}
          render={(p): ReactNode => (
            <WindowControl {...p} fromLabel={t('productEditor.field.publishFrom')} untilLabel={t('productEditor.field.publishUntil')} />
          )}
        />
      </Section>

      <Section title={t('productEditor.section.categories')}>
        <EditorField<string[]>
          fieldPath="product:categoryIds"
          label={t('productEditor.section.categories')}
          view={globalOnlyView(product.categoryIds)}
          globalOnly
          wide
          note={
            <>
              {t('productEditor.section.categories.help')}
              <AdminZone name="product.editor.field.after" props={zoneProps('categories')} />
            </>
          }
          render={(p): ReactNode =>
            p.readOnly ? (
              <Input {...p.inputProps} readOnly value={(p.value ?? []).map(categoryName).join('; ')} />
            ) : (
              <div id={p.inputProps.id} tabIndex={-1} aria-describedby={p.inputProps['aria-describedby']}>
                <CategoryTreePicker
                  categories={[...categories]}
                  selectedIds={p.value ?? []}
                  onChange={(ids: string[]): void => p.onChange(ids)}
                  loading={categoriesLoading}
                />
              </div>
            )
          }
        />
      </Section>
    </div>
  );
}

/** Audience: the visibility select and, for a restricted audience, the organizations. */
function AudienceControl(props: ScopedFieldControlProps<Audience> & { orgName: Map<string, string> }): ReactNode {
  const t = useTranslation('catalog');
  const value = props.value ?? { visibility: 'public', allowedOrganizationIds: [] };
  const visibilityLabel = (v: string): string => t(`productEditor.visibility.${v}`);
  if (props.readOnly) {
    const orgs = value.allowedOrganizationIds.map((id) => props.orgName.get(id) ?? id.slice(0, 8)).join(', ');
    return (
      <Input
        {...props.inputProps}
        readOnly
        value={value.visibility === 'organization_restricted' && orgs ? `${visibilityLabel(value.visibility)}: ${orgs}` : visibilityLabel(value.visibility)}
      />
    );
  }
  return (
    <div className="space-y-2">
      <SelectControl
        value={value.visibility}
        readOnly={false}
        inputProps={props.inputProps}
        options={VISIBILITIES.map((v) => ({ value: v, label: visibilityLabel(v) }))}
        onChange={(next): void =>
          props.onChange({ ...value, visibility: (next ?? 'public') as Audience['visibility'] })
        }
      />
      {value.visibility === 'organization_restricted' ? (
        <OrganizationPickerMulti
          id={`${props.inputProps.id}-orgs`}
          value={value.allowedOrganizationIds}
          selectedLabels={Object.fromEntries([...props.orgName].map(([id, name]) => [id, { name }]))}
          onChange={(ids: string[]): void => props.onChange({ ...value, allowedOrganizationIds: ids })}
          placeholder={t('productEditor.scopeControls.audience.organizationsPlaceholder')}
          emptyMessage={t('productEditor.scopeControls.audience.organizationsEmpty')}
          ariaLabel={t('productEditor.scopeControls.audience.organizationsAria')}
        />
      ) : null}
    </div>
  );
}

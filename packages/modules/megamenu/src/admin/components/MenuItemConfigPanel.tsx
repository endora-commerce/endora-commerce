import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  MEGAMENU_CLICK_NAVIGATES_KINDS,
  MEGAMENU_LABEL_INHERITING_KINDS,
  MEGAMENU_TAB_KINDS,
  type MegamenuAlignment,
  type MegamenuAudience,
  type MegamenuItem,
  type MegamenuItemKind,
  type MegamenuPresentation,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Checkbox, FormField, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import {
  AssetFieldPicker,
  CategorySelect,
  CmsBlockPicker,
  CmsPagePicker,
  CustomerGroupPicker,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export type IndexedItem = MegamenuItem & { id: string; parentId: string | null };

/** Every kind, in the order the editor offers them: structure first, then links, then media. */
const KIND_OPTIONS: ReadonlyArray<{ kind: MegamenuItemKind; labelKey: string }> = [
  { kind: 'group', labelKey: 'itemKind.group' },
  { kind: 'category-link', labelKey: 'itemKind.categoryLink' },
  { kind: 'category-tree', labelKey: 'itemKind.categoryTree' },
  { kind: 'cms-page-link', labelKey: 'itemKind.cmsPageLink' },
  { kind: 'external-link', labelKey: 'itemKind.externalLink' },
  { kind: 'button', labelKey: 'itemKind.button' },
  { kind: 'asset', labelKey: 'itemKind.asset' },
  { kind: 'cms-block-embed', labelKey: 'itemKind.cmsBlockEmbed' },
];

const PRESENTATIONS: readonly MegamenuPresentation[] = ['link', 'dropdown', 'mega', 'catalog'];
const ALIGNMENTS: readonly MegamenuAlignment[] = ['start', 'end'];
const AUDIENCE_KINDS: ReadonlyArray<MegamenuAudience['kind']> = ['everyone', 'guests', 'signed_in', 'customer_groups'];

interface MenuItemConfigPanelProps {
  item: IndexedItem | null;
  languages: string[];
  onChange: (next: IndexedItem) => void;
}

/**
 * Kind-driven form. The same component covers every menu item kind; fields
 * swap based on `item.kind`. Heavy validation (target existence, asset kind
 * match, language-in-channel-scope, the navigation bar's tree rules) lives
 * server-side — this surface only collects raw values.
 *
 * Feature 168: a top-level item is a **tab** of the navigation bar, so it
 * alone shows how it opens and where it sits, and it is offered only the kinds
 * a tab may be. Every item has an audience.
 */
export function MenuItemConfigPanel({
  item,
  languages,
  onChange,
}: MenuItemConfigPanelProps): ReactNode {
  const t = useTranslation('megamenu');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const setLabel = (lang: string, value: string): void => {
    if (!item) return;
    onChange({ ...item, labels: { ...item.labels, [lang]: value } });
  };

  const setTarget = (next: Partial<MegamenuItem['target']>): void => {
    if (!item) return;
    onChange({ ...item, target: { ...item.target, ...next } } as IndexedItem);
  };

  const setAudience = (audience: MegamenuAudience): void => {
    if (!item) return;
    onChange({ ...item, audience });
  };

  const setKind = (kind: MegamenuItemKind): void => {
    if (!item) return;
    onChange({
      ...item,
      kind,
      target: defaultTargetFor(kind) as MegamenuItem['target'],
    } as IndexedItem);
  };

  useEffect(() => {
    setError(null);
  }, [item?.id]);

  if (!item) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        {t('itemConfig.empty')}
      </p>
    );
  }

  const isTab = item.parentId === null;
  const inherits = MEGAMENU_LABEL_INHERITING_KINDS.has(item.kind);
  const kinds = KIND_OPTIONS.filter((option) => !isTab || MEGAMENU_TAB_KINDS.has(option.kind));

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={`${fieldId}-kind`}>{t('fields.kind')}</Label>
        <Select
          id={`${fieldId}-kind`}
          value={item.kind}
          onChange={(event) => setKind(event.target.value as MegamenuItemKind)}
        >
          {kinds.map((option) => (
            <option key={option.kind} value={option.kind}>
              {t(option.labelKey)}
            </option>
          ))}
        </Select>
      </div>

      {isTab ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-presentation`}>{t('fields.presentation')}</Label>
            <Select
              id={`${fieldId}-presentation`}
              value={item.presentation ?? 'mega'}
              onChange={(event) =>
                onChange({ ...item, presentation: event.target.value as MegamenuPresentation })
              }
            >
              {PRESENTATIONS.map((presentation) => (
                <option key={presentation} value={presentation}>
                  {t(`presentation.${presentation}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-alignment`}>{t('fields.alignment')}</Label>
            <Select
              id={`${fieldId}-alignment`}
              value={item.alignment ?? 'start'}
              onChange={(event) => onChange({ ...item, alignment: event.target.value as MegamenuAlignment })}
            >
              {ALIGNMENTS.map((alignment) => (
                <option key={alignment} value={alignment}>
                  {t(`alignment.${alignment}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      {isTab && MEGAMENU_CLICK_NAVIGATES_KINDS.has(item.kind) && item.presentation !== 'link' ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${fieldId}-click-navigates`}
              checked={item.clickNavigates === true}
              onChange={(event) => onChange({ ...item, clickNavigates: event.target.checked })}
            />
            <Label htmlFor={`${fieldId}-click-navigates`}>{t('fields.clickNavigates')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('itemConfig.clickNavigatesHelp')}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>{t('fields.labelsPerLanguage')}</Label>
        {languages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('itemConfig.addBindingFirst')}
          </p>
        ) : null}
        {languages.map((lang) => (
          <div key={lang} className="grid grid-cols-12 items-center gap-2">
            <span className="col-span-2 font-mono text-xs text-muted-foreground">{lang}</span>
            <Input
              className="col-span-10"
              value={item.labels[lang] ?? ''}
              onChange={(event) => setLabel(lang, event.target.value)}
              placeholder={
                inherits
                  ? t('itemConfig.inheritedLabelPlaceholder')
                  : t('itemConfig.labelPlaceholder', { language: lang })
              }
            />
          </div>
        ))}
      </div>

      <KindSpecificFields item={item} setTarget={setTarget} />

      <AudienceFields audience={item.audience ?? { kind: 'everyone' }} onChange={setAudience} />
    </div>
  );
}

/**
 * Who sees the item (feature 168, FR-021). A customer-group audience lists one
 * picker per chosen group — the picker shows the group's name — and an empty
 * one to add the next.
 */
function AudienceFields({
  audience,
  onChange,
}: {
  audience: MegamenuAudience;
  onChange: (next: MegamenuAudience) => void;
}): ReactNode {
  const t = useTranslation('megamenu');
  const fieldId = useId();
  const groupIds = audience.kind === 'customer_groups' ? audience.customerGroupIds : [];
  const setGroups = (ids: string[]): void => {
    // An empty group list is not an audience the server accepts; the editor
    // keeps the choice open with no group rather than switching it for them.
    onChange({ kind: 'customer_groups', customerGroupIds: [...new Set(ids)] } as MegamenuAudience);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={`${fieldId}-audience`}>{t('fields.audience')}</Label>
      <Select
        id={`${fieldId}-audience`}
        value={audience.kind}
        onChange={(event) => {
          const kind = event.target.value as MegamenuAudience['kind'];
          onChange(kind === 'customer_groups' ? { kind, customerGroupIds: groupIds } : ({ kind } as MegamenuAudience));
        }}
      >
        {AUDIENCE_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`audience.${kind}`)}
          </option>
        ))}
      </Select>
      {audience.kind === 'customer_groups' ? (
        <div className="space-y-2">
          {groupIds.map((groupId, index) => (
            <div key={groupId} className="flex items-center gap-2">
              <CustomerGroupPicker
                className="flex-1"
                ariaLabel={t('itemConfig.customerGroupN', { index: index + 1 })}
                value={groupId}
                onChange={(next) =>
                  setGroups(next ? groupIds.map((id) => (id === groupId ? next : id)) : groupIds.filter((id) => id !== groupId))
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setGroups(groupIds.filter((id) => id !== groupId))}
              >
                {t('itemConfig.removeCustomerGroup')}
              </Button>
            </div>
          ))}
          <CustomerGroupPicker
            ariaLabel={t('itemConfig.addCustomerGroup')}
            value={null}
            onChange={(next) => {
              if (next) setGroups([...groupIds, next]);
            }}
          />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('itemConfig.audienceHelp')}</p>
    </div>
  );
}

function KindSpecificFields({
  item,
  setTarget,
}: {
  item: IndexedItem;
  setTarget: (next: Partial<MegamenuItem['target']>) => void;
}): ReactNode {
  const t = useTranslation('megamenu');
  const fieldId = useId();
  const target = item.target as Record<string, unknown>;
  const assetLabel = t(target.kind === 'video' ? 'fields.assetVideo' : 'fields.assetImage');

  switch (item.kind) {
    case 'category-link':
      return (
        <FormField label={t('fields.category')}>
          <CategorySelect
            value={typeof target.categoryId === 'string' && target.categoryId ? target.categoryId : null}
            onChange={(v) => setTarget({ categoryId: v ?? '' } as never)}
          />
        </FormField>
      );

    case 'cms-page-link':
      return (
        <FormField label={t('fields.cmsPage')}>
          <CmsPagePicker
            value={typeof target.pageId === 'string' && target.pageId ? target.pageId : null}
            onChange={(v) => setTarget({ pageId: v ?? '' } as never)}
          />
        </FormField>
      );

    case 'external-link':
      return (
        <div className="space-y-1">
          <Label>{t('fields.url')}</Label>
          <Input
            value={typeof target.url === 'string' ? target.url : ''}
            onChange={(event) => setTarget({ url: event.target.value } as never)}
            placeholder={t('placeholders.externalUrl')}
          />
        </div>
      );

    case 'button':
      return (
        <>
          <div className="space-y-1">
            <Label>{t('fields.linkTarget')}</Label>
            <Input
              value={typeof target.url === 'string' ? target.url : ''}
              onChange={(event) => setTarget({ url: event.target.value } as never)}
              placeholder="/promotions"
            />
          </div>
          <div className="space-y-1">
            <Label>{t('fields.variant')}</Label>
            <Select
              value={typeof target.variant === 'string' ? target.variant : 'primary'}
              onChange={(event) => setTarget({ variant: event.target.value } as never)}
            >
              <option value="primary">{t('variant.primary')}</option>
              <option value="secondary">{t('variant.secondary')}</option>
              <option value="ghost">{t('variant.ghost')}</option>
            </Select>
          </div>
        </>
      );

    case 'asset':
      return (
        <>
          <FormField label={assetLabel}>
            <AssetFieldPicker
              // The picker names its read-only input itself ("Asset"), and an
              // `aria-label` outranks the `<label for>`, so hand it the same name.
              ariaLabel={assetLabel}
              value={typeof target.assetId === 'string' ? target.assetId : ''}
              onChange={(id) => setTarget({ assetId: id } as never)}
              acceptMimePrefix={target.kind === 'video' ? 'video/' : 'image/'}
              allowUpload
            />
          </FormField>
          <div className="space-y-1">
            <Label>{t('fields.kind')}</Label>
            <Select
              value={typeof target.kind === 'string' ? target.kind : 'image'}
              onChange={(event) => setTarget({ kind: event.target.value } as never)}
            >
              <option value="image">{t('assetKind.image')}</option>
              <option value="video">{t('assetKind.video')}</option>
            </Select>
          </div>
        </>
      );

    case 'cms-block-embed':
      return (
        <>
          <FormField label={t('fields.cmsBlock')}>
            <CmsBlockPicker
              value={typeof target.blockId === 'string' && target.blockId ? target.blockId : null}
              onChange={(v) => setTarget({ blockId: v ?? '' } as never)}
            />
          </FormField>
          <div className="space-y-1">
            <Label>{t('fields.embedSide')}</Label>
            <Select
              value={typeof target.embedSide === 'string' ? target.embedSide : 'right'}
              onChange={(event) => setTarget({ embedSide: event.target.value } as never)}
            >
              <option value="left">{t('side.left')}</option>
              <option value="right">{t('side.right')}</option>
            </Select>
          </div>
        </>
      );

    case 'group':
      // A heading: its label is all there is to it.
      return null;

    case 'category-tree':
      return (
        <>
          <div className="space-y-1">
            <Label>{t('fields.rootCategory')}</Label>
            <CategorySelect
              ariaLabel={t('fields.rootCategory')}
              clearable
              value={typeof target.rootCategoryId === 'string' && target.rootCategoryId ? target.rootCategoryId : null}
              onChange={(v) => setTarget({ rootCategoryId: v ?? null } as never)}
            />
            <p className="text-xs text-muted-foreground">{t('itemConfig.rootCategoryHelp')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-depth`}>{t('fields.depth')}</Label>
            <Select
              id={`${fieldId}-depth`}
              value={String(typeof target.depth === 'number' ? target.depth : 2)}
              onChange={(event) => setTarget({ depth: Number(event.target.value) } as never)}
            >
              {[1, 2, 3].map((depth) => (
                <option key={depth} value={depth}>
                  {t('depth.levels', { count: depth })}
                </option>
              ))}
            </Select>
          </div>
        </>
      );
  }
}

export function defaultTargetFor(kind: MegamenuItemKind): Record<string, unknown> {
  switch (kind) {
    case 'category-link':
      return { categoryId: '' };
    case 'cms-page-link':
      return { pageId: '' };
    case 'external-link':
      return { url: 'https://' };
    case 'button':
      return { url: '/', variant: 'primary' };
    case 'asset':
      return { assetId: '', kind: 'image' };
    case 'cms-block-embed':
      return { blockId: '', embedSide: 'right' };
    case 'group':
      return {};
    case 'category-tree':
      return { rootCategoryId: null, depth: 2 };
  }
}

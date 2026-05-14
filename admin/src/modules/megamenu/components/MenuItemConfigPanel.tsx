import { useEffect, useState, type ReactNode } from 'react';
import type { MegamenuItem, MegamenuItemKind } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';

export type IndexedItem = MegamenuItem & { id: string; parentId: string | null };

interface MenuItemConfigPanelProps {
  item: IndexedItem | null;
  languages: string[];
  onChange: (next: IndexedItem) => void;
}

/**
 * Kind-driven form. The same component covers every menu item kind
 * (`category-link`, `cms-page-link`, `external-link`, `button`, `asset`,
 * `cms-block-embed`); fields swap based on `item.kind`. Heavy validation
 * (target existence, asset kind match, language-in-channel-scope) lives
 * server-side — this surface only collects raw values.
 */
export function MenuItemConfigPanel({
  item,
  languages,
  onChange,
}: MenuItemConfigPanelProps): ReactNode {
  const t = useTranslation('megamenu');
  const [error, setError] = useState<string | null>(null);

  const setLabel = (lang: string, value: string): void => {
    if (!item) return;
    onChange({ ...item, labels: { ...item.labels, [lang]: value } });
  };

  const setTarget = (next: Partial<MegamenuItem['target']>): void => {
    if (!item) return;
    onChange({ ...item, target: { ...item.target, ...next } } as IndexedItem);
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

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <Label>{t('fields.kind')}</Label>
        <Select value={item.kind} onChange={(event) => setKind(event.target.value as MegamenuItemKind)}>
          <option value="category-link">{t('itemKind.categoryLink')}</option>
          <option value="cms-page-link">{t('itemKind.cmsPageLink')}</option>
          <option value="external-link">{t('itemKind.externalLink')}</option>
          <option value="button">{t('itemKind.button')}</option>
          <option value="asset">{t('itemKind.asset')}</option>
          <option value="cms-block-embed">{t('itemKind.cmsBlockEmbed')}</option>
        </Select>
      </div>

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
              placeholder={t('itemConfig.labelPlaceholder', { language: lang })}
            />
          </div>
        ))}
      </div>

      <KindSpecificFields item={item} setTarget={setTarget} />
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
  const target = item.target as Record<string, unknown>;

  switch (item.kind) {
    case 'category-link':
      return (
        <div className="space-y-1">
          <Label>{t('fields.categoryId')}</Label>
          <Input
            value={typeof target.categoryId === 'string' ? target.categoryId : ''}
            onChange={(event) => setTarget({ categoryId: event.target.value } as never)}
            placeholder={t('placeholders.categoryUuid')}
          />
        </div>
      );

    case 'cms-page-link':
      return (
        <div className="space-y-1">
          <Label>{t('fields.cmsPageId')}</Label>
          <Input
            value={typeof target.pageId === 'string' ? target.pageId : ''}
            onChange={(event) => setTarget({ pageId: event.target.value } as never)}
            placeholder={t('placeholders.cmsPageUuid')}
          />
        </div>
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
          <div className="space-y-1">
            <Label>{t('fields.assetId')}</Label>
            <Input
              value={typeof target.assetId === 'string' ? target.assetId : ''}
              onChange={(event) => setTarget({ assetId: event.target.value } as never)}
              placeholder={t('placeholders.assetUuid')}
            />
          </div>
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
          <div className="space-y-1">
            <Label>{t('fields.cmsBlockId')}</Label>
            <Input
              value={typeof target.blockId === 'string' ? target.blockId : ''}
              onChange={(event) => setTarget({ blockId: event.target.value } as never)}
              placeholder={t('placeholders.cmsBlockUuid')}
            />
          </div>
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
  }
}

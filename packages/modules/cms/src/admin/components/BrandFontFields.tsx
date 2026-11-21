import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import type { BrandFontSource } from '@endora-commerce/contracts';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { AssetFieldPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const FACE_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
/** The schema's ceiling on files per family. */
const MAX_FACES = 8;

type AssetFont = Extract<BrandFontSource, { kind: 'asset' }>;

/** The source a kind switch starts from, keeping the family name and fallback already typed. */
function switchKind(current: BrandFontSource, kind: BrandFontSource['kind']): BrandFontSource {
  const family = current.kind === 'system' ? '' : current.family;
  const generic = current.kind === 'system' ? (current.stack === 'serif' ? 'serif' : 'sans-serif') : current.generic;
  if (kind === 'system') return { kind: 'system', stack: generic === 'serif' ? 'serif' : 'sans' };
  if (kind === 'stylesheet') return { kind: 'stylesheet', family, generic, url: '' };
  return { kind: 'asset', family, generic, faces: [{ weight: 400, style: 'normal', fileAssetId: '' }] };
}

/**
 * One brand font role — heading or body — as one of the three sources of
 * research R-5: a system stack, files from the asset library (the picker lists
 * font files only), or a font service's `https:` stylesheet (FR-006c). The
 * fallback generic family is what renders while the font loads and if it
 * fails to.
 */
export function BrandFontFields(props: {
  idPrefix: string;
  legend: string;
  value: BrandFontSource;
  onChange: (next: BrandFontSource) => void;
  disabled: boolean;
}): ReactElement {
  const t = useTranslation('cms');
  const { idPrefix, value, onChange, disabled } = props;

  const setFace = (index: number, patch: Partial<AssetFont['faces'][number]>): void => {
    if (value.kind !== 'asset') return;
    onChange({ ...value, faces: value.faces.map((face, i) => (i === index ? { ...face, ...patch } : face)) });
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{props.legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-kind`}>{t('brand.fonts.kind')}</Label>
          <Select
            id={`${idPrefix}-kind`}
            value={value.kind}
            disabled={disabled}
            onChange={(e): void => onChange(switchKind(value, e.target.value as BrandFontSource['kind']))}
          >
            <option value="system">{t('brand.fonts.kind.system')}</option>
            <option value="asset">{t('brand.fonts.kind.asset')}</option>
            <option value="stylesheet">{t('brand.fonts.kind.stylesheet')}</option>
          </Select>
        </div>
        {value.kind === 'system' ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-stack`}>{t('brand.fonts.stack')}</Label>
            <Select
              id={`${idPrefix}-stack`}
              value={value.stack}
              disabled={disabled}
              onChange={(e): void => onChange({ kind: 'system', stack: e.target.value as 'sans' | 'serif' | 'mono' })}
            >
              <option value="sans">{t('brand.fonts.stack.sans')}</option>
              <option value="serif">{t('brand.fonts.stack.serif')}</option>
              <option value="mono">{t('brand.fonts.stack.mono')}</option>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-family`}>{t('brand.fonts.family')}</Label>
              <Input
                id={`${idPrefix}-family`}
                value={value.family}
                disabled={disabled}
                maxLength={100}
                onChange={(e): void => onChange({ ...value, family: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-generic`}>{t('brand.fonts.generic')}</Label>
              <Select
                id={`${idPrefix}-generic`}
                value={value.generic}
                disabled={disabled}
                aria-describedby={`${idPrefix}-generic-hint`}
                onChange={(e): void => onChange({ ...value, generic: e.target.value as 'sans-serif' | 'serif' })}
              >
                <option value="sans-serif">{t('brand.fonts.generic.sans-serif')}</option>
                <option value="serif">{t('brand.fonts.generic.serif')}</option>
              </Select>
              <p id={`${idPrefix}-generic-hint`} className="text-xs text-muted-foreground">
                {t('brand.fonts.genericHint')}
              </p>
            </div>
          </>
        )}
        {value.kind === 'stylesheet' ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-url`}>{t('brand.fonts.url')}</Label>
            <Input
              id={`${idPrefix}-url`}
              type="url"
              inputMode="url"
              value={value.url}
              disabled={disabled}
              maxLength={2048}
              placeholder={t('brand.fonts.urlPlaceholder')}
              aria-describedby={`${idPrefix}-url-hint`}
              onChange={(e): void => onChange({ ...value, url: e.target.value.trim() })}
            />
            <p id={`${idPrefix}-url-hint`} className="text-xs text-muted-foreground">
              {t('brand.fonts.urlHint')}
            </p>
          </div>
        ) : null}
      </div>

      {value.kind === 'asset' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('brand.fonts.faces')}</p>
          <ul className="divide-y divide-border">
            {value.faces.map((face, index) => {
              const faceId = `${idPrefix}-face-${index}`;
              return (
                <li key={index} className="grid items-end gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[8rem_8rem_1fr_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${faceId}-weight`}>{t('brand.fonts.weight')}</Label>
                    <Select
                      id={`${faceId}-weight`}
                      value={String(face.weight)}
                      disabled={disabled}
                      onChange={(e): void => setFace(index, { weight: Number(e.target.value) })}
                    >
                      {FACE_WEIGHTS.map((weight) => (
                        <option key={weight} value={weight}>
                          {weight}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${faceId}-style`}>{t('brand.fonts.style')}</Label>
                    <Select
                      id={`${faceId}-style`}
                      value={face.style}
                      disabled={disabled}
                      onChange={(e): void => setFace(index, { style: e.target.value as 'normal' | 'italic' })}
                    >
                      <option value="normal">{t('brand.fonts.style.normal')}</option>
                      <option value="italic">{t('brand.fonts.style.italic')}</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${faceId}-file`}>{t('brand.fonts.file')}</Label>
                    <AssetFieldPicker
                      id={`${faceId}-file`}
                      value={face.fileAssetId}
                      acceptMimePrefix="font/"
                      disabled={disabled}
                      ariaLabel={t('brand.fonts.file')}
                      onChange={(fileAssetId): void => setFace(index, { fileAssetId })}
                    />
                  </div>
                  {!disabled && value.faces.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('brand.fonts.removeFace', { index: index + 1 })}
                      onClick={(): void => onChange({ ...value, faces: value.faces.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!disabled && value.faces.length < MAX_FACES ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(): void =>
                onChange({ ...value, faces: [...value.faces, { weight: 700, style: 'normal', fileAssetId: '' }] })
              }
            >
              {t('brand.fonts.addFace')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

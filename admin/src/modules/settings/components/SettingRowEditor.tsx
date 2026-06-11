import {
  useCallback,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { SettingDto } from '@b2b/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { ImageSettingInput } from './ImageSettingInput';

/**
 * String settings that hold an image URL get a file-upload editor (drag-and-drop
 * / file picker via the Assets Library) instead of a plain text input. Matched by
 * convention: a string-typed setting whose code names an image and ends in `_url`.
 */
function isImageUrlSetting(setting: SettingDto): boolean {
  return (
    setting.valueType === 'string' &&
    setting.code.includes('image') &&
    setting.code.endsWith('_url')
  );
}

export interface SettingDraft {
  /** Current text in the input. */
  text: string;
  /** Baseline; the draft is "dirty" when `text !== initialText`. */
  initialText: string;
}

interface Props {
  setting: SettingDto;
  draft: SettingDraft;
  /**
   * The channel context the row is being edited under. `null` means
   * the page is in "All channels" mode; otherwise the picked sales-
   * channel code. The row uses this to label per-channel state and to
   * decide whether a row is bound to the default or an explicit override.
   */
  channelContext: string | null;
  isCopied: boolean;
  resetting: boolean;
  onChange: (patch: Partial<SettingDraft>) => void;
  onCopyCode: () => void;
  onReset: () => void;
}

/**
 * Inline editor for one setting — always in edit mode. The Apply-to scope
 * lives at the page level (a single global channel context); the row only
 * carries the value the user is typing.
 */
export function SettingRowEditor({
  setting,
  draft,
  channelContext,
  isCopied,
  resetting,
  onChange,
  onCopyCode,
  onReset,
}: Props): ReactNode {
  const t = useTranslation('settings');
  const isDirty = isDraftDirty(draft);
  const isSecret = setting.valueType === 'secret';
  const overrideCount = setting.valuesByChannel.length;
  const source = effectiveSource(setting, channelContext);
  // Secret settings are redacted server-side (value === null); presence is
  // signalled through the isSet flags instead (feature 043, FR-021).
  const hasGlobalOverride = isSecret
    ? setting.globalValueIsSet === true
    : setting.globalValue !== null && setting.globalValue !== undefined;

  const setText = useCallback(
    (next: string) => onChange({ text: next }),
    [onChange],
  );

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border px-4 py-3 transition-colors',
        isDirty && 'border-amber-300 bg-amber-50/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{setting.name}</span>
            <button
              type="button"
              onClick={onCopyCode}
              title={
                isCopied
                  ? t('actions.copyCode.copied')
                  : `${t('actions.copyCode.label')}: ${setting.code}`
              }
              aria-label={`${t('actions.copyCode.label')}: ${setting.code}`}
              className={cn(
                'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isCopied && 'text-emerald-600 hover:text-emerald-600',
              )}
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {setting.valueType}
            </Badge>
            {channelContext === null && hasGlobalOverride && (
              <Badge variant="secondary" className="text-[10px]">
                {t('context.globalOverrideSet')}
              </Badge>
            )}
            {channelContext === null && !hasGlobalOverride && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {t('context.usingDefault')}
              </Badge>
            )}
            {channelContext !== null && source === 'channel-override' && (
              <Badge variant="secondary" className="text-[10px]">
                {t('context.channelOverridePresent')}
              </Badge>
            )}
            {channelContext !== null && source === 'global' && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {t('context.inheritsGlobal')}
              </Badge>
            )}
            {channelContext !== null && source === 'default' && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {t('context.usingDefault')}
              </Badge>
            )}
            {isDirty && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-900 hover:bg-amber-100"
              >
                {t('editor.dirty')}
              </Badge>
            )}
          </div>
          {setting.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={
            resetting ||
            (channelContext === null && !hasGlobalOverride) ||
            (channelContext !== null && source !== 'channel-override')
          }
          title={t('actions.resetToDefault')}
          className="shrink-0"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t('actions.reset')}
        </Button>
      </div>

      <div>
        {setting.enumOptions && setting.enumOptions.length > 0 ? (
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.text}
            onChange={(e) => setText(e.target.value)}
          >
            {setting.enumOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : isImageUrlSetting(setting) ? (
          <ImageSettingInput value={draft.text} onChange={setText} />
        ) : isSecret ? (
          <Input
            type="password"
            autoComplete="new-password"
            value={draft.text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              hasGlobalOverride || setting.valuesByChannel.some((v) => v.isSet)
                ? t('editor.placeholder.secretSet')
                : t('editor.placeholder.secretUnset')
            }
          />
        ) : (
          renderInput(setting.valueType, draft.text, setText, t)
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {isSecret ? (
          // No value previews for secrets — only the set / not-set fact.
          <span>
            {hasGlobalOverride ? t('editor.secretIsSet') : t('editor.secretNotSet')}
          </span>
        ) : (
          <>
            <span>
              {t('editor.defaultPrefix')} <code className="font-mono">{formatPreview(setting.defaultValue)}</code>
            </span>
            {hasGlobalOverride && (
              <>
                <span>·</span>
                <span>
                  {t('editor.globalPrefix')} <code className="font-mono">{formatPreview(setting.globalValue)}</code>
                </span>
              </>
            )}
          </>
        )}
        <span>·</span>
        <span>{t('editor.perChannelOverrides', { count: overrideCount })}</span>
      </div>
    </div>
  );
}

function formatPreview(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value === '' ? '""' : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderInput(
  valueType: SettingDto['valueType'],
  value: string,
  setValue: (v: string) => void,
  t: (key: string, params?: Record<string, string | number>) => string,
): ReactNode {
  if (valueType === 'boolean') {
    return (
      <select
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => setValue(e.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (valueType === 'json') {
    return (
      <textarea
        className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        placeholder={t('editor.placeholder.json')}
      />
    );
  }
  if (valueType === 'string_list') {
    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('editor.placeholder.stringList')}
      />
    );
  }
  return (
    <Input
      type={valueType === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

/**
 * Pick the value displayed in the input for the chosen channel context.
 *
 * Resolution chain mirrors the backend:
 *   per-channel override → setting.globalValue → setting.defaultValue
 *
 * "All channels" mode (`channelContext === null`) edits the global tier
 * directly: it shows `globalValue` when the admin has set one, otherwise
 * the manifest default. A specific channel falls back through the chain.
 */
export function deriveDisplayValue(
  setting: SettingDto,
  channelContext: string | null,
): string {
  // Secrets never round-trip back into the input — the server redacts the
  // value, and the editor is write-only ("enter a new value to replace").
  if (setting.valueType === 'secret') return '';
  const v = resolveEffective(setting, channelContext);
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function resolveEffective(
  setting: SettingDto,
  channelContext: string | null,
): unknown {
  if (channelContext !== null) {
    const override = setting.valuesByChannel.find(
      (entry) => entry.salesChannelCode === channelContext,
    );
    if (override) return override.value;
  }
  if (setting.globalValue !== null && setting.globalValue !== undefined) {
    return setting.globalValue;
  }
  return setting.defaultValue;
}

export type EffectiveSource = 'channel-override' | 'global' | 'default';

export function effectiveSource(
  setting: SettingDto,
  channelContext: string | null,
): EffectiveSource {
  const isSecret = setting.valueType === 'secret';
  if (channelContext !== null) {
    const entry = setting.valuesByChannel.find(
      (e) => e.salesChannelCode === channelContext,
    );
    if (entry && (!isSecret || entry.isSet === true)) return 'channel-override';
  }
  if (isSecret) {
    return setting.globalValueIsSet === true ? 'global' : 'default';
  }
  if (setting.globalValue !== null && setting.globalValue !== undefined) {
    return 'global';
  }
  return 'default';
}

export function parseValue(
  valueType: SettingDto['valueType'],
  text: string,
): unknown {
  switch (valueType) {
    case 'string':
    case 'secret':
      return text;
    case 'number':
      return Number(text);
    case 'boolean':
      return text === 'true';
    case 'string_list':
      return text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    case 'json':
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
  }
}

export function computeVersion(setting: SettingDto): string {
  return setting.version;
}

export function isDraftDirty(draft: SettingDraft): boolean {
  return draft.text !== draft.initialText;
}

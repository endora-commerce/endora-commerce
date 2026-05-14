import {
  useCallback,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { SettingDto } from '@b2b/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';

export interface SettingDraft {
  /** Current text in the input. */
  text: string;
  /** Baseline; the draft is "dirty" when `text !== initialText`. */
  initialText: string;
  /** Where the value will be written when the batch is saved. */
  scope: 'all' | 'subset';
  /** Sales-channel codes selected when `scope === 'subset'`. */
  subsetCodes: string[];
}

interface Props {
  setting: SettingDto;
  draft: SettingDraft;
  /** Union of every channel code visible in the platform. */
  availableChannelCodes: string[];
  isCopied: boolean;
  resetting: boolean;
  onChange: (patch: Partial<SettingDraft>) => void;
  onCopyCode: () => void;
  onReset: () => void;
}

/**
 * Inline editor for one setting — always in edit mode. Rendered one-per-row
 * inside a group card; the parent tracks dirty state and batches the writes.
 */
export function SettingRowEditor({
  setting,
  draft,
  availableChannelCodes,
  isCopied,
  resetting,
  onChange,
  onCopyCode,
  onReset,
}: Props): ReactNode {
  const t = useTranslation('settings');
  const inScopeCodes = setting.salesChannelCodes.length > 0
    ? setting.salesChannelCodes
    : availableChannelCodes;
  const isDirty = draft.text !== draft.initialText;
  const overrideCount = setting.valuesByChannel.length;

  const setText = useCallback(
    (next: string) => onChange({ text: next }),
    [onChange],
  );

  const toggleCode = useCallback(
    (code: string) => {
      const next = draft.subsetCodes.includes(code)
        ? draft.subsetCodes.filter((c) => c !== code)
        : [...draft.subsetCodes, code];
      onChange({ subsetCodes: next });
    },
    [draft.subsetCodes, onChange],
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
          <div className="flex items-center gap-2">
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
          disabled={resetting || overrideCount === 0}
          title={t('actions.resetToDefault')}
          className="shrink-0"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t('actions.reset')}
        </Button>
      </div>

      <div>{renderInput(setting.valueType, draft.text, setText)}</div>

      <div className="space-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="font-medium text-foreground">{t('editor.applyTo.label')}:</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`scope-${setting.code}`}
              checked={draft.scope === 'all'}
              onChange={() => onChange({ scope: 'all' })}
            />
            {t('editor.applyTo.allInScope', { count: inScopeCodes.length })}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`scope-${setting.code}`}
              checked={draft.scope === 'subset'}
              onChange={() => onChange({ scope: 'subset' })}
            />
            {t('editor.applyTo.subset')}
          </label>
        </div>
        {draft.scope === 'subset' && (
          <div className="flex flex-wrap gap-2 pl-1">
            {inScopeCodes.length === 0 && (
              <span className="text-muted-foreground">{t('editor.applyTo.subsetEmpty')}</span>
            )}
            {inScopeCodes.map((code) => (
              <label
                key={code}
                className="flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-xs"
              >
                <Checkbox
                  checked={draft.subsetCodes.includes(code)}
                  onChange={() => toggleCode(code)}
                />
                <span className="font-mono">{code}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
          <span>
            {t('editor.defaultPrefix')} <code className="font-mono">{formatPreview(setting.defaultValue)}</code>
          </span>
          <span>·</span>
          <span>{t('editor.perChannelOverrides', { count: overrideCount })}</span>
        </div>
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
        placeholder='{"key": "value"}'
      />
    );
  }
  if (valueType === 'string_list') {
    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="comma,separated,values"
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

export function deriveDisplayValue(setting: SettingDto): string {
  const v = setting.valuesByChannel[0]?.value ?? setting.defaultValue;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function parseValue(
  valueType: SettingDto['valueType'],
  text: string,
): unknown {
  switch (valueType) {
    case 'string':
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

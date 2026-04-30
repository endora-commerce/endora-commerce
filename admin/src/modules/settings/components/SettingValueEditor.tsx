import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import type { SetValueRequest, SettingDto } from '@b2b/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

interface Props {
  setting: SettingDto;
  /** Channel codes that exist in the platform; the union of in-scope channels. */
  availableChannelCodes: string[];
  onSubmit: (body: SetValueRequest & { expectedVersion?: string }) => Promise<void>;
  saving: boolean;
}

/**
 * Type-aware value input + apply-to-all/subset toggle. Renders the right input
 * for the setting's `valueType` and forwards a `SetValueRequest` to its
 * caller. Empty subset is guarded client-side; the server enforces it too.
 */
export function SettingValueEditor({
  setting,
  availableChannelCodes,
  onSubmit,
  saving,
}: Props): ReactNode {
  const initialValue = useMemo(() => deriveDisplayValue(setting), [setting]);
  const [valueText, setValueText] = useState<string>(initialValue);
  const [scope, setScope] = useState<'all' | 'subset'>('all');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);

  useEffect(() => {
    setValueText(initialValue);
    setScope('all');
    setSelectedCodes([]);
  }, [setting.code, initialValue]);

  const inScopeCodes = setting.salesChannelCodes.length > 0
    ? setting.salesChannelCodes
    : availableChannelCodes;

  function toggleCode(code: string): void {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function handleSubmit(): Promise<void> {
    const value = parseValue(setting.valueType, valueText);
    if (scope === 'all') {
      await onSubmit({ scope: 'all', value });
    } else {
      if (selectedCodes.length === 0) return;
      await onSubmit({ scope: 'subset', salesChannelCodes: selectedCodes, value });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">
          Value ({setting.valueType})
        </label>
        {renderInput(setting.valueType, valueText, setValueText)}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Apply to</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          all sales channels in scope ({inScopeCodes.length})
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={scope === 'subset'}
            onChange={() => setScope('subset')}
          />
          a chosen subset
        </label>
        {scope === 'subset' && (
          <div className="ml-5 space-y-1">
            {inScopeCodes.length === 0 && (
              <p className="text-sm text-muted-foreground">No channels in scope.</p>
            )}
            {inScopeCodes.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedCodes.includes(code)}
                  onChange={() => toggleCode(code)}
                />
                {code}
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <Button
          onClick={() => void handleSubmit()}
          disabled={saving || (scope === 'subset' && selectedCodes.length === 0)}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function deriveDisplayValue(setting: SettingDto): string {
  // Prefer the first per-channel value if present; otherwise the default.
  const v = setting.valuesByChannel[0]?.value ?? setting.defaultValue;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function parseValue(
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
        className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
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

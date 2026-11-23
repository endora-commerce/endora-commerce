import {
  useCallback,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Copy, RotateCcw } from 'lucide-react';
import type { SettingDto } from '@endora-commerce/contracts';
import {
  Button,
  FormField,
  Input,
  Switch,
  type FormFieldControlProps,
} from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { ImageSettingInput } from './ImageSettingInput.js';
import { AssetIdSettingInput } from './AssetIdSettingInput.js';
import { SellerCompanyDataInput, SELLER_COMPANY_DATA_CODE } from './SellerCompanyDataInput.js';
import { ConfigurationReferenceInput } from './ConfigurationReferenceInput.js';
import { useSettingLabels } from './setting-label.js';

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

/** String settings that store an Assets Library UUID (e.g. logo_asset_id). */
function isAssetIdSetting(setting: SettingDto): boolean {
  return setting.valueType === 'string' && setting.code.endsWith('_asset_id');
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
  /**
   * Feature 073 / FR-033 — the module that owns this setting is not effectively
   * present. The stored value is still shown (off is not uninstall), but every
   * input is disabled and the server refuses the write anyway, so a stale tab
   * cannot save through this row either.
   */
  readOnly?: boolean;
  /**
   * Issue #1518 (SHELL-09) — the id of the read-only reason the group states
   * once. A read-only row's control is described by it instead of carrying a
   * copy of the sentence of its own.
   */
  readOnlyReasonId?: string;
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
  readOnly = false,
  readOnlyReasonId,
  onChange,
  onCopyCode,
  onReset,
}: Props): ReactNode {
  const t = useTranslation('settings');
  const labels = useSettingLabels();
  const isMultiline = setting.valueType === 'string' && setting.multiline === true;
  // The line under the field is a hint, not a second copy of the value: a
  // multi-line text printed inline loses its line breaks and can be very long.
  const formatRaw = isMultiline ? formatMultilinePreview : formatPreview;
  const isBoolean = setting.valueType === 'boolean';
  const hasEnum = Boolean(setting.enumOptions && setting.enumOptions.length > 0);
  // Issue #1479 (UX audit SHELL-02) — the default and global values under the
  // field read in the operator's words: "On" / "Off", an option's label — not
  // `true`, `false` or a machine code.
  const preview = (value: unknown): string => {
    if (isBoolean && typeof value === 'boolean') {
      return value ? t('editor.booleanValue.on') : t('editor.booleanValue.off');
    }
    if (hasEnum && typeof value === 'string' && value !== '') {
      return labels.settingOption(setting, value);
    }
    return formatRaw(value);
  };
  const description = labels.settingDescription(setting);
  // Issue #930 — the owning module says the stored value is not in force.
  const notice = labels.settingNotice(setting);
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
    (next: string) => {
      if (readOnly) return;
      onChange({ text: next });
    },
    [onChange, readOnly],
  );

  // Issue #1478 (UX audit SHELL-01) — the row's controls are named by the
  // setting and described by its description, notice and read-only reason,
  // through the kit's `FormField`. A composite editor (an address block, an
  // asset or image picker) has no one element a `<label>` can point at, so it
  // is a group named by the setting instead.
  const isComposite =
    setting.code === SELLER_COMPANY_DATA_CODE ||
    isAssetIdSetting(setting) ||
    isImageUrlSetting(setting);
  // Issue #1518 (UX audit SHELL-09) — what the setting is on the left, its
  // control on the right (the kit's `SettingRow` shape, Jakob's Law): every
  // single-line control. A text area, a JSON value and a composite editor need
  // the row's width, so they keep the stacked field.
  const isWide = isComposite || isMultiline || setting.valueType === 'json';
  const facts = settingFacts({
    setting,
    channelContext,
    source,
    hasGlobalOverride,
    overrideCount,
    preview,
    t,
  });
  const hasDetails = Boolean(description) || Boolean(notice);

  return (
    <div
      data-dirty={isDirty ? 'true' : undefined}
      className={cn(
        // Issue #1437 (DS-03): a row of the group card, divided from the next by the list's rule,
        // not a bordered box of its own.
        'relative space-y-2 py-3',
        readOnly && 'opacity-70',
      )}
    >
      {/* Issue #1518 (SHELL-09) — a changed row is marked by a bar at its edge:
          a shape beside the row, not a badge in its label line and not a tint
          (so it is never colour alone, SC 1.4.1). The word is still there for a
          screen reader, beside the setting's name. */}
      {isDirty ? (
        <span
          aria-hidden="true"
          data-dirty-bar=""
          className="absolute inset-y-2 -left-3 w-1 rounded-full bg-primary"
        />
      ) : null}
      <FormField
        label={labels.settingName(setting)}
        group={isComposite}
        layout={isWide ? 'stack' : 'row'}
        // A single-line control keeps a fixed column; below about 12rem of
        // room for the name the control wraps under it instead of squeezing it.
        {...(isWide ? {} : { className: 'flex-wrap gap-y-2 [&>div:first-child]:basis-48' })}
        {...(readOnlyReasonId !== undefined && readOnly ? { describedBy: readOnlyReasonId } : {})}
        labelAddon={
          <>
            {/* The code is an identifier, not a label: it lives in this
                button's name and tooltip, not on the row (SHELL-09). */}
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
            {isDirty ? <span className="sr-only">{t('editor.dirty')}</span> : null}
          </>
        }
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={
              readOnly ||
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
        }
        // Issue #1522 (SHELL-23) — a description is one row's worth of copy
        // (at most 120 characters, `check:text-budget`), so it is read with the
        // control and not clamped.
        description={
          hasDetails ? (
            <>
              {description ? <p>{description}</p> : null}
              {notice ? (
                <p
                  role="status"
                  className="flex items-start gap-1 font-medium text-amber-800"
                >
                  <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{notice}</span>
                </p>
              ) : null}
            </>
          ) : undefined
        }
        {...(facts !== null ? { hint: facts } : {})}
      >
        {(control) => (
          <fieldset disabled={readOnly} className="contents">
            <div className={cn(isWide && 'w-full', !isWide && !(isBoolean && !hasEnum) && 'w-72 max-w-full')}>
              {setting.enumOptions && setting.enumOptions.length > 0 ? (
                <select
                  {...control}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={draft.text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={readOnly}
                >
                  {setting.enumOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {labels.settingOption(setting, opt)}
                    </option>
                  ))}
                </select>
              ) : setting.code === SELLER_COMPANY_DATA_CODE ? (
                <SellerCompanyDataInput value={draft.text} onChange={setText} />
              ) : isAssetIdSetting(setting) ? (
                <AssetIdSettingInput value={draft.text} onChange={setText} />
              ) : isImageUrlSetting(setting) ? (
                <ImageSettingInput value={draft.text} onChange={setText} />
              ) : setting.valueType === 'credential_ref' ? (
                <ConfigurationReferenceInput
                  control={control}
                  configurationType={setting.configurationType}
                  value={draft.text}
                  onChange={setText}
                />
              ) : isSecret ? (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  value={draft.text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={readOnly}
                  placeholder={
                    hasGlobalOverride || setting.valuesByChannel.some((v) => v.isSet)
                      ? t('editor.placeholder.secretSet')
                      : t('editor.placeholder.secretUnset')
                  }
                />
              ) : (
                renderInput(setting.valueType, draft.text, setText, t, readOnly, isMultiline, control)
              )}
            </div>
          </fieldset>
        )}
      </FormField>

      {/* What the module that declared this setting wants shown beside it — a
          preview of what the value amounts to, a consequence, a warning. This
          file does not know who contributes or what: it hands over which
          setting this is and what is in the field, and nothing comes back, so
          a contribution cannot change the value or hold up the save.

          Never for a secret: its draft is the one text on this screen that
          must not be handed to code this module did not write. */}
      {isSecret ? null : (
        <AdminZone
          name="settings.setting.after"
          props={{
            settingCode: setting.code,
            ownerModule: setting.ownerModule,
            channelCode: channelContext,
            // Only a `string` setting's text is its value; every other type's
            // field holds a spelling of the value that this file parses.
            draftText: setting.valueType === 'string' ? draft.text : null,
            dirty: isDirty,
          }}
        />
      )}
    </div>
  );
}

/**
 * Issue #1518 (UX audit SHELL-09) — the one muted line under a setting: where
 * the value in force comes from, said only when it is not simply the default.
 * It replaces five source badges and a footer that restated every row's
 * default ("Default: 30 · 0 per-channel overrides"). `null` when there is
 * nothing to say — a row at its default with no channel overriding it.
 */
function settingFacts(input: {
  setting: SettingDto;
  channelContext: string | null;
  source: EffectiveSource;
  hasGlobalOverride: boolean;
  overrideCount: number;
  preview: (value: unknown) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
}): ReactNode {
  const { setting, channelContext, source, hasGlobalOverride, overrideCount, preview, t } = input;
  const isSecret = setting.valueType === 'secret';
  const parts: ReactNode[] = [];
  if (channelContext !== null && source === 'global') {
    parts.push(<span key="inherits">{t('context.inheritsGlobal')}</span>);
  }
  if (isSecret) {
    // No value previews for secrets — only the set fact. "Not set" is the
    // default, and the field's placeholder already says it.
    if (source !== 'default') parts.push(<span key="secret">{t('editor.secretIsSet')}</span>);
  } else if (source !== 'default') {
    parts.push(
      <span key="default">
        {t('editor.defaultPrefix')} <code className="font-mono">{preview(setting.defaultValue)}</code>
      </span>,
    );
    if (channelContext !== null && source === 'channel-override' && hasGlobalOverride) {
      parts.push(
        <span key="global">
          {t('editor.globalPrefix')} <code className="font-mono">{preview(setting.globalValue)}</code>
        </span>,
      );
    }
  }
  if (channelContext === null && overrideCount > 0) {
    parts.push(<span key="overrides">{t('editor.perChannelOverrides', { count: overrideCount })}</span>);
  }
  if (parts.length === 0) return null;
  return (
    <span data-setting-facts="">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? ' · ' : null}
          {part}
        </span>
      ))}
    </span>
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

const MULTILINE_PREVIEW_LENGTH = 60;

/**
 * One short line standing for a multi-line value: its first line that has
 * text, without indentation, cut at {@link MULTILINE_PREVIEW_LENGTH}, with an
 * ellipsis whenever the value holds more than what is shown.
 */
function formatMultilinePreview(value: unknown): string {
  if (typeof value !== 'string' || value === '') return formatPreview(value);
  const firstLine = value.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? '';
  const shown = firstLine.slice(0, MULTILINE_PREVIEW_LENGTH);
  return shown === value ? shown : `${shown}…`;
}

function renderInput(
  valueType: SettingDto['valueType'],
  value: string,
  setValue: (v: string) => void,
  t: (key: string, params?: Record<string, string | number>) => string,
  readOnly: boolean,
  /** The setting is a `string` its manifest declares `multiline`. */
  multiline: boolean,
  /** The id and descriptions `FormField` wires the control with. */
  control: FormFieldControlProps,
): ReactNode {
  if (valueType === 'boolean') {
    // Issue #1479 (SHELL-02, owner decision DEC-04) — a switch, staged like
    // every other field: it changes the draft, and the page's one Save writes
    // it. The draft keeps its `"true"` / `"false"` spelling, which
    // `parseValue` reads; a value that is neither shows as off.
    return (
      <Switch
        {...control}
        checked={value === 'true'}
        onCheckedChange={(next) => setValue(next ? 'true' : 'false')}
        disabled={readOnly}
      />
    );
  }
  if (valueType === 'json') {
    return (
      <textarea
        {...control}
        className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        disabled={readOnly}
        placeholder={t('editor.placeholder.json')}
      />
    );
  }
  // A `string` setting its manifest declares `multiline`. The text is the
  // value: nothing here trims it or folds its lines, and a monospaced field
  // shows it the way a served text file will read.
  if (multiline) {
    return (
      <textarea
        {...control}
        className="min-h-[160px] w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        disabled={readOnly}
        spellCheck={false}
      />
    );
  }
  if (valueType === 'string_list') {
    return (
      <Input
        {...control}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={readOnly}
        placeholder={t('editor.placeholder.stringList')}
      />
    );
  }
  return (
    <Input
      {...control}
      type={valueType === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      disabled={readOnly}
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
    // Feature 058 — a credential_ref value is the referenced configuration code.
    case 'credential_ref':
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

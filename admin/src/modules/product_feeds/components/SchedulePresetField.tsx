import { useMemo, useState, type ReactNode } from 'react';
import {
  SCHEDULE_PRESETS,
  builderFromCron,
  describeCronExpression,
  isValidCronExpression,
  presetForCron,
} from '@endora-commerce/contracts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import { CronBuilderField } from './CronBuilderField';

/**
 * How often the feed regenerates — ux-design §2.2 (FR-031).
 *
 * The design rule this implements is "never make a merchandiser write cron".
 * A short preset `Select` covers what almost everyone wants; *Custom…* reveals
 * the raw expression with a **live plain-language echo** underneath, so an
 * operator who does write cron can read back what they actually asked for
 * before saving.
 *
 * Three deliberate behaviours:
 *
 *  - **Validation on blur, never on the first keystroke** (Postel). `0 *` is
 *    not a mistake, it is someone half way through typing `0 * * * *`, and
 *    shouting at them mid-word trains people to ignore the message.
 *  - **The echo and the error are never on screen together.** An invalid
 *    expression has no meaning to echo, so the field shows the error instead.
 *  - **`Next run` is always visible**, including the honest "once you save this
 *    schedule" before the server has computed one. Occurrence times come from
 *    BullMQ via `nextRunAt`; nothing here evaluates cron, because DST
 *    arithmetic belongs to one implementation and it is not this one.
 */

export interface FeedScheduleValue {
  cron: string;
  timezone: string;
}

export interface SchedulePresetFieldProps {
  value: FeedScheduleValue | null;
  onChange: (next: FeedScheduleValue | null) => void;
  /** Server-computed next occurrence, ISO-8601. Null while unscheduled or unsaved. */
  nextRunAt?: string | null;
  /** FR-033 — the run usually takes longer than half the interval. */
  tooTight?: boolean;
  disabled?: boolean;
  disabledTitle?: string | undefined;
}

const NEVER = 'never';
const CUSTOM = 'custom';

/**
 * A short, curated list. The platform default is the one the operator's own
 * browser reports, so the common case needs no thought; the rest exist because
 * a merchant's business timezone is not always their laptop's.
 */
function timezoneOptions(current: string): string[] {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const base = ['UTC', 'Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'America/New_York'];
  return [...new Set([detected, current, ...base].filter((tz) => tz.trim() !== ''))];
}

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function SchedulePresetField(props: SchedulePresetFieldProps): ReactNode {
  const { value, onChange, nextRunAt = null, tooTight = false, disabled = false } = props;
  const t = useTranslation('product_feeds');

  const activePreset = value === null ? NEVER : (presetForCron(value.cron) ?? CUSTOM);
  const [mode, setMode] = useState<string>(activePreset);
  const [draftCron, setDraftCron] = useState(value?.cron ?? '');
  const [showError, setShowError] = useState(false);
  /**
   * Which half of *Custom* is showing. Seeded from the schedule already saved:
   * an expression the builder cannot represent (a step, a list, a range) opens
   * on the text input, because opening on dropdowns that cannot show it would
   * misreport the operator's own schedule back to them.
   */
  const [customMode, setCustomMode] = useState<'build' | 'write'>(() =>
    value === null || builderFromCron(value.cron) !== null ? 'build' : 'write',
  );

  const timezone = value?.timezone ?? defaultTimezone();
  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);

  const customValid = draftCron.trim() === '' || isValidCronExpression(draftCron);
  const echo = describeCronExpression(draftCron);

  const selectPreset = (next: string): void => {
    setMode(next);
    setShowError(false);
    if (next === NEVER) {
      onChange(null);
      return;
    }
    if (next === CUSTOM) {
      // Seed the input from whatever is configured, so switching to Custom
      // shows the current schedule rather than an empty box.
      setDraftCron(value?.cron ?? '');
      return;
    }
    const preset = SCHEDULE_PRESETS.find((p) => p.id === next);
    if (preset) onChange({ cron: preset.cron, timezone });
  };

  const commitCustom = (): void => {
    setShowError(true);
    if (draftCron.trim() !== '' && isValidCronExpression(draftCron)) {
      onChange({ cron: draftCron.trim(), timezone });
    }
  };

  return (
    <div className="flex flex-col gap-4" title={props.disabledTitle}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="feed-schedule-preset">{t('feeds.schedule.preset')}</Label>
        <Select
          id="feed-schedule-preset"
          value={mode}
          disabled={disabled}
          title={props.disabledTitle}
          onChange={(e) => selectPreset(e.target.value)}
        >
          <option value={NEVER}>{t('feeds.schedule.preset.never')}</option>
          {SCHEDULE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(`feeds.schedule.preset.${preset.id}`)}
            </option>
          ))}
          <option value={CUSTOM}>{t('feeds.schedule.preset.custom')}</option>
        </Select>
      </div>

      {mode !== NEVER && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feed-schedule-timezone">{t('feeds.schedule.timezone')}</Label>
          <Select
            id="feed-schedule-timezone"
            value={timezone}
            disabled={disabled}
            title={props.disabledTitle}
            onChange={(e) => {
              const cron = value?.cron ?? draftCron.trim();
              if (cron !== '' && isValidCronExpression(cron)) {
                onChange({ cron, timezone: e.target.value });
              }
            }}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </div>
      )}

      {mode === CUSTOM && (
        <div className="flex flex-col gap-3">
          {/* Two ways in, because the two audiences are different: an operator
              who does not know cron needs the dropdowns, and one who does finds
              them slower than typing. Neither is hidden behind the other. */}
          <div className="b2b-tabs-scroll">
            <div className="b2b-tabs" role="tablist">
              {(['build', 'write'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={customMode === id}
                  className={`b2b-tab ${customMode === id ? 'is-active' : ''}`}
                  disabled={disabled}
                  onClick={(): void => setCustomMode(id)}
                >
                  {t(`feeds.schedule.custom.${id}`)}
                </button>
              ))}
            </div>
          </div>

          {customMode === 'build' ? (
            <CronBuilderField
              cron={draftCron}
              disabled={disabled}
              disabledTitle={props.disabledTitle}
              onChange={(next): void => {
                setDraftCron(next);
                setShowError(false);
                // The builder can only produce valid expressions, so there is
                // nothing to wait for a blur to find out.
                onChange({ cron: next, timezone });
              }}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feed-schedule-cron">{t('feeds.schedule.custom')}</Label>
              <Input
                id="feed-schedule-cron"
                value={draftCron}
                placeholder="0 */4 * * *"
                disabled={disabled}
                title={props.disabledTitle}
                aria-invalid={showError && !customValid}
                aria-describedby="feed-schedule-cron-echo"
                onChange={(e) => {
                  setDraftCron(e.target.value);
                  // Postel: an expression being typed is not yet an expression
                  // that is wrong. The error waits for blur.
                  setShowError(false);
                }}
                onBlur={commitCustom}
              />
              <p
                id="feed-schedule-cron-echo"
                className={
                  showError && !customValid
                    ? 'text-sm text-destructive'
                    : 'text-sm text-muted-foreground'
                }
                role={showError && !customValid ? 'alert' : undefined}
              >
                {showError && !customValid
                  ? t('feeds.schedule.invalid')
                  : (echo ?? t('feeds.schedule.customHint'))}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {mode === NEVER
          ? t('feeds.schedule.nextRun.manual')
          : nextRunAt
            ? t('feeds.schedule.nextRun', { when: new Date(nextRunAt).toLocaleString() })
            : t('feeds.schedule.nextRun.unknown')}
      </p>

      {tooTight && (
        <p className="text-sm text-amber-700" role="status">
          {t('feeds.schedule.tooTight')}
        </p>
      )}
    </div>
  );
}

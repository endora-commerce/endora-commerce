import { useMemo, type ReactNode } from 'react';
import {
  CRON_BUILDER_FREQUENCIES,
  builderFromCron,
  cronFromBuilder,
  type CronBuilderFrequency,
  type CronBuilderValue,
} from '@endora-commerce/contracts';
import { Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The point-and-click half of *Custom* — FR-031's "never make a merchandiser
 * write cron", carried through to the case the presets do not cover.
 *
 * The presets already handle the three common schedules. What was left was a
 * cliff: anything else meant five positional fields with no labels, which for
 * most operators means copying something off a search result and hoping. This
 * turns the common remainder — "every Monday at 06:15", "the 1st at 04:00" —
 * into dropdowns, and leaves the raw input for everything else.
 *
 * The builder never silently reinterprets an expression it cannot represent:
 * `builderFromCron` returns null for steps, lists and ranges, and the caller
 * keeps the operator on the text input instead. See the contract's own note.
 */

/** A day-of-month past 28 does not exist in every month. */
const SHORT_MONTH_THRESHOLD = 28;

/** The value shown when an operator opens the builder with nothing to seed it. */
const DEFAULT_VALUE: CronBuilderValue = { frequency: 'daily', hour: 3, minute: 0 };

export interface CronBuilderFieldProps {
  /** Current cron expression. May be empty, or something the builder cannot read. */
  cron: string;
  onChange: (cron: string) => void;
  disabled?: boolean;
  disabledTitle?: string | undefined;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** `7` → `07`, so the dropdowns read as clock values rather than integers. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function CronBuilderField(props: CronBuilderFieldProps): ReactNode {
  const { cron, onChange, disabled = false, disabledTitle } = props;
  const t = useTranslation('product_feeds');

  const value = useMemo(() => builderFromCron(cron) ?? DEFAULT_VALUE, [cron]);

  const emit = (next: CronBuilderValue): void => onChange(cronFromBuilder(next));

  /**
   * Switching frequency keeps the time of day the operator already picked.
   * Re-answering "at what time" every time they change "how often" is the kind
   * of small tax that makes a builder slower than the text field it replaces.
   */
  const changeFrequency = (frequency: CronBuilderFrequency): void => {
    const hour = 'hour' in value ? value.hour : 3;
    const { minute } = value;
    switch (frequency) {
      case 'hourly':
        return emit({ frequency, minute });
      case 'daily':
        return emit({ frequency, hour, minute });
      case 'weekly':
        return emit({
          frequency,
          dayOfWeek: 'dayOfWeek' in value ? value.dayOfWeek : 1,
          hour,
          minute,
        });
      case 'monthly':
        return emit({
          frequency,
          dayOfMonth: 'dayOfMonth' in value ? value.dayOfMonth : 1,
          hour,
          minute,
        });
    }
  };

  const showsTimeOfDay = value.frequency !== 'hourly';

  return (
    <div className="flex flex-col gap-3" title={disabledTitle}>
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-40 flex-col gap-1.5">
          <Label htmlFor="cron-builder-frequency">{t('feeds.schedule.builder.frequency')}</Label>
          <Select
            id="cron-builder-frequency"
            value={value.frequency}
            disabled={disabled}
            title={disabledTitle}
            onChange={(e): void => changeFrequency(e.target.value as CronBuilderFrequency)}
          >
            {CRON_BUILDER_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {t(`feeds.schedule.builder.frequency.${frequency}`)}
              </option>
            ))}
          </Select>
        </div>

        {value.frequency === 'weekly' && (
          <div className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor="cron-builder-dow">{t('feeds.schedule.builder.dayOfWeek')}</Label>
            <Select
              id="cron-builder-dow"
              value={String(value.dayOfWeek)}
              disabled={disabled}
              title={disabledTitle}
              onChange={(e): void => emit({ ...value, dayOfWeek: Number(e.target.value) })}
            >
              {range(0, 6).map((day) => (
                <option key={day} value={day}>
                  {t(`feeds.schedule.builder.day.${day}`)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {value.frequency === 'monthly' && (
          <div className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor="cron-builder-dom">{t('feeds.schedule.builder.dayOfMonth')}</Label>
            <Select
              id="cron-builder-dom"
              value={String(value.dayOfMonth)}
              disabled={disabled}
              title={disabledTitle}
              onChange={(e): void => emit({ ...value, dayOfMonth: Number(e.target.value) })}
            >
              {range(1, 31).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        )}

        {showsTimeOfDay && (
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="cron-builder-hour">{t('feeds.schedule.builder.hour')}</Label>
            <Select
              id="cron-builder-hour"
              value={String('hour' in value ? value.hour : 0)}
              disabled={disabled}
              title={disabledTitle}
              onChange={(e): void => emit({ ...value, hour: Number(e.target.value) })}
            >
              {range(0, 23).map((hour) => (
                <option key={hour} value={hour}>
                  {pad(hour)}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex w-24 flex-col gap-1.5">
          <Label htmlFor="cron-builder-minute">{t('feeds.schedule.builder.minute')}</Label>
          <Select
            id="cron-builder-minute"
            value={String(value.minute)}
            disabled={disabled}
            title={disabledTitle}
            onChange={(e): void => emit({ ...value, minute: Number(e.target.value) })}
          >
            {range(0, 59).map((minute) => (
              <option key={minute} value={minute}>
                {pad(minute)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {value.frequency === 'monthly' && value.dayOfMonth > SHORT_MONTH_THRESHOLD && (
        // Said out loud rather than prevented: the 31st is a legitimate choice,
        // it simply skips the months that do not have one, and an operator who
        // discovers that from a missing February run has been misled.
        <p className="b2b-help" role="status">
          {t('feeds.schedule.builder.shortMonths', { day: value.dayOfMonth })}
        </p>
      )}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import {
  builderFromCron,
  cronFromBuilder,
  isValidCronExpression,
  type CronBuilderValue,
} from '../src/product-feeds';

/**
 * The point-and-click half of the schedule field.
 *
 * The load-bearing property is the **round trip**, and specifically its
 * asymmetry: everything the builder can express must parse back to what built
 * it, and everything it cannot express must parse back to `null`. A builder
 * that silently rounded `0 * /4 * * *` down to "hourly at :00" would quietly
 * quadruple a feed's run rate, and the operator's only clue would be the
 * dropdown showing something they never chose.
 */

describe('cronFromBuilder', () => {
  it('builds an hourly expression', () => {
    expect(cronFromBuilder({ frequency: 'hourly', minute: 0 })).toBe('0 * * * *');
    expect(cronFromBuilder({ frequency: 'hourly', minute: 30 })).toBe('30 * * * *');
  });

  it('builds a daily expression', () => {
    expect(cronFromBuilder({ frequency: 'daily', hour: 3, minute: 0 })).toBe('0 3 * * *');
    expect(cronFromBuilder({ frequency: 'daily', hour: 23, minute: 45 })).toBe('45 23 * * *');
  });

  it('builds a weekly expression', () => {
    expect(cronFromBuilder({ frequency: 'weekly', dayOfWeek: 1, hour: 6, minute: 15 })).toBe(
      '15 6 * * 1',
    );
  });

  it('builds a monthly expression', () => {
    expect(cronFromBuilder({ frequency: 'monthly', dayOfMonth: 1, hour: 4, minute: 0 })).toBe(
      '0 4 1 * *',
    );
  });

  it('always produces an expression the validator accepts', () => {
    const values: CronBuilderValue[] = [
      { frequency: 'hourly', minute: 59 },
      { frequency: 'daily', hour: 0, minute: 0 },
      { frequency: 'weekly', dayOfWeek: 6, hour: 12, minute: 30 },
      { frequency: 'monthly', dayOfMonth: 31, hour: 23, minute: 59 },
    ];
    for (const value of values) {
      expect(isValidCronExpression(cronFromBuilder(value))).toBe(true);
    }
  });
});

describe('builderFromCron — what the builder can represent', () => {
  it('round-trips every shape it can build', () => {
    const values: CronBuilderValue[] = [
      { frequency: 'hourly', minute: 0 },
      { frequency: 'hourly', minute: 30 },
      { frequency: 'daily', hour: 3, minute: 0 },
      { frequency: 'weekly', dayOfWeek: 1, hour: 6, minute: 15 },
      { frequency: 'monthly', dayOfMonth: 1, hour: 4, minute: 0 },
    ];
    for (const value of values) {
      expect(builderFromCron(cronFromBuilder(value))).toEqual(value);
    }
  });

  it('tolerates irregular spacing, as the rest of the module does', () => {
    expect(builderFromCron('  0   3   *  *  * ')).toEqual({
      frequency: 'daily',
      hour: 3,
      minute: 0,
    });
  });

  it('reads the two presets it covers', () => {
    // `hourly` and `daily` are expressible; `every4Hours` is not — see below.
    expect(builderFromCron('0 * * * *')).toEqual({ frequency: 'hourly', minute: 0 });
    expect(builderFromCron('0 3 * * *')).toEqual({ frequency: 'daily', hour: 3, minute: 0 });
  });
});

describe('builderFromCron — what it refuses rather than approximates', () => {
  it('refuses a step expression', () => {
    // The `every4Hours` preset. Reading this as "hourly" would quadruple the
    // run rate behind the operator's back.
    expect(builderFromCron('0 */4 * * *')).toBeNull();
    expect(builderFromCron('*/15 * * * *')).toBeNull();
  });

  it('refuses a list', () => {
    expect(builderFromCron('0 6,18 * * *')).toBeNull();
    expect(builderFromCron('0 3 * * 1,4')).toBeNull();
  });

  it('refuses a range', () => {
    expect(builderFromCron('0 9-17 * * *')).toBeNull();
    expect(builderFromCron('0 3 * * 1-5')).toBeNull();
  });

  it('refuses a wildcard minute — every minute is not a frequency it offers', () => {
    expect(builderFromCron('* * * * *')).toBeNull();
    expect(builderFromCron('* 3 * * *')).toBeNull();
  });

  it('refuses a specific month', () => {
    expect(builderFromCron('0 3 1 6 *')).toBeNull();
  });

  it('refuses a day-of-month and a day-of-week together', () => {
    // Cron ORs the two, which no single builder frequency describes.
    expect(builderFromCron('0 3 1 * 1')).toBeNull();
  });

  it('refuses an invalid expression outright', () => {
    expect(builderFromCron('not cron')).toBeNull();
    expect(builderFromCron('0 3 * *')).toBeNull();
    expect(builderFromCron('')).toBeNull();
    expect(builderFromCron('99 3 * * *')).toBeNull();
  });
});

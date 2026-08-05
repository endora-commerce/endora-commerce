import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CronBuilderField } from '../../../src/modules/product_feeds/components/CronBuilderField';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The dropdowns exist so a merchandiser never has to know that the third
 * positional field is day-of-month. What they must not do is misreport a
 * schedule the operator already has, so the seeding rules are pinned here
 * alongside the emitting ones.
 */

const bundle = passthroughBundle('product_feeds', [
  'feeds.schedule.builder.frequency',
  'feeds.schedule.builder.frequency.hourly',
  'feeds.schedule.builder.frequency.daily',
  'feeds.schedule.builder.frequency.weekly',
  'feeds.schedule.builder.frequency.monthly',
  'feeds.schedule.builder.dayOfWeek',
  'feeds.schedule.builder.dayOfMonth',
  'feeds.schedule.builder.hour',
  'feeds.schedule.builder.minute',
  'feeds.schedule.builder.day.0',
  'feeds.schedule.builder.day.1',
  'feeds.schedule.builder.shortMonths',
]);

function render(cron: string): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  renderWithI18n(<CronBuilderField cron={cron} onChange={onChange} />, bundle);
  return { onChange };
}

const frequency = (): HTMLSelectElement =>
  screen.getByLabelText('feeds.schedule.builder.frequency') as HTMLSelectElement;
const minute = (): HTMLSelectElement =>
  screen.getByLabelText('feeds.schedule.builder.minute') as HTMLSelectElement;
const hour = (): HTMLSelectElement =>
  screen.getByLabelText('feeds.schedule.builder.hour') as HTMLSelectElement;

describe('CronBuilderField — reading an existing schedule', () => {
  it('seeds itself from a daily expression', () => {
    render('30 6 * * *');
    expect(frequency().value).toBe('daily');
    expect(hour().value).toBe('6');
    expect(minute().value).toBe('30');
  });

  it('seeds itself from a weekly expression and shows the day', () => {
    render('15 6 * * 1');
    expect(frequency().value).toBe('weekly');
    expect(screen.getByLabelText('feeds.schedule.builder.dayOfWeek')).toBeTruthy();
  });

  it('hides the hour for an hourly schedule — there is no hour to choose', () => {
    render('0 * * * *');
    expect(frequency().value).toBe('hourly');
    expect(screen.queryByLabelText('feeds.schedule.builder.hour')).toBeNull();
  });

  it('falls back to a sane default when the expression is beyond it', () => {
    // `0 */4 * * *` cannot be represented; the field must not claim it is
    // hourly. It shows the default and only emits when the operator acts.
    const { onChange } = render('0 */4 * * *');
    expect(frequency().value).toBe('daily');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits nothing merely by rendering', () => {
    const { onChange } = render('0 3 * * *');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CronBuilderField — emitting', () => {
  it('emits a valid expression when the minute changes', async () => {
    const user = userEvent.setup();
    const { onChange } = render('0 3 * * *');
    await user.selectOptions(minute(), '45');
    expect(onChange).toHaveBeenCalledWith('45 3 * * *');
  });

  it('emits a weekly expression when the frequency changes', async () => {
    const user = userEvent.setup();
    const { onChange } = render('15 6 * * *');
    await user.selectOptions(frequency(), 'weekly');
    // Monday is the default day; the time of day is carried over.
    expect(onChange).toHaveBeenCalledWith('15 6 * * 1');
  });

  it('carries the chosen time across a frequency change', async () => {
    const user = userEvent.setup();
    const { onChange } = render('45 22 * * *');
    await user.selectOptions(frequency(), 'monthly');
    expect(onChange).toHaveBeenCalledWith('45 22 1 * *');
  });

  it('drops the hour when switching to hourly', async () => {
    const user = userEvent.setup();
    const { onChange } = render('20 9 * * *');
    await user.selectOptions(frequency(), 'hourly');
    expect(onChange).toHaveBeenCalledWith('20 * * * *');
  });
});

describe('CronBuilderField — the short-month warning', () => {
  it('says so when the chosen day does not exist in every month', () => {
    render('0 4 31 * *');
    expect(screen.getByRole('status').textContent).toContain(
      'feeds.schedule.builder.shortMonths',
    );
  });

  it('stays quiet for a day every month has', () => {
    render('0 4 28 * *');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

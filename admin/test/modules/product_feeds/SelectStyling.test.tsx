import { describe, expect, it, vi } from 'vitest';
import { SchedulePresetField } from '../../../../packages/modules/product_feeds/src/admin/components/SchedulePresetField';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * `.b2b-select` is a **modifier**, not a control: it contributes
 * `appearance: none`, a chevron background image and the right-hand padding
 * that makes room for it. Every visible property of a field — height, border,
 * radius, background, font size, focus ring — lives on `.b2b-field`.
 *
 * The feed forms applied the modifier alone, which stripped the browser's own
 * chrome without putting anything back, leaving a borderless control that read
 * as plain text. These assertions pin the shared `Select` primitive instead —
 * the same one the neighbouring `Input` and `SalesChannelPicker` follow.
 */

const bundle = passthroughBundle('product_feeds', [
  'feeds.schedule.preset',
  'feeds.schedule.preset.never',
  'feeds.schedule.preset.custom',
  'feeds.schedule.timezone',
  'feeds.schedule.nextRun',
  'feeds.schedule.nextRun.unsaved',
  'feeds.schedule.cron',
  'feeds.schedule.cronInvalid',
  'feeds.schedule.tooTight',
]);

function renderField(value: { cron: string; timezone: string } | null): HTMLSelectElement[] {
  const { container } = renderWithI18n(
    <SchedulePresetField value={value} onChange={vi.fn()} />,
    bundle,
  );
  return [...container.querySelectorAll('select')];
}

describe('product feed selects — design-system styling', () => {
  it('never applies the .b2b-select modifier without its .b2b-field base', () => {
    // The modifier alone is the defect: appearance stripped, nothing restored.
    for (const select of renderField({ cron: '0 * * * *', timezone: 'UTC' })) {
      if (select.className.includes('b2b-select')) {
        expect(select.className).toContain('b2b-field');
      }
    }
  });

  it('gives the preset select the shared control shape', () => {
    const [preset] = renderField(null);
    expect(preset).toBeDefined();
    expect(preset?.className).toMatch(/\bh-9\b/);
    expect(preset?.className).toMatch(/\bborder-input\b/);
    expect(preset?.className).toMatch(/\brounded-md\b/);
  });

  it('gives the timezone select the same shape as the preset select', () => {
    // Two controls stacked in one form reading differently is the complaint;
    // they must resolve to the same class list.
    const selects = renderField({ cron: '0 * * * *', timezone: 'UTC' });
    expect(selects).toHaveLength(2);
    expect(selects[0]?.className).toBe(selects[1]?.className);
  });

  it('keeps a visible focus ring on every select', () => {
    for (const select of renderField({ cron: '0 * * * *', timezone: 'UTC' })) {
      expect(select.className).toMatch(/focus-visible:ring/);
    }
  });

  it('keeps the disabled affordance legible', () => {
    const { container } = renderWithI18n(
      <SchedulePresetField value={null} onChange={vi.fn()} disabled />,
      bundle,
    );
    const select = container.querySelector('select');
    expect(select?.disabled).toBe(true);
    expect(select?.className).toMatch(/disabled:/);
  });
});

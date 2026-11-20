import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulePresetField } from '../../../../packages/modules/product_feeds/src/admin/components/SchedulePresetField';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1491 (UX audit 2026-11-17, CAT-16) — *Custom…* offers two ways to give
 * the same schedule: the dropdowns or a cron expression. That was a hand-rolled
 * `role="tablist"` with no panel and no arrow keys, and the field sits inside
 * the feed page's Settings tab, where a second strip is not allowed (#1445: no
 * tabs inside tabs). A choice of input method is a radio group: a named
 * `fieldset`, the browser's own arrow keys, one stop in the tab order.
 */

const FEEDS_EN = shippedModuleBundle('product_feeds', 'en').product_feeds!;
const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('product_feeds', 'en') };

function renderField(cron: string): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(<SchedulePresetField value={{ cron, timezone: 'UTC' }} onChange={vi.fn()} />, BUNDLE);
}

describe('SchedulePresetField — how a custom schedule is given (issue #1491)', () => {
  it('is a named radio group, not a tab strip', async () => {
    const { container } = renderField('15 6 * * 1');
    expect(screen.queryByRole('tablist')).toBeNull();
    const group = screen.getByRole('group', { name: FEEDS_EN['feeds.schedule.custom.mode']! });
    const build = within(group).getByRole('radio', { name: FEEDS_EN['feeds.schedule.custom.build']! });
    const write = within(group).getByRole('radio', { name: FEEDS_EN['feeds.schedule.custom.write']! });
    expect(build).toBeChecked();
    expect(write).not.toBeChecked();
    await expectNoAxeViolations(container);
  });

  it('opens on the expression an operator cannot build with the dropdowns, and switches', async () => {
    renderField('*/7 * * * *');
    const write = screen.getByRole('radio', { name: FEEDS_EN['feeds.schedule.custom.write']! });
    expect(write).toBeChecked();
    expect(screen.getByLabelText(FEEDS_EN['feeds.schedule.custom']!)).toHaveValue('*/7 * * * *');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: FEEDS_EN['feeds.schedule.custom.build']! }));
    expect(screen.queryByLabelText(FEEDS_EN['feeds.schedule.custom']!)).toBeNull();
    // The builder's own frequency select, beside the preset one.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(2);
  });
});

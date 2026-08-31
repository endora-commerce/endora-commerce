import { describe, expect, it } from 'vitest';
import type { FeedRunStatus } from '@endora-commerce/contracts';
import { FeedStatusBadge } from '../../../../packages/modules/product_feeds/src/admin/components/FeedStatusBadge';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The run outcome is the one coloured surface on the feed list, so it is where
 * a palette that ignores the design tokens is most visible. Tailwind's
 * `emerald-600` / `amber-600` are a different hue family from the admin's
 * `--success` (#008060) and `--warn` (#b54708); pinning the token classes here
 * stops the badge drifting back to the stock palette.
 */

const bundle = passthroughBundle('product_feeds', [
  'runs.outcome.queued',
  'runs.outcome.running',
  'runs.outcome.completed',
  'runs.outcome.completedWithWarnings',
  'runs.outcome.empty',
  'runs.outcome.failed',
  'runs.outcome.skipped',
]);

function renderBadge(status: FeedRunStatus): HTMLElement {
  const { container } = renderWithI18n(<FeedStatusBadge status={status} />, bundle);
  const badge = container.querySelector('span');
  expect(badge).not.toBeNull();
  return badge as HTMLElement;
}

const ALL_STATUSES: FeedRunStatus[] = [
  'queued',
  'running',
  'completed',
  'completed_with_warnings',
  'empty',
  'failed',
  'skipped',
];

describe('FeedStatusBadge — design-system alignment', () => {
  it('renders every status through the shared .b2b-badge class', () => {
    for (const status of ALL_STATUSES) {
      expect(renderBadge(status).className).toContain('b2b-badge');
    }
  });

  it('maps the three meaningful outcomes onto design-token tones', () => {
    expect(renderBadge('completed').className).toContain('b2b-badge--success');
    expect(renderBadge('completed_with_warnings').className).toContain('b2b-badge--warn');
    expect(renderBadge('failed').className).toContain('b2b-badge--danger');
  });

  it('uses no raw Tailwind palette colour for any status', () => {
    for (const status of ALL_STATUSES) {
      const cls = renderBadge(status).className;
      expect(cls).not.toMatch(/\b(text|bg)-(emerald|amber|green|red|yellow)-\d{3}\b/);
    }
  });

  it('keeps the icon + word pairing so colour is never the only signal', () => {
    for (const status of ALL_STATUSES) {
      const badge = renderBadge(status);
      expect(badge.querySelector('svg')).not.toBeNull();
      expect(badge.textContent).toContain('runs.outcome.');
    }
  });
});

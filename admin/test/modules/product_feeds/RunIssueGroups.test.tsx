import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  RunIssueGroups,
  groupIssuesByReason,
} from '../../../src/modules/product_feeds/components/RunIssueGroups';
import type { FeedRunIssueDto } from '../../../src/modules/product_feeds/api';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 067 / T108 — the run-detail issue surface (FR-054, ux-design §2.4).
 *
 * A flat list of sixty-one rows tells an operator nothing, so the requirement
 * is that issues arrive **grouped by reason first**, largest group open, and
 * that the two provider-category reasons carry the one affordance whose fix
 * lives on a different screen. Those are the three things pinned here.
 */

const BUNDLE = {
  product_feeds: {
    'runs.reason.missing_price': 'No price',
    'runs.reason.missing_image': 'No image',
    'runs.reason.unmapped_provider_category': 'No provider category for this product',
    'runs.issues.group': '{count} products',
    'runs.issues.showing': 'showing {shown} of {total}',
    'runs.issues.overflow': 'Only the first {cap} problems were recorded.',
    'runs.issues.fixMapping': 'Fix mapping',
  },
};

function issue(over: Partial<FeedRunIssueDto> & { id: string }): FeedRunIssueDto {
  return {
    severity: 'skip',
    reason: 'missing_price',
    productId: null,
    variantId: null,
    sku: `SKU-${over.id}`,
    outputName: null,
    detail: null,
    ...over,
  };
}

function renderGroups(issues: FeedRunIssueDto[], overflow = false): void {
  renderWithI18n(
    <MemoryRouter>
      <RunIssueGroups
        issues={issues}
        severity="skip"
        overflow={overflow}
        issueCapHint={1000}
      />
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('groupIssuesByReason', () => {
  it('groups by reason and orders the largest cause first', () => {
    const groups = groupIssuesByReason([
      issue({ id: '1', reason: 'missing_image' }),
      issue({ id: '2', reason: 'missing_price' }),
      issue({ id: '3', reason: 'missing_price' }),
      issue({ id: '4', reason: 'missing_price' }),
    ]);
    expect(groups.map((group) => group.reason)).toEqual(['missing_price', 'missing_image']);
    expect(groups[0]?.items).toHaveLength(3);
  });

  it('breaks a tie deterministically, so two renders agree', () => {
    const input = [
      issue({ id: '1', reason: 'missing_price' }),
      issue({ id: '2', reason: 'missing_image' }),
    ];
    expect(groupIssuesByReason(input).map((g) => g.reason)).toEqual(
      groupIssuesByReason([...input].reverse()).map((g) => g.reason),
    );
  });
});

describe('RunIssueGroups', () => {
  it('opens the largest group and leaves the rest collapsed', () => {
    renderGroups([
      issue({ id: '1', reason: 'missing_price', sku: 'SKU-BIGGEST' }),
      issue({ id: '2', reason: 'missing_price' }),
      issue({ id: '3', reason: 'missing_image', sku: 'SKU-SMALLER' }),
    ]);
    expect(screen.getByText('SKU-BIGGEST')).toBeInTheDocument();
    // The smaller group is a heading with a count, not a list of SKUs.
    expect(screen.queryByText('SKU-SMALLER')).not.toBeInTheDocument();
    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('expands a collapsed group on click', async () => {
    const user = userEvent.setup();
    renderGroups([
      issue({ id: '1', reason: 'missing_price' }),
      issue({ id: '2', reason: 'missing_price' }),
      issue({ id: '3', reason: 'missing_image', sku: 'SKU-SMALLER' }),
    ]);
    const trigger = screen.getByRole('button', { name: /No image/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('SKU-SMALLER')).toBeInTheDocument();
  });

  it('offers "Fix mapping" only on the provider-category groups', () => {
    renderGroups([
      issue({ id: '1', reason: 'unmapped_provider_category' }),
      issue({ id: '2', reason: 'missing_price' }),
    ]);
    const links = screen.getAllByRole('link', { name: /Fix mapping/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/product-feeds/category-mapping');
  });

  it('caps a long group and says how many there are', () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      issue({ id: String(index), sku: `SKU-${index}` }),
    );
    renderGroups(many);
    expect(screen.getByText('showing 100 of 150')).toBeInTheDocument();
    expect(screen.queryByText('SKU-149')).not.toBeInTheDocument();
  });

  it('says so when the run stopped recording at the cap', () => {
    renderGroups([issue({ id: '1' })], true);
    expect(screen.getByText(/Only the first 1000 problems/)).toBeInTheDocument();
  });

  it('renders nothing at all when no issue has this severity', () => {
    const { container } = renderWithI18n(
      <MemoryRouter>
        <RunIssueGroups
          issues={[issue({ id: '1', severity: 'warning' })]}
          severity="skip"
          overflow={false}
          issueCapHint={1000}
        />
      </MemoryRouter>,
      BUNDLE,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

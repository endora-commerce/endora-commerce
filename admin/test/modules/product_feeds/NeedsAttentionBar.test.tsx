import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { NeedsAttentionBar } from '../../../../packages/modules/product_feeds/src/admin/components/NeedsAttentionBar';
import type { DraftField, FieldProblem } from '../../../../packages/modules/product_feeds/src/admin/template-draft';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * A `template` problem anchors to the first field purely so it has an id.
 * Treating that anchor as the offending column made the bar count a healthy
 * column as broken and offer a link that focuses the wrong control.
 */

const bundle = passthroughBundle('product_feeds', [
  'builder.needsAttention',
  'builder.needsAttention.one',
  'builder.needsAttention.showAll',
  'builder.needsAttention.showOnly',
  'builder.error.nameRequired',
  'builder.error.groupingRequired',
]);

const FIELDS: DraftField[] = [
  { id: 'f1', outputName: 'id' } as DraftField,
  { id: 'f2', outputName: 'title' } as DraftField,
];

function render(problems: FieldProblem[]): void {
  renderWithI18n(
    <NeedsAttentionBar
      problems={problems}
      fields={FIELDS}
      showOnlyProblems={false}
      onToggleShowOnly={vi.fn()}
      onFocusField={vi.fn()}
    />,
    bundle,
  );
}

describe('NeedsAttentionBar — template problems versus field problems', () => {
  it('states a template problem in its own words', () => {
    render([{ fieldId: 'f1', control: 'template', messageKey: 'builder.error.nameRequired' }]);
    expect(screen.getByRole('alert').textContent).toContain('builder.error.nameRequired');
  });

  it('does not blame the anchor column for a template problem', () => {
    render([{ fieldId: 'f1', control: 'template', messageKey: 'builder.error.nameRequired' }]);
    expect(screen.queryByRole('button', { name: 'id' })).toBeNull();
  });

  it('omits the field count when only the template is at fault', () => {
    render([{ fieldId: 'f1', control: 'template', messageKey: 'builder.error.nameRequired' }]);
    // Matched per element rather than by substring: the show-only toggle's own
    // label starts with the same prefix as the count key.
    const texts = [...screen.getByRole('alert').querySelectorAll('span')].map(
      (span) => span.textContent,
    );
    expect(texts).not.toContain('builder.needsAttention');
    expect(texts).not.toContain('builder.needsAttention.one');
    expect(texts).toContain('builder.error.nameRequired');
  });

  it('still links the offending column for a field problem', () => {
    render([{ fieldId: 'f2', control: 'outputName', messageKey: 'builder.error.nameRequired' }]);
    expect(screen.getByRole('button', { name: 'title' })).toBeTruthy();
  });

  it('reports both kinds together without conflating them', () => {
    render([
      { fieldId: 'f1', control: 'template', messageKey: 'builder.error.nameRequired' },
      { fieldId: 'f2', control: 'outputName', messageKey: 'builder.error.groupingRequired' },
    ]);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('builder.error.nameRequired');
    expect(screen.getByRole('button', { name: 'title' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'id' })).toBeNull();
  });

  it('renders nothing when there is no problem at all', () => {
    const { container } = renderWithI18n(
      <NeedsAttentionBar
        problems={[]}
        fields={FIELDS}
        showOnlyProblems={false}
        onToggleShowOnly={vi.fn()}
        onFocusField={vi.fn()}
      />,
      bundle,
    );
    expect(container.innerHTML).toBe('');
  });
});

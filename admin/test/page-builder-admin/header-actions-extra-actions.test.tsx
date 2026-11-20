import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageBuilderHeaderActions } from '@endora-commerce/page-builder-admin';

/**
 * Feature 151, T039 — the shared chrome gains one module-agnostic slot,
 * `extraActions`, rendered first among the toolbar's buttons. The chrome owns
 * no copy for it; without it the group is exactly what it was. Since issue
 * #1494 (CONTENT-11) the group opens with its always-mounted status region.
 */
const t = (key: string): string => key;

function buttonsOf(container: HTMLElement): Element[] {
  const group = container.querySelector('.cms-pb-header-actions')!;
  return Array.from(group.children).filter((child) => child.getAttribute('role') !== 'status');
}

describe('PageBuilderHeaderActions extraActions', () => {
  it('renders the slot first among the toolbar buttons', () => {
    const { container } = render(
      <PageBuilderHeaderActions
        fullscreen={false}
        onToggleFullscreen={(): void => {}}
        currentData={null}
        extraActions={<button type="button">module action</button>}
        t={t}
      />,
    );
    expect(buttonsOf(container)[0]?.textContent).toBe('module action');
    expect(screen.getByRole('button', { name: 'module action' })).toBeTruthy();
  });

  it('renders exactly as before without it', () => {
    const { container } = render(
      <PageBuilderHeaderActions fullscreen={false} onToggleFullscreen={(): void => {}} currentData={null} t={t} />,
    );
    const buttons = buttonsOf(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('pageBuilder.fullscreen.enter');
  });
});

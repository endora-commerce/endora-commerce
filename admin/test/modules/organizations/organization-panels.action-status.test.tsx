import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the Organization
 * detail's moderation, hierarchy and VAT validation panels say an action's
 * result beside the control that caused it, in a `role="status"` region that is
 * mounted empty before the action, not as a success `Alert` at the top of the
 * card. An error stays the card's one destructive banner and clears the result.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  // The picker's own search is not under test: a plain button picks a parent.
  return {
    ...actual,
    OrganizationPicker: ({ onChange }: { onChange: (next: string | null) => void }) => (
      <button type="button" onClick={(): void => onChange('00000000-0000-4000-8000-0000000000p1')}>
        pick-parent
      </button>
    ),
  };
});

const { ModerationActionsPanel } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel'
);
const { HierarchyPanel } = await import('../../../../packages/modules/organizations/src/admin/panels/HierarchyPanel');
const { VatValidationPanel } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel'
);
const { vatValidationResultTone } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/vat-validation-view'
);

const ORG = '00000000-0000-4000-8000-0000000000o1';

afterEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

function noSuccessBanner(): void {
  expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
}

/** The polite region in the same group as `button` — its sibling, not a banner above the card. */
function statusBeside(button: HTMLElement): HTMLElement {
  const region = button.parentElement?.querySelector<HTMLElement>(':scope > [role="status"]');
  if (!region) throw new Error('no status region beside the button');
  return region;
}

describe('ModerationActionsPanel — the result beside the buttons (#1499)', () => {
  const bundle = passthroughBundle('core', [
    'organizations.moderation.title',
    'organizations.moderation.action.approve',
    'organizations.moderation.action.reject',
    'organizations.moderation.action.block',
    'organizations.moderation.action.unblock',
    'organizations.moderation.success.approve',
    'organizations.moderation.error.conflict',
  ]);

  it('mounts the region empty, then says "approved" in it, with no success banner', async () => {
    postSpy.mockResolvedValue({});
    renderWithI18n(
      <ModerationActionsPanel organizationId={ORG} status="pending_verification" version={0} canModerate onChanged={vi.fn()} />,
      bundle,
    );
    const approve = screen.getByRole('button', { name: 'organizations.moderation.action.approve' });
    const region = statusBeside(approve);
    expect(region.textContent).toBe('');

    await userEvent.click(approve);

    await waitFor(() => expect(region).toHaveTextContent('organizations.moderation.success.approve'));
    noSuccessBanner();
  });

  it('a refusal clears the previous result and is the one banner', async () => {
    postSpy.mockResolvedValueOnce({});
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    renderWithI18n(
      <ModerationActionsPanel organizationId={ORG} status="pending_verification" version={0} canModerate onChanged={vi.fn()} />,
      bundle,
    );
    const approve = screen.getByRole('button', { name: 'organizations.moderation.action.approve' });
    const region = statusBeside(approve);
    await userEvent.click(approve);
    await waitFor(() => expect(region).toHaveTextContent('organizations.moderation.success.approve'));

    postSpy.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'conflict' } } as never),
    );
    await userEvent.click(approve);

    await waitFor(() =>
      expect(document.querySelector('[data-slot="alert"][data-variant="destructive"]')).toHaveTextContent(
        'organizations.moderation.error.conflict',
      ),
    );
    expect(region.textContent).toBe('');
  });

  it('offers no region to an operator who may not moderate', () => {
    renderWithI18n(
      <ModerationActionsPanel organizationId={ORG} status="active" version={0} canModerate={false} onChanged={vi.fn()} />,
      bundle,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('HierarchyPanel — the result beside the parent picker (#1499)', () => {
  const bundle = passthroughBundle('core', [
    'organizations.detail.hierarchyCard',
    'organizations.detail.hierarchyParentLabel',
    'organizations.detail.hierarchySaved',
    'organizations.detail.hierarchyError',
  ]);

  it('mounts the region empty, then says "parent updated" beside the picker, with no success banner', async () => {
    getSpy.mockResolvedValue({ items: [] });
    postSpy.mockResolvedValue({});
    renderWithI18n(<HierarchyPanel organizationId={ORG} parentId={null} onChanged={vi.fn()} />, bundle);
    const picker = screen.getByRole('button', { name: 'pick-parent' });
    const region = statusBeside(picker);
    expect(region.textContent).toBe('');

    await userEvent.click(picker);

    await waitFor(() => expect(region).toHaveTextContent('organizations.detail.hierarchySaved'));
    noSuccessBanner();
  });

  it('a failed move clears the previous result and shows the error banner', async () => {
    getSpy.mockResolvedValue({ items: [] });
    postSpy.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('down'));
    renderWithI18n(<HierarchyPanel organizationId={ORG} parentId={null} onChanged={vi.fn()} />, bundle);
    const picker = screen.getByRole('button', { name: 'pick-parent' });
    const region = statusBeside(picker);
    await userEvent.click(picker);
    await waitFor(() => expect(region).toHaveTextContent('organizations.detail.hierarchySaved'));

    await userEvent.click(picker);

    expect(await screen.findByRole('alert')).toHaveTextContent('organizations.detail.hierarchyError');
    expect(region.textContent).toBe('');
  });
});

describe('VatValidationPanel — the result beside "Validate now" (#1499)', () => {
  const bundle = passthroughBundle('core', [
    'organizations.vatValidation.title',
    'organizations.vatValidation.action.validateNow',
    'organizations.vatValidation.action.validateAndAutoFill',
    'organizations.vatValidation.success.validated',
    'organizations.vatValidation.success.failed',
    'organizations.vatValidation.lastResult',
  ]);
  const summary = { outcome: null, provider: null, validatedAt: null };

  it('mounts the region empty, then says the outcome beside the button, with no success banner', async () => {
    getSpy.mockResolvedValue({ items: [] });
    postSpy.mockResolvedValue({ outcome: 'validated', errorKind: null });
    renderWithI18n(<VatValidationPanel organizationId={ORG} summary={summary} onChanged={vi.fn()} />, bundle);
    const validate = screen.getByRole('button', { name: 'organizations.vatValidation.action.validateNow' });
    const region = statusBeside(validate);
    expect(region.textContent).toBe('');

    await userEvent.click(validate);

    await waitFor(() => expect(region).toHaveTextContent('organizations.vatValidation.success.validated'));
    expect(region.getAttribute('data-tone')).toBe('success');
    noSuccessBanner();
  });

  it('a rejected identifier is said in the error tone, still politely beside the button', async () => {
    getSpy.mockResolvedValue({ items: [] });
    postSpy.mockResolvedValue({ outcome: 'failed', errorKind: null });
    renderWithI18n(<VatValidationPanel organizationId={ORG} summary={summary} onChanged={vi.fn()} />, bundle);
    const validate = screen.getByRole('button', { name: 'organizations.vatValidation.action.validateNow' });
    const region = statusBeside(validate);

    await userEvent.click(validate);

    await waitFor(() => expect(region).toHaveTextContent('organizations.vatValidation.success.failed'));
    expect(region.getAttribute('data-tone')).toBe('error');
    expect(within(region.parentElement as HTMLElement).queryByRole('alert')).toBeNull();
  });

  it('maps every outcome to a tone: only "validated" is a success', () => {
    expect(vatValidationResultTone('validated')).toBe('success');
    expect(vatValidationResultTone('unverified')).toBe('warning');
    expect(vatValidationResultTone('deferred')).toBe('warning');
    expect(vatValidationResultTone('failed')).toBe('error');
  });
});

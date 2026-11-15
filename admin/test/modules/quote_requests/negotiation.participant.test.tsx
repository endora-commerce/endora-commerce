import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { SaveSessionProvider, useSaveSession, type SaveSessionValue } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 180, WP-7 — the organization's price-negotiation value takes part in the organization
 * detail's one Save (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2;
 * FR-060, FR-035).
 *
 * Under a live session the checkbox stages the part `price-negotiation`: no `PUT` on change and
 * no "Saved." of its own; the session's run writes it through the existing
 * `PUT …/quote-price-negotiation`. A holder of `customers:read` alone sees the value and never
 * stages anything.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: (...args: unknown[]) => putSpy(...args), patch: vi.fn(), delete: vi.fn() },
}));

const quoteRequests = await import('@endora-commerce/mod-quote-requests/admin');

const OWN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/quote_requests/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const ROUTE = `/api/v1/admin/organizations/${ORG_ID}/quote-price-negotiation`;
const LABEL = OWN['negotiation.organization.label']!;

let session: SaveSessionValue | null = null;

function Host(): ReactElement {
  const live = useSaveSession();
  session = live;
  return <AdminZone name="organization.detail.after" props={{ organizationId: ORG_ID, saveSession: live.handle }} />;
}

function renderOrganization(permissions: readonly string[] = ['customers:read', 'customers:manage']): void {
  render(
    <TranslationProvider language="en" initialBundle={{ quote_requests: OWN }}>
      {withSession(
        <MemoryRouter>
          <SaveSessionProvider resetKey={ORG_ID} hostModule="organizations">
            <Host />
          </SaveSessionProvider>
        </MemoryRouter>,
        {
          session: adminSession({ permissions: [...permissions] }),
          presence: modulePresence({ present: ['quote_requests'] }),
          contributions: [{ moduleId: 'quote_requests', contributions: quoteRequests.contributions }],
        },
      )}
    </TranslationProvider>,
  );
}

async function toggle(): Promise<HTMLInputElement> {
  const box = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
  await waitFor(() => expect(box.disabled).toBe(false));
  fireEvent.click(box);
  return box;
}

beforeEach(() => {
  session = null;
  getSpy.mockReset().mockResolvedValue({ data: { organizationId: ORG_ID, priceProposalsAllowed: false, updatedAt: null } });
  putSpy.mockReset().mockImplementation(async (_url: string, body: Record<string, unknown>) => ({
    data: { organizationId: ORG_ID, ...body, updatedAt: '2026-05-01T10:00:00.000Z' },
  }));
});
afterEach(() => cleanup());

describe('price negotiation under the organization detail session (feature 180, WP-7)', () => {
  it('stages the change instead of writing it, and counts it', async () => {
    renderOrganization();
    const box = await toggle();
    expect(box.checked).toBe(true);
    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(OWN['negotiation.saved']!)).toBeNull();
    expect(session?.dirtyCount).toBe(1);
    expect(session?.dirtyParticipants().map((part) => [part.id, part.label])).toEqual([
      ['quote_requests:price-negotiation', OWN['negotiation.partLabel']],
    ]);
    // Unticked again: back to the stored value, nothing to save.
    fireEvent.click(box);
    expect(session?.dirtyCount).toBe(0);
  });

  it('is written by the session run, through the existing PUT', async () => {
    renderOrganization();
    await toggle();
    let result = '';
    await act(async () => {
      result = (await session!.run(null)).result;
    });
    expect(result).toBe('saved');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(ROUTE, { priceProposalsAllowed: true });
    expect(session?.dirtyCount).toBe(0);
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(true);
  });

  it('a failed write keeps the change staged and says why at the panel', async () => {
    putSpy.mockRejectedValueOnce(new Error('The server failed.'));
    renderOrganization();
    await toggle();
    await act(async () => {
      await session!.run(null);
    });
    expect(session?.dirtyCount).toBe(1);
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText('The server failed.')).toBeInTheDocument();
  });

  it('a reader without customers:manage never stages anything', async () => {
    renderOrganization(['customers:read']);
    const box = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(ROUTE));
    expect(box.disabled).toBe(true);
    fireEvent.click(box);
    expect(session?.dirtyCount).toBe(0);
    expect(session?.hasWritableParticipant).toBe(false);
  });
});

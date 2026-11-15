import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import {
  INERT_SAVE_SESSION,
  SaveSessionProvider,
  useSaveSession,
  type SaveSessionValue,
} from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { bundles } from '../../helpers/price-book-screen';

/**
 * Feature 180, WP-6 — `DisplayModeOverrideRow` takes part in its host's one Save
 * (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §1; FR-050, FR-035).
 *
 * Under a live session (the category editor) a change of the select is a staged change of the
 * part `display-mode`: no `PUT` on change, no "saved" suffix, written by the session's run. A
 * reader of `price_lists` never stages anything. Since WP-7 the organization detail hands its
 * session too, so no host is left for the save-on-change branch and it is gone.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: (...args: unknown[]) => putSpy(...args), patch: vi.fn(), delete: vi.fn() },
}));

const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const EN = bundles('en');
const CORE = EN['core'] as Record<string, string>;
const PRICE_LISTS = EN['price_lists'] as Record<string, string>;
const LABEL = CORE['priceLists.displayMode.rowLabel']!;

let session: SaveSessionValue | null = null;

function Host(): ReactElement {
  const live = useSaveSession();
  session = live;
  return <AdminZone name="category.editor.after" props={{ categoryId: CATEGORY_ID, saveSession: live.handle }} />;
}

async function renderWith(ui: ReactElement, permissions: readonly string[] = ['price_lists:read', 'price_lists:write']): Promise<void> {
  render(
    <TranslationProvider language="en" initialBundle={EN}>
      {withSession(<MemoryRouter>{ui}</MemoryRouter>, {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: ['price_lists'] }),
        contributions: [{ moduleId: 'price_lists', contributions: priceLists.contributions }],
      })}
    </TranslationProvider>,
  );
}

async function choose(mode: string): Promise<void> {
  const select = (await screen.findByLabelText(LABEL)) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  await waitFor(() => expect(select.value).toBe('gross_only'));
  fireEvent.change(select, { target: { value: mode } });
}

beforeEach(() => {
  session = null;
  getSpy.mockReset().mockResolvedValue({ data: { mode: 'gross_only' } });
  putSpy.mockReset().mockResolvedValue({ data: { mode: 'net_only' } });
});
afterEach(() => cleanup());

describe('display-mode row under a save session (feature 180, WP-6)', () => {
  it('stages a change instead of writing it, and counts it', async () => {
    await renderWith(
      <SaveSessionProvider resetKey={CATEGORY_ID} hostModule="catalog">
        <Host />
      </SaveSessionProvider>,
    );
    await choose('net_only');
    expect(putSpy).not.toHaveBeenCalled();
    expect(session?.dirtyCount).toBe(1);
    expect(screen.queryByText(CORE['priceLists.displayMode.savedSuffix']!)).toBeNull();
    expect(session?.dirtyParticipants().map((part) => [part.id, part.label])).toEqual([
      ['price_lists:display-mode', PRICE_LISTS['displayModeRow.partLabel']],
    ]);
  });

  it('is written by the session run, through the existing PUT', async () => {
    await renderWith(
      <SaveSessionProvider resetKey={CATEGORY_ID} hostModule="catalog">
        <Host />
      </SaveSessionProvider>,
    );
    await choose('net_only');
    expect(putSpy).not.toHaveBeenCalled();
    let result = '';
    await act(async () => {
      result = (await session!.run(null)).result;
    });
    expect(result).toBe('saved');
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/pricing/display-mode-overrides/category/${CATEGORY_ID}`, { mode: 'net_only' });
    expect(session?.dirtyCount).toBe(0);
  });

  it('a reader stages nothing and sees no select', async () => {
    await renderWith(
      <SaveSessionProvider resetKey={CATEGORY_ID} hostModule="catalog">
        <Host />
      </SaveSessionProvider>,
      ['price_lists:read'],
    );
    expect(await screen.findByText(CORE['priceLists.displayMode.grossOnly']!)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(session?.hasWritableParticipant).toBe(false);
    expect(session?.dirtyCount).toBe(0);
  });

  it('stages on the organization detail too, under that screen\'s session (WP-7)', async () => {
    function OrganizationHost(): ReactElement {
      const live = useSaveSession();
      session = live;
      return <AdminZone name="organization.detail.after" props={{ organizationId: ORGANIZATION_ID, saveSession: live.handle }} />;
    }
    await renderWith(
      <SaveSessionProvider resetKey={ORGANIZATION_ID} hostModule="organizations">
        <OrganizationHost />
      </SaveSessionProvider>,
    );
    await choose('net_only');
    expect(putSpy).not.toHaveBeenCalled();
    expect(session?.dirtyParticipants().map((part) => part.id)).toEqual(['price_lists:display-mode']);
    await act(async () => {
      await session!.run(null);
    });
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/pricing/display-mode-overrides/organization/${ORGANIZATION_ID}`, { mode: 'net_only' });
  });

  it('writes nothing on change with no live session: the save-on-change branch is gone', async () => {
    await renderWith(
      <AdminZone name="organization.detail.after" props={{ organizationId: ORGANIZATION_ID, saveSession: INERT_SAVE_SESSION }} />,
    );
    await choose('net_only');
    await new Promise((settle) => setTimeout(settle, 20));
    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(CORE['priceLists.displayMode.savedSuffix']!)).toBeNull();
  });
});


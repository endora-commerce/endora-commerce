import { StrictMode, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `quote_requests` contributes the price-negotiation lock to the organization
 * and customer detail screens (feature 146, US4; FR-020, FR-027 – FR-030;
 * `specs/146-quote-request-pricing-history/contracts/price-negotiation-api.md` §6).
 *
 * The bundle is the module's **real** English bundle rather than a passthrough
 * one: the customer panel's subject is a sentence assembled from three keys
 * ("Effective: … (from …)"), and a passthrough bundle would show the key of the
 * template whatever the values were.
 *
 * Rendered under `<StrictMode>`, so every mount effect runs twice: the reads
 * are asserted with `toHaveBeenCalledWith`, never with a count. The writes are
 * click-driven and are counted.
 *
 * The permission is `customers:read` on the contribution (D-3J, plan I3) and
 * `customers:manage` on the control: a read-only holder sees the value and a
 * disabled control with a hint, which is what the write route would refuse.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const quoteRequests = await import('@endora-commerce/mod-quote-requests/admin');
const { manifest } = await import('@endora-commerce/mod-quote-requests');

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const ORG_ROUTE = `/api/v1/admin/organizations/${ORG_ID}/quote-price-negotiation`;
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000a2';
const OTHER_ORG_ROUTE = `/api/v1/admin/organizations/${OTHER_ORG_ID}/quote-price-negotiation`;
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c2';
const OTHER_CUSTOMER_ROUTE = `/api/v1/admin/customers/${OTHER_CUSTOMER_ID}/quote-price-negotiation`;
const CUSTOMER_ROUTE = `/api/v1/admin/customers/${CUSTOMER_ID}/quote-price-negotiation`;

const REGISTRY = [{ moduleId: 'quote_requests', contributions: quoteRequests.contributions }];

function readBundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `../packages/modules/quote_requests/i18n/${language}.json`),
      'utf8',
    ),
  ) as Record<string, string>;
}

const NEGOTIATION_KEYS = [
  'negotiation.title',
  'negotiation.organization.label',
  'negotiation.organization.description',
  'negotiation.customer.label',
  'negotiation.customer.description',
  'negotiation.override.inherit',
  'negotiation.override.allowed',
  'negotiation.override.not_allowed',
  'negotiation.effective',
  'negotiation.value.allowed',
  'negotiation.value.notAllowed',
  'negotiation.source.account',
  'negotiation.source.organization',
  'negotiation.source.default',
  'negotiation.loading',
  'negotiation.loadError',
  'negotiation.retry',
  'negotiation.saving',
  'negotiation.saved',
  'negotiation.saveError',
  'negotiation.readOnlyHint',
] as const;

function orgState(allowed: boolean): unknown {
  return { data: { organizationId: ORG_ID, priceProposalsAllowed: allowed, updatedAt: null } };
}

function customerState(
  override: 'inherit' | 'allowed' | 'not_allowed',
  organizationAllowed: boolean,
): unknown {
  const effective = override === 'inherit' ? organizationAllowed : override === 'allowed';
  return {
    data: {
      customerAccountId: CUSTOMER_ID,
      organizationId: ORG_ID,
      override,
      organizationPriceProposalsAllowed: organizationAllowed,
      effectivePriceProposalsAllowed: effective,
      effectiveSource: override === 'inherit' ? 'organization' : 'account',
      updatedAt: null,
    },
  };
}

interface ZoneOptions {
  readonly name: AdminZoneName;
  readonly props: Record<string, unknown>;
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}

function zoneTree(options: ZoneOptions): ReactElement {
  return (
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/x']}>
          {/* `AdminZone` is generic on the literal name at a host's call site;
              this helper serves the two members this feature contributes to, so
              the cast is the harness's and not a host's. */}
          <AdminZone
            name={options.name as 'organization.detail.after'}
            props={options.props as { organizationId: string }}
          />
        </MemoryRouter>,
        {
          session: adminSession({
            permissions: [...(options.permissions ?? ['customers:read', 'customers:manage'])],
          }),
          presence: modulePresence({ present: [...(options.present ?? ['quote_requests'])] }),
          contributions: REGISTRY,
        },
      )}
    </StrictMode>
  );
}

function renderZoneResult(options: ZoneOptions): RenderResult {
  return renderWithI18n(zoneTree(options), { quote_requests: readBundle('en') });
}

function renderZone(options: ZoneOptions): HTMLElement {
  return renderZoneResult(options).container;
}

const renderOrganization = (
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): HTMLElement =>
  renderZone({ name: 'organization.detail.after', props: { organizationId: ORG_ID }, ...options });

const renderCustomer = (
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): HTMLElement =>
  renderZone({ name: 'customer.detail.after', props: { customerId: CUSTOMER_ID }, ...options });

function organizationToggle(container: HTMLElement): HTMLInputElement {
  const toggle = container.querySelector<HTMLInputElement>(
    `#quote-price-negotiation-org-${ORG_ID}`,
  );
  if (!toggle) throw new Error('organization toggle not rendered');
  return toggle;
}

function overrideRadio(
  container: HTMLElement,
  value: 'inherit' | 'allowed' | 'not_allowed',
): HTMLInputElement {
  const radio = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  if (!radio) throw new Error(`override radio ${value} not rendered`);
  return radio;
}

describe('quote_requests contributes the price-negotiation lock to two detail zones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url === ORG_ROUTE) return orgState(false);
      if (url === CUSTOMER_ROUTE) return customerState('inherit', false);
      throw new Error(`unexpected url ${url}`);
    });
    putSpy.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url === ORG_ROUTE) return orgState(body['priceProposalsAllowed'] as boolean);
      if (url === CUSTOMER_ROUTE) {
        return customerState(body['override'] as 'inherit' | 'allowed' | 'not_allowed', false);
      }
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares one contribution per host, gated on customers:read, with no match', () => {
    const zones = quoteRequests.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual([
      'organization.detail.after',
      'customer.detail.after',
    ]);
    // After `carts` (400) on the organization screen and after `quick_order`
    // (100) on the customer screen.
    expect(zones.map((zone) => zone.weight)).toEqual([500, 200]);
    for (const zone of zones) {
      expect(zone.requiredPermission).toBe('customers:read');
      // One host and one mount per member (Z13): a `match` would narrow nothing.
      expect(zone.match).toBeUndefined();
      expect(typeof zone.component).toBe('function');
    }
  });

  describe('organization panel', () => {
    it('reads its own state and shows it on a labelled control', async () => {
      const container = renderOrganization();
      await waitFor(() => expect(container.textContent).toContain('Members may propose prices'));
      // The label is in the commit that mounts the panel, and the panel starts its
      // read from that commit's effect: wait for it (issue #418).
      await waitFor(() => expect(getSpy).toHaveBeenCalledWith(ORG_ROUTE));
      await waitFor(() => expect(organizationToggle(container).checked).toBe(false));
      const label = container.querySelector(`label[for="quote-price-negotiation-org-${ORG_ID}"]`);
      expect(label?.textContent).toContain('Members may propose prices');
    });

    it('writes through PUT and confirms the save', async () => {
      const container = renderOrganization();
      await waitFor(() => expect(organizationToggle(container).disabled).toBe(false));
      fireEvent.click(organizationToggle(container));
      await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
      expect(putSpy).toHaveBeenCalledWith(ORG_ROUTE, { priceProposalsAllowed: true });
      await waitFor(() => expect(container.textContent).toContain('Saved.'));
      expect(organizationToggle(container).checked).toBe(true);
    });

    it('rolls the control back and says so when the write fails', async () => {
      putSpy.mockRejectedValueOnce(new Error('boom'));
      const container = renderOrganization();
      await waitFor(() => expect(organizationToggle(container).disabled).toBe(false));
      fireEvent.click(organizationToggle(container));
      await waitFor(() =>
        expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy(),
      );
      expect(organizationToggle(container).checked).toBe(false);
    });

    it('is visible but disabled, with a hint, without customers:manage', async () => {
      const container = renderOrganization({ permissions: ['customers:read'] });
      await waitFor(() => expect(container.textContent).toContain('Members may propose prices'));
      await waitFor(() => expect(getSpy).toHaveBeenCalledWith(ORG_ROUTE));
      const toggle = organizationToggle(container);
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
      expect(toggle.disabled).toBe(true);
      expect(container.textContent).toContain(readBundle('en')['negotiation.readOnlyHint']);
      fireEvent.click(toggle);
      expect(putSpy).not.toHaveBeenCalled();
    });

    it('offers a retry when the read fails, and recovers through it', async () => {
      getSpy.mockImplementation(async () => {
        throw new Error('down');
      });
      const container = renderOrganization();
      await waitFor(() => expect(container.textContent).toContain('Try again'));
      getSpy.mockImplementation(async () => orgState(true));
      const retry = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again',
      );
      fireEvent.click(retry!);
      await waitFor(() => expect(organizationToggle(container).checked).toBe(true));
    });

    it('shows nothing of the previous organization while the next one loads (review fix S5)', async () => {
      let releaseOther: (() => void) | undefined;
      getSpy.mockImplementation(async (url: string) => {
        if (url === ORG_ROUTE) return orgState(true);
        if (url === OTHER_ORG_ROUTE) {
          await new Promise<void>((resolve) => {
            releaseOther = resolve;
          });
          return orgState(false);
        }
        throw new Error(`unexpected url ${url}`);
      });
      const view = renderZoneResult({ name: 'organization.detail.after', props: { organizationId: ORG_ID } });
      const toggleOf = (id: string): HTMLInputElement | null =>
        view.container.querySelector<HTMLInputElement>(`#quote-price-negotiation-org-${id}`);
      await waitFor(() => expect(toggleOf(ORG_ID)?.disabled).toBe(false));
      fireEvent.click(toggleOf(ORG_ID)!);
      await waitFor(() => expect(view.container.textContent).toContain('Saved.'));

      view.rerender(zoneTree({ name: 'organization.detail.after', props: { organizationId: OTHER_ORG_ID } }));
      await waitFor(() => expect(getSpy).toHaveBeenCalledWith(OTHER_ORG_ROUTE));
      const pending = toggleOf(OTHER_ORG_ID);
      expect(pending?.checked).toBe(false);
      expect(pending?.disabled).toBe(true);
      expect(view.container.textContent).not.toContain('Saved.');

      releaseOther?.();
      await waitFor(() => expect(toggleOf(OTHER_ORG_ID)?.disabled).toBe(false));
      expect(toggleOf(OTHER_ORG_ID)?.checked).toBe(false);
    });
  });

  describe('customer panel', () => {
    it('shows the three options and the effective value with its source', async () => {
      const container = renderCustomer();
      await waitFor(() => expect(getSpy).toHaveBeenCalledWith(CUSTOMER_ROUTE));
      await waitFor(() => expect(overrideRadio(container, 'inherit').checked).toBe(true));
      expect(container.querySelector('fieldset legend')?.textContent).toContain(
        'Price proposals for this customer',
      );
      for (const label of ['As organization', 'Allowed', 'Not allowed']) {
        expect(container.textContent).toContain(label);
      }
      expect(container.textContent).toContain('Effective: not allowed (from the organization)');
    });

    it('writes the override through PUT and shows the new source', async () => {
      const container = renderCustomer();
      await waitFor(() => expect(overrideRadio(container, 'allowed').disabled).toBe(false));
      fireEvent.click(overrideRadio(container, 'allowed'));
      await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
      expect(putSpy).toHaveBeenCalledWith(CUSTOMER_ROUTE, { override: 'allowed' });
      await waitFor(() =>
        expect(container.textContent).toContain('Effective: allowed (from this customer account)'),
      );
      expect(overrideRadio(container, 'allowed').checked).toBe(true);
    });

    it('names the default as the source when neither level is set', async () => {
      getSpy.mockImplementation(async () => ({
        data: {
          ...(customerState('inherit', true) as { data: Record<string, unknown> }).data,
          effectiveSource: 'default',
        },
      }));
      const container = renderCustomer();
      await waitFor(() =>
        expect(container.textContent).toContain('Effective: allowed (default)'),
      );
    });

    it('is visible but disabled, with a hint, without customers:manage', async () => {
      const container = renderCustomer({ permissions: ['customers:read'] });
      await waitFor(() => expect(overrideRadio(container, 'inherit').checked).toBe(true));
      for (const value of ['inherit', 'allowed', 'not_allowed'] as const) {
        expect(overrideRadio(container, value).disabled).toBe(true);
      }
      expect(container.textContent).toContain(readBundle('en')['negotiation.readOnlyHint']);
      fireEvent.click(overrideRadio(container, 'not_allowed'));
      expect(putSpy).not.toHaveBeenCalled();
    });
  });

  it('the customer panel shows nothing of the previous customer while the next one loads (review fix S5)', async () => {
    let releaseOther: (() => void) | undefined;
    getSpy.mockImplementation(async (url: string) => {
      if (url === CUSTOMER_ROUTE) return customerState('allowed', false);
      if (url === OTHER_CUSTOMER_ROUTE) {
        await new Promise<void>((resolve) => {
          releaseOther = resolve;
        });
        return customerState('inherit', false);
      }
      throw new Error(`unexpected url ${url}`);
    });
    const view = renderZoneResult({ name: 'customer.detail.after', props: { customerId: CUSTOMER_ID } });
    await waitFor(() =>
      expect(view.container.textContent).toContain('Effective: allowed (from this customer account)'),
    );

    view.rerender(zoneTree({ name: 'customer.detail.after', props: { customerId: OTHER_CUSTOMER_ID } }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(OTHER_CUSTOMER_ROUTE));
    expect(view.container.textContent).not.toContain('Effective:');
    expect(overrideRadio(view.container, 'allowed').checked).toBe(false);

    releaseOther?.();
    await waitFor(() =>
      expect(view.container.textContent).toContain('Effective: not allowed (from the organization)'),
    );
    expect(overrideRadio(view.container, 'inherit').checked).toBe(true);
  });

  it('renders neither panel without customers:read, and fetches nothing', async () => {
    const organization = renderOrganization({ permissions: ['customers:manage'] });
    const customer = renderCustomer({ permissions: ['customers:manage'] });
    await waitFor(() => expect(organization.textContent).toBe(''));
    expect(customer.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders neither panel while the module is switched off, and fetches nothing', async () => {
    const organization = renderOrganization({ present: [] });
    const customer = renderCustomer({ present: [] });
    await waitFor(() => expect(organization.textContent).toBe(''));
    expect(customer.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores both panels when the module comes back', async () => {
    const organization = renderOrganization({ present: ['quote_requests'] });
    const customer = renderCustomer({ present: ['quote_requests'] });
    await waitFor(() => expect(organization.textContent).toContain('Members may propose prices'));
    await waitFor(() => expect(customer.textContent).toContain('As organization'));
  });

  it('is switchable, which is what makes the off-state case above real', () => {
    expect(manifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'quote_requests.enabled' }),
    );
  });

  it('ships every negotiation key in both languages, Polish actually translated', () => {
    const en = readBundle('en');
    const pl = readBundle('pl');
    for (const key of NEGOTIATION_KEYS) {
      expect(en[key], `en:${key}`).toBeTruthy();
      expect(pl[key], `pl:${key}`).toBeTruthy();
    }
    expect(pl['negotiation.organization.label']).not.toBe(en['negotiation.organization.label']);
    expect(pl['negotiation.effective']).not.toBe(en['negotiation.effective']);
  });
});

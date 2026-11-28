import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminModulePresenceResponse, EffectiveFormsResponse } from '@endora-commerce/contracts';
import {
  EffectiveFormsProvider,
  ModulePresenceProvider,
  useEffectiveForm,
  useEffectiveForms,
  useModulePresence,
  type EffectiveFormsContextValue,
} from '@endora-commerce/admin-kit/lib';
import { modulePresence } from '../helpers/render-with-session';

/**
 * `EffectiveFormsProvider` fetching for itself — no `initial` seeded
 * (`specs/193-admin-form-extensions/` FR-024, FR-052, SC-007): nothing until a
 * declared form asks, one request when it does, one more on each presence
 * refresh, `await refresh()` resolving with the new forms, and a failed first
 * fetch leaving the declarations (no form) rather than an error screen.
 */

const formsWith = (label: string): EffectiveFormsResponse => ({
  forms: [
    {
      id: 'organization.edit',
      fieldSet: 'organization',
      fields: [
        {
          key: 'name',
          section: 'identity',
          order: 0,
          readOnly: false,
          hidden: false,
          control: null,
          label: { source: 'operator', text: { en: label } },
          overriddenBy: [],
          operatorKinds: ['label'],
        },
      ],
    },
  ],
});

interface Server {
  forms: EffectiveFormsResponse | 'fail';
  /** While set, an effective-forms answer waits for it. */
  gate: Promise<void> | null;
  presence: AdminModulePresenceResponse;
  readonly requests: string[];
}

let server: Server;
const original = globalThis.fetch;

beforeEach(() => {
  server = { forms: formsWith('First'), gate: null, presence: modulePresence({ present: ['organizations'] }), requests: [] };
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    server.requests.push(url.pathname);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/v1/admin/effective-forms') {
      if (server.gate !== null) await server.gate;
      return server.forms === 'fail' ? json({ error: { code: 'INTERNAL', message: 'down' } }, 500) : json(server.forms);
    }
    if (url.pathname === '/api/v1/admin/module-presence') return json(server.presence);
    return original(input);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = original;
});

const formRequests = (): number => server.requests.filter((path) => path === '/api/v1/admin/effective-forms').length;

let context: EffectiveFormsContextValue | null = null;
let presence: ReturnType<typeof useModulePresence> | null = null;

function Probe(): ReactNode {
  context = useEffectiveForms();
  presence = useModulePresence();
  return null;
}

function Declared(): ReactNode {
  const { form, status } = useEffectiveForm('organization.edit');
  const field = form?.fields[0];
  const label = field?.label?.source === 'operator' ? field.label.text.en : 'none';
  return <p data-testid="declared">{`${status}:${label}`}</p>;
}

function mount(withDeclared: boolean) {
  return render(
    <ModulePresenceProvider initial={modulePresence({ present: ['organizations'] })}>
      <EffectiveFormsProvider>
        <Probe />
        {withDeclared ? <Declared /> : null}
      </EffectiveFormsProvider>
    </ModulePresenceProvider>,
  );
}

describe('EffectiveFormsProvider fetching for itself', () => {
  it('fetches nothing until a declared form asks, then once (SC-007)', async () => {
    const view = mount(false);
    await act(async () => undefined);
    expect(formRequests()).toBe(0);
    expect(context?.status).toBe('idle');
    view.unmount();

    mount(true);
    expect(await screen.findByText('ready:First')).toBeInTheDocument();
    expect(formRequests()).toBe(1);
  });

  it('fetches again when presence is refreshed, so a switched-off module’s overrides leave (FR-024, FR-052)', async () => {
    mount(true);
    await screen.findByText('ready:First');
    server.forms = formsWith('After presence');
    server.presence = modulePresence({ present: ['organizations'], absent: ['acme'] });
    await act(async () => {
      await presence?.refresh();
    });
    expect(await screen.findByText('ready:After presence')).toBeInTheDocument();
    expect(formRequests()).toBe(2);
  });

  it('resolves refresh() when the refetch has landed, not when it was asked for', async () => {
    mount(true);
    await screen.findByText('ready:First');
    server.forms = formsWith('Refreshed');
    let release: () => void = () => undefined;
    server.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = context!.refresh().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(settled).toBe(false);
    expect(screen.getByTestId('declared')).toHaveTextContent('ready:First');
    await act(async () => {
      release();
      await pending;
    });
    expect(settled).toBe(true);
    expect(screen.getByTestId('declared')).toHaveTextContent('ready:Refreshed');
  });

  it('leaves the declarations when the first fetch fails, and keeps the forms it had when a refresh fails', async () => {
    server.forms = 'fail';
    const view = mount(true);
    expect(await screen.findByText('error:none')).toBeInTheDocument();
    expect(context?.formOf('organization.edit')).toBeUndefined();
    view.unmount();

    server.forms = formsWith('Kept');
    mount(true);
    await screen.findByText('ready:Kept');
    server.forms = 'fail';
    // Started in one act and awaited in the next: the fetch starts in an effect,
    // which React flushes when the act that scheduled it ends.
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = context!.refresh();
    });
    await act(async () => {
      await pending;
    });
    // One failed first fetch, one first fetch, one failed refresh.
    expect(formRequests()).toBe(3);
    await waitFor(() => expect(screen.getByTestId('declared')).toHaveTextContent('ready:Kept'));
  });
});

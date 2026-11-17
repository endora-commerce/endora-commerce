import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { AdminZoneProps, SettingDto } from '@endora-commerce/contracts';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { markup as rowMarkup } from '../../helpers/react-ids';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import {
  SettingRowEditor,
  type SettingDraft,
} from '../../../../packages/modules/settings/src/admin/components/SettingRowEditor';

/**
 * `settings.setting.after` — the place below one setting's field
 * (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §2.3).
 *
 * The row editor mounts the zone once per row and hands it the setting, its
 * owner, the channel being edited and **what is in the field now** — saved or
 * not. It knows nothing of who fills it: the contributor used here is a
 * stand-in under a module id that has nothing to do with settings, so the
 * host's test names no real contributor.
 *
 * With nobody contributing — no module, a module that is switched off, a
 * person without the contribution's permission, or a contribution matched to
 * another setting — the row is the row without the zone, element for element.
 */

type ZoneProps = AdminZoneProps<'settings.setting.after'>;

function Probe(props: ZoneProps): ReactNode {
  return <aside data-testid="after-probe">{JSON.stringify(props)}</aside>;
}

function Broken(): ReactNode {
  throw new Error('a contribution that fails to render');
}

const contribution = (
  match?: { settingCode: string },
  component: (props: ZoneProps) => ReactNode = Probe,
): AdminContributions => ({
  zones: [
    zoneComponent('settings.setting.after', () => Promise.resolve({ default: component }), {
      requiredPermission: 'probe:read',
      ...(match === undefined ? {} : { match }),
    }),
  ],
});

/** `blog` stands in for "some module": it owns no setting used here. */
const registry = (contributions: AdminContributions) => [{ moduleId: 'blog', contributions }];

const BUNDLE = passthroughBundle('settings', [
  'context.usingDefault',
  'context.globalOverrideSet',
  'context.channelOverridePresent',
  'context.inheritsGlobal',
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
  'actions.resetToDefault',
  'editor.dirty',
  'editor.readOnly',
  'editor.readOnlyReason',
  'editor.defaultPrefix',
  'editor.globalPrefix',
  'editor.perChannelOverrides',
  'editor.secretIsSet',
  'editor.secretNotSet',
  'editor.placeholder.secretSet',
  'editor.placeholder.secretUnset',
]);

function setting(overrides: Partial<SettingDto> = {}): SettingDto {
  return {
    id: '7e0c8de2-72e8-4d0e-bb16-7a40f87b97e1',
    code: 'demo.notes',
    name: 'Notes',
    description: null,
    valueType: 'string',
    ownerModule: 'demo',
    salesChannelCodes: [],
    defaultValue: '',
    globalValue: null,
    valuesByChannel: [],
    version: '2026-10-11T10:00:00.000Z',
    editable: true,
    activationControl: false,
    ...overrides,
  } as SettingDto;
}

interface RenderOptions {
  readonly setting?: SettingDto;
  readonly draft?: SettingDraft;
  readonly channelContext?: string | null;
  readonly contributions?: AdminContributions | null;
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}

function row(options: RenderOptions): ReactElement {
  return (
    <SettingRowEditor
      setting={options.setting ?? setting()}
      draft={options.draft ?? { text: '', initialText: '' }}
      channelContext={options.channelContext ?? null}
      isCopied={false}
      resetting={false}
      onChange={vi.fn()}
      onCopyCode={vi.fn()}
      onReset={vi.fn()}
    />
  );
}

function renderRow(options: RenderOptions = {}): HTMLElement {
  cleanup();
  const contributions = options.contributions === undefined ? contribution() : options.contributions;
  const { container } = renderWithI18n(
    withSession(row(options), {
      session: adminSession({ permissions: [...(options.permissions ?? ['settings:read', 'probe:read'])] }),
      presence: modulePresence({ present: [...(options.present ?? ['settings', 'blog'])] }),
      contributions: contributions === null ? [] : registry(contributions),
    }),
    BUNDLE,
  );
  return container;
}

async function probeProps(): Promise<ZoneProps> {
  const probe = await screen.findByTestId('after-probe');
  return JSON.parse(probe.textContent ?? '') as ZoneProps;
}

/**
 * A row's markup with React's per-render ids taken out, so two renders compare.
 * The shared helper, because the row's `FormField` derives ids from one
 * (`<id>-label`, `<id>-control`) in React 19.2's `_r_1a_` form, which a
 * whole-attribute match does not see (issue #1478).
 */
const markup = rowMarkup;

afterEach(() => cleanup());

describe('SettingRowEditor — the settings.setting.after zone', () => {
  it('mounts the zone once, with the setting, its owner, the channel and the field’s text', async () => {
    renderRow({
      setting: setting({ globalValue: 'Allow: /' }),
      draft: { text: 'Allow: /', initialText: 'Allow: /' },
    });
    expect(await probeProps()).toEqual({
      settingCode: 'demo.notes',
      ownerModule: 'demo',
      channelCode: null,
      draftText: 'Allow: /',
      dirty: false,
    });
    expect(screen.getAllByTestId('after-probe')).toHaveLength(1);
  });

  it('passes the unsaved text and says it is unsaved', async () => {
    renderRow({
      setting: setting({ multiline: true, globalValue: 'saved\n' }),
      draft: { text: 'typed\nnot saved\n', initialText: 'saved\n' },
    });
    const props = await probeProps();
    expect(props.draftText).toBe('typed\nnot saved\n');
    expect(props.dirty).toBe(true);
  });

  it('passes the sales channel the row is being edited under', async () => {
    renderRow({ channelContext: 'pl' });
    expect((await probeProps()).channelCode).toBe('pl');
  });

  it('renders the contribution below the field, inside the row', async () => {
    const container = renderRow();
    const probe = await screen.findByTestId('after-probe');
    const field = container.querySelector('input[type="text"]') as HTMLElement;
    expect(field.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.firstElementChild?.contains(probe)).toBe(true);
  });

  it.each([
    ['number', '42'],
    ['boolean', 'true'],
    ['json', '{"a":1}'],
    ['string_list', 'a, b'],
  ] as const)('hands a %s setting no draft text: only a string’s text is its value', async (valueType, text) => {
    renderRow({
      setting: setting({ valueType, defaultValue: null }),
      draft: { text, initialText: '' },
    });
    const props = await probeProps();
    expect(props.draftText).toBeNull();
    expect(props.dirty).toBe(true);
  });

  it('does not mount the zone for a secret: a contribution never receives a secret’s draft', async () => {
    const container = renderRow({
      setting: setting({ code: 'demo.api_key', valueType: 'secret', defaultValue: null, globalValueIsSet: true }),
      draft: { text: 'hunter2', initialText: '' },
    });
    // The control: the same contribution does render beside a non-secret row.
    await waitFor(() => expect(container.querySelector('input[type="password"]')).not.toBeNull());
    await new Promise((done) => setTimeout(done, 20));
    expect(screen.queryByTestId('after-probe')).toBeNull();
    expect(container.innerHTML).not.toContain('hunter2"}');
    renderRow({ draft: { text: 'hunter2', initialText: '' } });
    expect((await probeProps()).draftText).toBe('hunter2');
  });

  it('shows a contribution matched to this setting, and not one matched to another', async () => {
    renderRow({ contributions: contribution({ settingCode: 'demo.notes' }) });
    expect((await probeProps()).settingCode).toBe('demo.notes');

    const baseline = markup(renderRow({ contributions: null }));
    const other = renderRow({ contributions: contribution({ settingCode: 'demo.other' }) });
    await new Promise((done) => setTimeout(done, 20));
    expect(markup(other)).toBe(baseline);
  });

  it('is the row without the zone when the contributor is switched off', async () => {
    const baseline = markup(renderRow({ contributions: null }));
    const off = renderRow({ present: ['settings'] });
    await new Promise((done) => setTimeout(done, 20));
    expect(markup(off)).toBe(baseline);
  });

  it('is the row without the zone for somebody without the contribution’s permission', async () => {
    const baseline = markup(renderRow({ contributions: null }));
    const refused = renderRow({ permissions: ['settings:read'] });
    await new Promise((done) => setTimeout(done, 20));
    expect(markup(refused)).toBe(baseline);
  });

  it('is the control: the row does differ once the contribution is shown', async () => {
    const baseline = markup(renderRow({ contributions: null }));
    const shown = renderRow();
    await screen.findByTestId('after-probe');
    expect(markup(shown)).not.toBe(baseline);
  });

  it('keeps the row when a contribution fails to render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const container = renderRow({ contributions: contribution(undefined, Broken) });
      await new Promise((done) => setTimeout(done, 20));
      expect(container.querySelector('input[type="text"]')).not.toBeNull();
      expect(screen.getByText('Notes')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('leaves the host naming no contributor and knowing nothing of what is shown', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/settings/src/admin/components/SettingRowEditor.tsx'),
      'utf8',
    );
    expect(source.match(/<AdminZone\b/g)).toHaveLength(1);
    expect(source).toContain('name="settings.setting.after"');
    expect(source).not.toMatch(/robots|crawler|llms|mod-seo|['"]seo[.'"]/i);
    const manifest = readFileSync(
      resolve(process.cwd(), '../packages/modules/settings/package.json'),
      'utf8',
    );
    expect(manifest).not.toContain('mod-seo');
  });
});

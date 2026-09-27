import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveAllData, type ComponentConfig, type Config, type Data } from '@measured/puck';
import type { ReactElement } from 'react';
import {
  withDescribedInvoiceBlocks,
  type DescribedBlockText,
  type InvoiceBuilderDescriptor,
} from '../../../../packages/modules/invoices/src/admin/templates/described-blocks';
import {
  invoicePuckConfig,
  invoicePuckPalette,
} from '../../../../packages/modules/invoices/src/admin/templates/invoice-puck-config';

/**
 * `specs/134-paid-module-extraction/` T138 (`research.md` D22 §3(b)) — the
 * invoice editor reaches a block another module declares through the served
 * descriptor, and keeps a stored block nothing covers as FR-019's placeholder.
 *
 * **Not α.** No admin contribution kind: the entry is built from the
 * descriptor's data, and its canvas render is a neutral stand-in — the PDF,
 * rendered server-side through the owning module's registration, is the true
 * preview. The names below are fixtures on purpose; the merge takes its keys
 * from data, so `invoices`' admin carries no other module's block name.
 */

const BASE: Config = { ...invoicePuckConfig, categories: invoicePuckPalette };

const TEXT: DescribedBlockText = {
  standIn: ({ label, owner }) => `${label} is drawn on the PDF by module ${owner}.`,
  placeholder: ({ owner, name }) =>
    owner === null ? `placeholder:${name}` : `placeholder:${owner}:${name}`,
};

const DESCRIPTOR: InvoiceBuilderDescriptor = {
  components: [
    ...Object.keys(invoicePuckConfig.components ?? {}).map((name) => ({
      name,
      ownerModule: 'invoices',
      label: name,
      fields: {},
    })),
    {
      name: 'acme.Stamp',
      ownerModule: 'acme',
      label: 'Stamp',
      fields: {
        caption: { type: 'text', label: 'Caption' },
        ink: { type: 'color', label: 'Ink' },
        size: { type: 'number', label: 'Size' },
        framed: { type: 'radio', label: 'Framed', options: [{ label: 'Yes', value: true }] },
      },
    },
  ],
};

function componentOf(config: Config, name: string): ComponentConfig {
  const component = (config.components as Record<string, ComponentConfig> | undefined)?.[name];
  expect(component, `${name} has no config`).toBeDefined();
  return component!;
}

function categorised(config: Config): string[] {
  return Object.entries(config.categories ?? {})
    .filter(([, category]) => category?.visible !== false)
    .flatMap(([, category]) => (category?.components ?? []) as string[]);
}

function renderComponent(component: ComponentConfig, props: Record<string, unknown>): void {
  const Render = component.render as (p: Record<string, unknown>) => ReactElement;
  render(<Render {...props} id="x" puck={{ isEditing: true }} />);
}

describe('withDescribedInvoiceBlocks (134 T138)', () => {
  it('builds a described block from the descriptor, fields one to one', () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, [], TEXT);
    const stamp = componentOf(config, 'acme.Stamp');
    expect(stamp.label).toBe('Stamp');
    const fields = stamp.fields as Record<string, { type: string; label?: string }>;
    expect(Object.keys(fields)).toEqual(['caption', 'ink', 'size', 'framed']);
    expect(fields['caption']).toMatchObject({ type: 'text', label: 'Caption' });
    expect(fields['size']).toMatchObject({ type: 'number', label: 'Size' });
    expect(fields['framed']).toMatchObject({ type: 'radio', label: 'Framed' });
    // `color` is the shared colour field, a custom Puck field — not a bare type.
    expect(fields['ink']?.type).toBe('custom');
    expect(fields['ink']?.label).toBe('Ink');
  });

  it('lists the described block in the invoice palette category, so it is insertable', () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, [], TEXT);
    expect(config.categories?.['invoice']?.components).toContain('acme.Stamp');
  });

  it('renders the described block as the neutral stand-in', () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, [], TEXT);
    renderComponent(componentOf(config, 'acme.Stamp'), {});
    expect(screen.getByText('Stamp is drawn on the PDF by module acme.')).toBeDefined();
  });

  it('keeps a stored name nothing covers as a visible placeholder that is not in the palette', async () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, ['gone.Seal'], TEXT);
    const seal = componentOf(config, 'gone.Seal');
    renderComponent(seal, {});
    expect(screen.getByText('placeholder:gone:gone.Seal')).toBeDefined();
    expect(categorised(config)).not.toContain('gone.Seal');

    // Round trip through Puck's own data resolution: the stored props survive.
    const stored = { id: 'seal-1', caption: 'kept', nested: { a: 1 } };
    const data: Data = { root: { props: {} }, content: [{ type: 'gone.Seal', props: stored }] };
    const resolved = await resolveAllData(data, config);
    expect(resolved.content[0]?.props).toEqual(stored);
  });

  it('gives an unnamespaced unknown name a placeholder with no owner', () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, ['LegacyBlock'], TEXT);
    renderComponent(componentOf(config, 'LegacyBlock'), {});
    expect(screen.getByText('placeholder:LegacyBlock')).toBeDefined();
  });

  it('returns invoices’ own ten blocks unchanged', () => {
    const config = withDescribedInvoiceBlocks(BASE, DESCRIPTOR, ['gone.Seal'], TEXT);
    for (const [name, component] of Object.entries(invoicePuckConfig.components ?? {})) {
      expect(componentOf(config, name)).toBe(component);
    }
    expect(Object.keys(invoicePuckConfig.components ?? {})).toHaveLength(10);
  });

  it('still keeps every stored unknown name when the descriptor could not be fetched', () => {
    const config = withDescribedInvoiceBlocks(BASE, null, ['acme.Stamp', 'gone.Seal'], TEXT);
    expect(Object.keys(config.components ?? {})).toEqual(
      expect.arrayContaining(['acme.Stamp', 'gone.Seal']),
    );
    renderComponent(componentOf(config, 'acme.Stamp'), {});
    expect(screen.getByText('placeholder:acme:acme.Stamp')).toBeDefined();
    expect(categorised(config)).not.toContain('acme.Stamp');
  });
});

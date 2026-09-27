import type { CSSProperties, ReactElement } from 'react';
import type { ComponentConfig, Config, Field } from '@measured/puck';
import type { InvoiceTemplateBlockField } from '@endora-commerce/contracts';
import { createColorField, ownerOf } from '@endora-commerce/page-builder-core';

/**
 * The invoice editor's view of blocks it has no React binding for —
 * `specs/134-paid-module-extraction/` T138 (`research.md` D22 §3(b)).
 *
 * `invoicePuckConfig` binds this module's own ten blocks. A block another
 * module declares reaches the editor as **data**: the served descriptor
 * (`GET /api/v1/admin/invoice-templates/page-builder/config`) lists every
 * present contributor's block with its label and fields, and this merge turns
 * each one the local map does not bind into a config Puck can insert and
 * configure. Its canvas render is a neutral stand-in; the *Preview PDF* button
 * renders it for real, server-side, through the contributor's registration.
 *
 * **This is not a contribution kind (α).** No module hands this editor React;
 * the keys come from the descriptor at runtime, so this module's admin names no
 * other module's block. The shape is the CMS editor's `mergeConfig` and
 * FR-019's degradation merge, applied to this surface.
 *
 * **A stored name nothing covers** — its module off, not installed, or a name
 * nobody recognises (`specs/096-page-builder-block-ownership/` FR-019, FR-020,
 * identical for all three) — gets a visible, data-preserving placeholder that
 * is **not** in the palette: it stays where it is, and nobody may insert it.
 * It is built here rather than taken from `@endora-commerce/cms-components`,
 * whose placeholder speaks about storefront builds and would bring that
 * package's peers into this module.
 *
 * Strings arrive through `text` so they are translated by the caller, and both
 * are statements of fact on the surface where the block sits (D-265): no link,
 * no action, and a palette that only ever lists present contributors.
 */

/** One block as the served descriptor describes it. */
export interface InvoiceBuilderDescriptorEntry {
  readonly name: string;
  readonly ownerModule: string;
  readonly label: string;
  readonly fields: Readonly<Record<string, InvoiceTemplateBlockField>>;
}

/** The served descriptor, as the editor reads it. */
export interface InvoiceBuilderDescriptor {
  readonly components: readonly InvoiceBuilderDescriptorEntry[];
}

/** The two sentences this merge renders, already translated. */
export interface DescribedBlockText {
  /** A present contributor's block on the canvas. */
  standIn(input: { readonly label: string; readonly owner: string }): string;
  /** A stored block nothing covers; `owner` is `null` for a name that states none. */
  placeholder(input: { readonly owner: string | null; readonly name: string }): string;
}

/** The one palette section this editor has. */
export const INVOICE_PALETTE_CATEGORY = 'invoice';

const noteStyle: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  color: '#475569',
  background: '#f8fafc',
  border: '1px dashed #cbd5e1',
  borderRadius: 4,
  padding: '8px 10px',
  margin: '6px 0',
};

function Note({ text }: { readonly text: string }): ReactElement {
  return (
    <div role="note" style={noteStyle}>
      {text}
    </div>
  );
}

function puckField(field: InvoiceTemplateBlockField): Field {
  if (field.type === 'color') return createColorField({ label: field.label }) as Field;
  if (field.type === 'select' || field.type === 'radio') {
    return { type: field.type, label: field.label, options: [...(field.options ?? [])] } as Field;
  }
  return { type: field.type, label: field.label } as Field;
}

function describedBlock(entry: InvoiceBuilderDescriptorEntry, text: DescribedBlockText): ComponentConfig {
  const sentence = text.standIn({ label: entry.label, owner: entry.ownerModule });
  const fields: Record<string, Field> = {};
  for (const [key, field] of Object.entries(entry.fields)) fields[key] = puckField(field);
  return {
    label: entry.label,
    fields,
    render: () => <Note text={sentence} />,
  } as ComponentConfig;
}

function placeholderBlock(name: string, text: DescribedBlockText): ComponentConfig {
  const sentence = text.placeholder({ owner: ownerOf(name), name });
  // No fields and no defaults: Puck neither offers nor writes a prop, so every
  // stored prop goes back through a save exactly as it came.
  return {
    label: name,
    fields: {},
    render: () => <Note text={sentence} />,
  } as ComponentConfig;
}

/**
 * `config` plus every present contributor's described block (insertable, in
 * the invoice category) and a placeholder for every stored name neither covers
 * (not in any category). `descriptor` is `null` when it could not be fetched:
 * nothing is then described, and every stored unknown name is kept.
 *
 * Entries the local map already binds are left exactly as they are.
 */
export function withDescribedInvoiceBlocks(
  config: Config,
  descriptor: InvoiceBuilderDescriptor | null,
  storedNames: Iterable<string>,
  text: DescribedBlockText,
): Config {
  const local = (config.components ?? {}) as Record<string, ComponentConfig>;
  const components: Record<string, ComponentConfig> = { ...local };
  const described: string[] = [];

  for (const entry of descriptor?.components ?? []) {
    if (entry.name in components) continue;
    components[entry.name] = describedBlock(entry, text);
    described.push(entry.name);
  }
  for (const name of new Set(storedNames)) {
    if (name in components) continue;
    components[name] = placeholderBlock(name, text);
  }

  const categories = { ...(config.categories ?? {}) } as NonNullable<Config['categories']>;
  const section = categories[INVOICE_PALETTE_CATEGORY];
  if (described.length > 0) {
    categories[INVOICE_PALETTE_CATEGORY] = {
      ...section,
      components: [...(section?.components ?? []), ...described],
    };
  }
  // A placeholder belongs to no category, and Puck would otherwise list every
  // uncategorised name under "Other" — which would make it insertable.
  categories.other = { ...categories.other, visible: false };

  return { ...config, components, categories } as Config;
}

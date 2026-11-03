import {
  FORM_ADDRESS_PARTS,
  neutraliseSpreadsheetCell,
  type FormAddressPart,
  type FormDefinition,
  type FormEntryStatus,
  type FormFieldType,
} from '@endora-commerce/contracts';

/**
 * The CSV export of one form's entries (`specs/170-forms-module/` US4-4, FR-052, research R-18):
 * built here, in the module, because `import_export` neither filters nor should depend on `forms`.
 *
 * - **Columns**: the metadata, then one column per field key across **every** version of the form —
 *   in the order the keys first appear — so an entry of any version has its place; an address is
 *   expanded into the parts any version enabled (`<key>.street|line2|postal_code|city|country`).
 * - **Cells**: a checkbox group joined by `; `, a consent or a checkbox `yes`/`no`; every cell that a
 *   spreadsheet would read as a formula (`=`, `+`, `-`, `@`, tab, CR) prefixed with `'`, then quoted
 *   where CSV needs it.
 * - **Streaming**: a UTF-8 byte-order mark and the header first, then the rows of one keyset batch
 *   of {@link EXPORT_BATCH_SIZE} at a time, read only when the consumer asks for the next row — the
 *   export holds one batch in memory however many entries the form has.
 *
 * Notes are never exported (FR-049): the reader hands over entries, and an entry carries none.
 */

export const EXPORT_BATCH_SIZE = 500;

const METADATA = ['entry_id', 'form_key', 'form_version', 'status', 'sales_channel', 'language', 'submitted_at', 'page_url'] as const;

/** An address part as its column is spelled. */
const PART_HEADER: Readonly<Record<FormAddressPart, string>> = {
  street: 'street',
  line2: 'line2',
  postalCode: 'postal_code',
  city: 'city',
  country: 'country',
};

export type ExportColumn =
  | { readonly kind: 'meta'; readonly header: (typeof METADATA)[number] }
  | { readonly kind: 'answer'; readonly header: string; readonly key: string; readonly type: FormFieldType }
  | { readonly kind: 'part'; readonly header: string; readonly key: string; readonly part: FormAddressPart };

export interface ExportVersion {
  readonly number: number;
  readonly definition: FormDefinition;
}

/** The columns of a form's export, from all its versions in number order. */
export function exportColumns(versions: readonly ExportVersion[]): ExportColumn[] {
  const order: string[] = [];
  const typeOf = new Map<string, FormFieldType>();
  const partsOf = new Map<string, Set<FormAddressPart>>();
  for (const version of [...versions].sort((a, b) => a.number - b.number)) {
    for (const section of version.definition.sections) {
      for (const field of section.fields) {
        if (!('key' in field)) continue;
        if (!typeOf.has(field.key)) order.push(field.key);
        typeOf.set(field.key, field.type);
        if (field.type === 'address') {
          const enabled = partsOf.get(field.key) ?? new Set<FormAddressPart>();
          for (const part of FORM_ADDRESS_PARTS) if (field.parts[part].enabled) enabled.add(part);
          partsOf.set(field.key, enabled);
        }
      }
    }
  }
  const columns: ExportColumn[] = METADATA.map((header) => ({ kind: 'meta', header }));
  for (const key of order) {
    const type = typeOf.get(key)!;
    if (type === 'address') {
      const enabled = partsOf.get(key)!;
      for (const part of FORM_ADDRESS_PARTS) {
        if (enabled.has(part)) columns.push({ kind: 'part', header: `${key}.${PART_HEADER[part]}`, key, part });
      }
    } else {
      columns.push({ kind: 'answer', header: key, key, type });
    }
  }
  return columns;
}

/** What the export reads of one entry — never a note, never the attribution. */
export interface ExportEntry {
  readonly id: string;
  readonly formVersionNumber: number;
  readonly status: FormEntryStatus;
  readonly salesChannelId: string;
  readonly language: string;
  readonly submittedAt: Date;
  readonly pageUrl: string | null;
  readonly answers: Readonly<Record<string, unknown>>;
}

/** Where the next batch starts: after this entry, in `(submitted_at desc, id desc)` order. */
export interface ExportCursor {
  readonly submittedAt: Date;
  readonly id: string;
}

export interface EntriesCsvInput {
  readonly columns: readonly ExportColumn[];
  readonly formKey: string;
  /** How a channel is named in the `sales_channel` column (its code, else its id). */
  readonly channelLabel: (salesChannelId: string) => string;
  /** One keyset batch, newest first, after `after` (or from the newest when `null`). */
  readonly readBatch: (after: ExportCursor | null, size: number) => Promise<readonly ExportEntry[]>;
  readonly batchSize?: number;
}

/** One answer as text: a list joined, a yes/no for a boolean, an address part by name. */
function answerText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map(String).join('; ');
  if (typeof value === 'object') return '';
  return String(value);
}

/** A CSV cell: neutralised for spreadsheets, then quoted when it holds a separator, a quote or a break. */
function cell(raw: string): string {
  const safe = neutraliseSpreadsheetCell(raw);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function line(cells: readonly string[]): string {
  return `${cells.map(cell).join(',')}\r\n`;
}

function rowOf(entry: ExportEntry, input: EntriesCsvInput): string[] {
  return input.columns.map((column) => {
    if (column.kind === 'meta') {
      switch (column.header) {
        case 'entry_id':
          return entry.id;
        case 'form_key':
          return input.formKey;
        case 'form_version':
          return String(entry.formVersionNumber);
        case 'status':
          return entry.status;
        case 'sales_channel':
          return input.channelLabel(entry.salesChannelId);
        case 'language':
          return entry.language;
        case 'submitted_at':
          return entry.submittedAt.toISOString();
        case 'page_url':
          return entry.pageUrl ?? '';
      }
    }
    const value = entry.answers[column.key];
    if (column.kind === 'part') {
      const address = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      return answerText(address[column.part]);
    }
    return answerText(value);
  });
}

/** The export, chunk by chunk: the byte-order mark with the header, then one row per chunk. */
export async function* entriesCsv(input: EntriesCsvInput): AsyncGenerator<string> {
  const size = input.batchSize ?? EXPORT_BATCH_SIZE;
  yield `﻿${line(input.columns.map((column) => column.header))}`;
  let after: ExportCursor | null = null;
  for (;;) {
    const batch = await input.readBatch(after, size);
    for (const entry of batch) yield line(rowOf(entry, input));
    if (batch.length < size) return;
    const last = batch[batch.length - 1]!;
    after = { submittedAt: last.submittedAt, id: last.id };
  }
}

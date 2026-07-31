/** Build nested sample context from email variable descriptors (client + shared). */

export interface SampleVariableInput {
  key: string;
  sampleValue?: string | undefined;
}

function parseSampleLeaf(raw: string | undefined, key: string): unknown {
  if (raw == null || raw === '') return `{${key}}`;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Nested object from dotted keys; JSON sampleValue becomes arrays/objects. */
export function buildSampleVariableContext(
  variables: ReadonlyArray<SampleVariableInput>,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { ...extras };
  for (const v of variables) {
    const parts = v.key.split('.');
    let cur = ctx;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!part) continue;
      if (typeof cur[part] !== 'object' || cur[part] === null || Array.isArray(cur[part])) {
        cur[part] = {};
      }
      cur = cur[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (leaf) cur[leaf] = parseSampleLeaf(v.sampleValue, v.key);
  }
  return ctx;
}

/** Default sample items for order summaries when no descriptor sample is set. */
export const DEFAULT_ORDER_ITEMS_SAMPLE = [
  { name: 'Widget A', sku: 'W-A', quantity: 2, price: '120,00 PLN' },
  { name: 'Widget B', sku: 'W-B', quantity: 1, price: '990,00 PLN' },
];

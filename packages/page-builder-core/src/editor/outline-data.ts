export type PuckItem = {
  type: string;
  props: Record<string, unknown>;
};

export function normalizePuckItem(value: unknown): PuckItem | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record.type === 'string' && record.props && typeof record.props === 'object') {
    return { type: record.type, props: record.props as Record<string, unknown> };
  }

  if (typeof record.type === 'string') {
    const { type, ...rest } = record;
    return { type, props: rest };
  }

  return null;
}

export function isPuckItem(value: unknown): value is PuckItem {
  return normalizePuckItem(value) !== null;
}

export function toPuckItemArray(value: unknown): PuckItem[] {
  if (!Array.isArray(value)) return [];
  const items: PuckItem[] = [];
  for (const entry of value) {
    const normalized = normalizePuckItem(entry);
    if (normalized) items.push(normalized);
  }
  return items;
}

export function isPuckItemArray(value: unknown): value is PuckItem[] {
  return toPuckItemArray(value).length > 0;
}

/** Normalize Puck root content from app state — always returns an array. */
export function extractRootContent(data: unknown): PuckItem[] {
  if (Array.isArray(data)) {
    return toPuckItemArray(data);
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const tree = data as Record<string, unknown>;
  const content = tree['content'];

  if (Array.isArray(content)) {
    const items = toPuckItemArray(content);
    if (items.length > 0) {
      return items;
    }
  }

  const zones = tree['zones'];
  if (zones && typeof zones === 'object') {
    const zoneMap = zones as Record<string, unknown>;
    const rootZone =
      zoneMap['root:default-zone'] ??
      zoneMap['root:content'] ??
      Object.entries(zoneMap).find(([key]) => key.startsWith('root:'))?.[1];

    return toPuckItemArray(rootZone);
  }

  return [];
}

/** Collect nested slot/component arrays from props (Row content, Columns columnItems, etc.). */
export function collectChildItems(props: Record<string, unknown>): PuckItem[] {
  const children: PuckItem[] = [];

  for (const value of Object.values(props)) {
    children.push(...toPuckItemArray(value));

    if (!Array.isArray(value)) continue;

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      children.push(...toPuckItemArray(record['content']));
    }
  }

  return children;
}

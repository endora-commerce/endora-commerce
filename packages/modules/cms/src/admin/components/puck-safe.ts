import type { Data } from '@measured/puck';

type PuckItem = { type: string; props: Record<string, unknown> };

export function safeGetPuckData(
  read: () => Data | undefined,
): Data | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function safeGetPuckItem(
  getItemById: (id: string) => PuckItem | undefined,
  id: string | null | undefined,
): PuckItem | undefined {
  if (!id) return undefined;
  try {
    return getItemById(id);
  } catch {
    return undefined;
  }
}

export function isPuckItemType(
  item: PuckItem | undefined,
  type: string,
): item is PuckItem {
  return item?.type === type;
}

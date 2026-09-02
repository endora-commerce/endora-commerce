import { normalize } from '../../lib/text-normalization.js';

export interface CategoryTreePickerCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

export interface CategoryTreeNode {
  category: CategoryTreePickerCategory;
  depth: number;
  children: CategoryTreeNode[];
}

const LOCALE_BY_ADMIN_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  pl: 'pl-PL',
};

export function adminLanguageToLocale(language: string): string {
  return LOCALE_BY_ADMIN_LANGUAGE[language] ?? 'en-US';
}

export function pickCategoryDisplayName(
  name: Record<string, string>,
  slug: string,
  locale: string,
): string {
  const direct = name[locale]?.trim();
  if (direct) return direct;
  const en = name['en-US']?.trim();
  if (en) return en;
  const first = Object.values(name).find((v) => v?.trim());
  if (first?.trim()) return first.trim();
  return slug;
}

export function buildCategoryTree(rows: CategoryTreePickerCategory[]): CategoryTreeNode[] {
  const byParent = new Map<string | null, CategoryTreePickerCategory[]>();
  for (const row of rows) {
    const key = row.parentCategoryId;
    const arr = byParent.get(key) ?? [];
    arr.push(row);
    byParent.set(key, arr);
  }

  function build(parentId: string | null, depth: number): CategoryTreeNode[] {
    return (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
      .map((category) => ({
        category,
        depth,
        children: build(category.id, depth + 1),
      }));
  }

  return build(null, 0);
}

export function flattenCategoryTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  const out: CategoryTreeNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenCategoryTree(node.children));
  }
  return out;
}

/** Returns visible nodes when filter is active (matched nodes + ancestors). */
export function filterCategoryTree(
  nodes: CategoryTreeNode[],
  query: string,
  locale: string,
): CategoryTreeNode[] {
  const q = normalize(query);
  if (!q) return nodes;

  function filterList(list: CategoryTreeNode[]): CategoryTreeNode[] {
    const out: CategoryTreeNode[] = [];
    for (const node of list) {
      const label = pickCategoryDisplayName(node.category.name, node.category.slug, locale);
      const selfMatch = normalize(label).includes(q);
      const filteredChildren = filterList(node.children);
      if (selfMatch || filteredChildren.length > 0) {
        out.push({
          ...node,
          children: filteredChildren,
        });
      }
    }
    return out;
  }

  return filterList(nodes);
}

/** Node ids that must render expanded while a filter is active. */
export function expandedIdsForFilteredTree(nodes: CategoryTreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: CategoryTreeNode[]): void {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.add(node.category.id);
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return ids;
}

/** True when this node or any descendant is in `selected`. */
export function subtreeHasSelection(node: CategoryTreeNode, selected: ReadonlySet<string>): boolean {
  if (selected.has(node.category.id)) return true;
  return node.children.some((child) => subtreeHasSelection(child, selected));
}

/**
 * Parent nodes that should show indeterminate checkbox: some descendant is
 * selected but the parent itself is not.
 */
export function computeParentIndeterminateIds(
  nodes: CategoryTreeNode[],
  selected: ReadonlySet<string>,
): Set<string> {
  const indeterminate = new Set<string>();

  function walk(node: CategoryTreeNode): boolean {
    let anyBelow = false;
    for (const child of node.children) {
      if (walk(child)) anyBelow = true;
    }
    const self = selected.has(node.category.id);
    if (anyBelow && !self && node.children.length > 0) {
      indeterminate.add(node.category.id);
    }
    return self || anyBelow;
  }

  for (const root of nodes) walk(root);
  return indeterminate;
}

/** Ancestor category ids to expand so deep selections stay visible. */
export function ancestorIdsForSelected(
  categories: CategoryTreePickerCategory[],
  selected: ReadonlySet<string>,
): Set<string> {
  const parentById = new Map(categories.map((c) => [c.id, c.parentCategoryId]));
  const ancestors = new Set<string>();
  for (const id of selected) {
    let parentId = parentById.get(id) ?? null;
    while (parentId) {
      ancestors.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
  return ancestors;
}

export function visibleFlattenedTree(
  nodes: CategoryTreeNode[],
  expandedIds: Set<string>,
  filterActive: boolean,
): Array<{ node: CategoryTreeNode; expanded: boolean; hasChildren: boolean }> {
  const rows: Array<{ node: CategoryTreeNode; expanded: boolean; hasChildren: boolean }> = [];

  function walk(list: CategoryTreeNode[]): void {
    for (const node of list) {
      const hasChildren = node.children.length > 0;
      const expanded = filterActive || expandedIds.has(node.category.id);
      rows.push({ node, expanded, hasChildren });
      if (hasChildren && expanded) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return rows;
}

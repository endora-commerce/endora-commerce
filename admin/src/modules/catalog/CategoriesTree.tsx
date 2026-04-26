import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Categories tree editor (T090). Flat list returned by the backend is
 * folded into a tree on the client; rows render with depth-based
 * indentation. Each row exposes inline rename + reparent + delete; a
 * "New child" button on any row creates a child under it.
 *
 * The backend rejects cycle attempts (409) — surfaced via the error
 * banner. Soft-delete refuses if children are still attached.
 */

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

interface TreeNode {
  category: AdminCategory;
  depth: number;
  children: TreeNode[];
}

export function CategoriesTree(): ReactNode {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [createUnderId, setCreateUnderId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminCategory[] }>(
        '/api/v1/admin/catalog/categories',
      );
      setCategories(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tree = useMemo(() => buildTree(categories), [categories]);

  const handleCreate = useCallback(
    async (input: {
      parentCategoryId: string | null;
      slug: string;
      nameEn: string;
      namePl: string;
    }): Promise<void> => {
      try {
        const name: Record<string, string> = {};
        if (input.nameEn) name['en-US'] = input.nameEn;
        if (input.namePl) name['pl-PL'] = input.namePl;
        await apiClient.post<{ data: AdminCategory }>('/api/v1/admin/catalog/categories', {
          parentCategoryId: input.parentCategoryId,
          slug: input.slug,
          name,
        });
        setInfo('Category created.');
        setCreateUnderId(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const handleUpdate = useCallback(
    async (
      id: string,
      input: { slug?: string; nameEn?: string; namePl?: string; parentCategoryId?: string | null },
    ): Promise<void> => {
      const payload: Record<string, unknown> = {};
      if (input.slug !== undefined) payload['slug'] = input.slug;
      if (input.parentCategoryId !== undefined) payload['parentCategoryId'] = input.parentCategoryId;
      if (input.nameEn !== undefined || input.namePl !== undefined) {
        const existing = categories.find((c) => c.id === id);
        const name: Record<string, string> = { ...(existing?.name ?? {}) };
        if (input.nameEn !== undefined) name['en-US'] = input.nameEn;
        if (input.namePl !== undefined) name['pl-PL'] = input.namePl;
        payload['name'] = name;
      }
      try {
        await apiClient.patch<{ data: AdminCategory }>(
          `/api/v1/admin/catalog/categories/${id}`,
          payload,
        );
        setInfo('Saved.');
        setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Update failed.');
      }
    },
    [refresh, categories],
  );

  const handleDelete = useCallback(
    async (cat: AdminCategory): Promise<void> => {
      if (!confirm(`Delete category "${pickName(cat.name)}"?`)) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/catalog/categories/${cat.id}`);
        setInfo('Deleted.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Categories</h1>
          <p>Hierarchical tree. Cycles + non-empty deletions are rejected by the backend.</p>
        </div>
        <button
          className="btn btn--primary"
          type="button"
          onClick={(): void => setCreateUnderId('__root__')}
        >
          New root category
        </button>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      {createUnderId === '__root__' ? (
        <CreateForm
          parentLabel="(root)"
          onCancel={(): void => setCreateUnderId(null)}
          onSubmit={(input): void => void handleCreate({ parentCategoryId: null, ...input })}
        />
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tree.length === 0 ? (
        <p className="muted">No categories yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Slug</th>
              <th>Sort</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flatten(tree).map(({ category: c, depth }) => (
              <>
                <tr key={c.id}>
                  <td style={{ paddingLeft: depth * 24 + 8 }}>
                    {editing === c.id ? (
                      <EditForm
                        category={c}
                        categories={categories}
                        onCancel={(): void => setEditing(null)}
                        onSubmit={(input): void => void handleUpdate(c.id, input)}
                      />
                    ) : (
                      <>
                        <strong>{pickName(c.name)}</strong>
                      </>
                    )}
                  </td>
                  <td>{c.slug}</td>
                  <td>{c.sortOrder}</td>
                  <td>
                    {editing === c.id ? null : (
                      <>
                        <button className="btn" type="button" onClick={(): void => setEditing(c.id)}>
                          Edit
                        </button>{' '}
                        <button
                          className="btn"
                          type="button"
                          onClick={(): void => setCreateUnderId(c.id)}
                        >
                          New child
                        </button>{' '}
                        <button
                          className="btn btn--danger"
                          type="button"
                          onClick={(): void => void handleDelete(c)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {createUnderId === c.id ? (
                  <tr key={c.id + ':new'}>
                    <td colSpan={4} style={{ paddingLeft: depth * 24 + 32 }}>
                      <CreateForm
                        parentLabel={pickName(c.name)}
                        onCancel={(): void => setCreateUnderId(null)}
                        onSubmit={(input): void =>
                          void handleCreate({ parentCategoryId: c.id, ...input })
                        }
                      />
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CreateForm({
  parentLabel,
  onSubmit,
  onCancel,
}: {
  parentLabel: string;
  onSubmit: (input: { slug: string; nameEn: string; namePl: string }) => void;
  onCancel: () => void;
}): ReactNode {
  const [slug, setSlug] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  return (
    <form
      className="card"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        onSubmit({ slug, nameEn, namePl });
      }}
    >
      <p>
        New category under <strong>{parentLabel}</strong>
      </p>
      <div className="field">
        <label>Slug</label>
        <input
          className="input"
          value={slug}
          onChange={(e): void => setSlug(e.target.value.toLowerCase())}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="kebab-case"
        />
      </div>
      <div className="field">
        <label>Name [en-US]</label>
        <input className="input" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
      </div>
      <div className="field">
        <label>Name [pl-PL]</label>
        <input className="input" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
      </div>
      <button className="btn btn--primary" type="submit">
        Create
      </button>{' '}
      <button className="btn" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function EditForm({
  category,
  categories,
  onSubmit,
  onCancel,
}: {
  category: AdminCategory;
  categories: AdminCategory[];
  onSubmit: (input: {
    slug: string;
    nameEn: string;
    namePl: string;
    parentCategoryId: string | null;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [slug, setSlug] = useState(category.slug);
  const [nameEn, setNameEn] = useState(category.name['en-US'] ?? '');
  const [namePl, setNamePl] = useState(category.name['pl-PL'] ?? '');
  const [parentId, setParentId] = useState<string>(category.parentCategoryId ?? '');
  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        onSubmit({ slug, nameEn, namePl, parentCategoryId: parentId === '' ? null : parentId });
      }}
    >
      <div className="field">
        <label>Slug</label>
        <input
          className="input"
          value={slug}
          onChange={(e): void => setSlug(e.target.value.toLowerCase())}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </div>
      <div className="field">
        <label>Name [en-US]</label>
        <input className="input" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
      </div>
      <div className="field">
        <label>Name [pl-PL]</label>
        <input className="input" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
      </div>
      <div className="field">
        <label>Parent</label>
        <select
          className="input"
          value={parentId}
          onChange={(e): void => setParentId(e.target.value)}
        >
          <option value="">— root —</option>
          {categories
            .filter((c) => c.id !== category.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {pickName(c.name)} ({c.slug})
              </option>
            ))}
        </select>
      </div>
      <button className="btn btn--primary" type="submit">
        Save
      </button>{' '}
      <button className="btn" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function buildTree(rows: AdminCategory[]): TreeNode[] {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const r of rows) {
    const k = r.parentCategoryId;
    const arr = byParent.get(k) ?? [];
    arr.push(r);
    byParent.set(k, arr);
  }
  function build(parentId: string | null, depth: number): TreeNode[] {
    return (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
      .map((c) => ({ category: c, depth, children: build(c.id, depth + 1) }));
  }
  return build(null, 0);
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...flatten(n.children));
  }
  return out;
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}

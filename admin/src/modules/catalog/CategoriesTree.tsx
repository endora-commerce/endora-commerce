import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
      <PageHeader
        title="Categories"
        description="Hierarchical tree. Cycles + non-empty deletions are rejected by the backend."
        actions={
          <Button type="button" onClick={(): void => setCreateUnderId('__root__')}>
            <Plus />
            New root category
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {createUnderId === '__root__' ? (
        <CreateForm
          parentLabel="(root)"
          onCancel={(): void => setCreateUnderId(null)}
          onSubmit={(input): void => void handleCreate({ parentCategoryId: null, ...input })}
        />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatten(tree).map(({ category: c, depth }) => (
                  <Fragment key={c.id}>
                    <TableRow>
                      <TableCell style={{ paddingLeft: depth * 24 + 8 }}>
                        {editing === c.id ? (
                          <EditForm
                            category={c}
                            categories={categories}
                            onCancel={(): void => setEditing(null)}
                            onSubmit={(input): void => void handleUpdate(c.id, input)}
                          />
                        ) : (
                          <span className="font-medium">{pickName(c.name)}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                      <TableCell>{c.sortOrder}</TableCell>
                      <TableCell>
                        {editing === c.id ? null : (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={(): void => setEditing(c.id)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={(): void => setCreateUnderId(c.id)}
                            >
                              <Plus />
                              New child
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              type="button"
                              onClick={(): void => void handleDelete(c)}
                            >
                              <Trash2 />
                              Delete
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {createUnderId === c.id ? (
                      <TableRow>
                        <TableCell colSpan={4} style={{ paddingLeft: depth * 24 + 32 }}>
                          <CreateForm
                            parentLabel={pickName(c.name)}
                            onCancel={(): void => setCreateUnderId(null)}
                            onSubmit={(input): void =>
                              void handleCreate({ parentCategoryId: c.id, ...input })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
    <Card className="mb-4">
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            onSubmit({ slug, nameEn, namePl });
          }}
        >
          <p className="text-sm">
            New category under <strong>{parentLabel}</strong>
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cslug">Slug</Label>
              <Input
                id="cslug"
                value={slug}
                onChange={(e): void => setSlug(e.target.value.toLowerCase())}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="kebab-case"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cen">Name [en-US]</Label>
              <Input id="cen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpl">Name [pl-PL]</Label>
              <Input id="cpl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit">Create</Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        onSubmit({ slug, nameEn, namePl, parentCategoryId: parentId === '' ? null : parentId });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e): void => setSlug(e.target.value.toLowerCase())}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </div>
        <div className="space-y-2">
          <Label>Parent</Label>
          <Select value={parentId} onChange={(e): void => setParentId(e.target.value)}>
            <option value="">— root —</option>
            {categories
              .filter((c) => c.id !== category.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {pickName(c.name)} ({c.slug})
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Name [en-US]</Label>
          <Input value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Name [pl-PL]</Label>
          <Input value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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

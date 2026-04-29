import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AttributeSet,
  AttributeSetDetail,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: string;
}

/**
 * Admin Attribute Sets manager (T030 + T031, feature 002).
 *
 * Single-page module per foundation 001 admin convention:
 *   - inline `useState` + `useEffect` for data fetching,
 *   - direct `apiClient.{get,post,patch,delete}` calls,
 *   - `@b2b/contracts` types as the single source of truth.
 *
 * Renders the list of Attribute Sets, lets the admin create custom
 * ones, expand a row to inspect / edit assigned attributes, and
 * delete non-system sets.
 */
export function AttributeSetsPage(): ReactNode {
  const [sets, setSets] = useState<AttributeSet[]>([]);
  const [allAttributes, setAllAttributes] = useState<AdminAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [setsRes, attrsRes] = await Promise.all([
        apiClient.get<{ data: AttributeSet[] }>('/api/v1/admin/catalog/attribute-sets'),
        apiClient.get<{ data: AdminAttribute[] }>('/api/v1/admin/catalog/attributes'),
      ]);
      setSets(setsRes.data);
      setAllAttributes(attrsRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attribute Sets"
        description="Named groups of Product Attributes. The system Default set ships with every install and cannot be deleted; custom sets can be assigned to Products via the Product editor."
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <CreateAttributeSetForm
        onCreated={(setName) => {
          setInfo(`Created attribute set "${setName}".`);
          void refresh();
        }}
        onError={(msg) => setError(msg)}
      />

      <Card>
        <CardHeader>
          <CardTitle>All sets</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Attributes</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sets.map((s) => (
                  <AttributeSetRow
                    key={s.id}
                    set={s}
                    allAttributes={allAttributes}
                    onChanged={(msg) => {
                      setInfo(msg);
                      void refresh();
                    }}
                    onError={(msg) => setError(msg)}
                  />
                ))}
                {sets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No sets yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

interface CreateFormProps {
  onCreated: (setName: string) => void;
  onError: (msg: string) => void;
}

function CreateAttributeSetForm({ onCreated, onError }: CreateFormProps): ReactNode {
  const [code, setCode] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelPl, setLabelPl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      const name: Record<string, string> = {};
      if (labelEn) name['en-US'] = labelEn;
      if (labelPl) name['pl-PL'] = labelPl;
      if (!code || Object.keys(name).length === 0) {
        onError('Code and at least one localized name are required.');
        return;
      }
      setSubmitting(true);
      try {
        const res = await apiClient.post<{ data: AttributeSetDetail }>(
          '/api/v1/admin/catalog/attribute-sets',
          { code, name },
        );
        onCreated(res.data.code);
        setCode('');
        setLabelEn('');
        setLabelPl('');
      } catch (err) {
        onError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      } finally {
        setSubmitting(false);
      }
    },
    [code, labelEn, labelPl, onCreated, onError],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create new set</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="set-code">Code</Label>
            <Input
              id="set-code"
              placeholder="electronics"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              pattern="[a-z0-9_]+"
              title="snake_case (a-z, 0-9, _)"
              required
            />
          </div>
          <div>
            <Label htmlFor="set-label-en">Name (en-US)</Label>
            <Input
              id="set-label-en"
              placeholder="Electronics"
              value={labelEn}
              onChange={(e) => setLabelEn(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="set-label-pl">Name (pl-PL)</Label>
            <Input
              id="set-label-pl"
              placeholder="Elektronika"
              value={labelPl}
              onChange={(e) => setLabelPl(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create set'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row with expandable attribute picker
// ---------------------------------------------------------------------------

interface RowProps {
  set: AttributeSet;
  allAttributes: AdminAttribute[];
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}

function AttributeSetRow({ set, allAttributes, onChanged, onError }: RowProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AttributeSetDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiClient.get<{ data: AttributeSetDetail }>(
        `/api/v1/admin/catalog/attribute-sets/${set.id}`,
      );
      setDetail(res.data);
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load detail.');
    } finally {
      setBusy(false);
    }
  }, [set.id, onError]);

  const handleToggleExpanded = useCallback(async (): Promise<void> => {
    if (!expanded && !detail) await loadDetail();
    setExpanded((v) => !v);
  }, [expanded, detail, loadDetail]);

  const handleAssign = useCallback(
    async (attributeId: string): Promise<void> => {
      try {
        const res = await apiClient.post<{ data: AttributeSetDetail }>(
          `/api/v1/admin/catalog/attribute-sets/${set.id}/attributes`,
          { assignments: [{ attributeId }] },
        );
        setDetail(res.data);
        onChanged(`Assigned attribute to "${set.code}".`);
      } catch (err) {
        onError(err instanceof ApiError ? err.envelope.error.message : 'Assign failed.');
      }
    },
    [set.id, set.code, onChanged, onError],
  );

  const handleUnassign = useCallback(
    async (attributeId: string): Promise<void> => {
      try {
        await apiClient.delete<void>(
          `/api/v1/admin/catalog/attribute-sets/${set.id}/attributes/${attributeId}`,
        );
        await loadDetail();
        onChanged(`Removed attribute from "${set.code}".`);
      } catch (err) {
        onError(err instanceof ApiError ? err.envelope.error.message : 'Remove failed.');
      }
    },
    [set.id, set.code, loadDetail, onChanged, onError],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!confirm(`Delete attribute set "${set.code}"? Products referencing it must be reassigned first.`)) {
      return;
    }
    try {
      await apiClient.delete<void>(`/api/v1/admin/catalog/attribute-sets/${set.id}`);
      onChanged(`Deleted "${set.code}".`);
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
    }
  }, [set.id, set.code, onChanged, onError]);

  const localizedName = set.name['en-US'] ?? set.name['pl-PL'] ?? Object.values(set.name)[0] ?? '—';

  const assignedIds = new Set(detail?.attributes.map((a) => a.id) ?? []);
  const unassigned = allAttributes.filter((a) => !assignedIds.has(a.id));

  return (
    <>
      <TableRow>
        <TableCell className="font-mono">{set.code}</TableCell>
        <TableCell>
          {localizedName}
          {set.isSystem ? (
            <Badge className="ml-2" variant="secondary">
              system
            </Badge>
          ) : null}
        </TableCell>
        <TableCell>{set.attributeCount}</TableCell>
        <TableCell>{set.productCount}</TableCell>
        <TableCell className="space-x-2 whitespace-nowrap">
          <Button variant="outline" size="sm" onClick={handleToggleExpanded} disabled={busy}>
            {expanded ? 'Collapse' : 'Manage'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={set.isSystem || set.productCount > 0}
            title={
              set.isSystem
                ? 'System set cannot be deleted'
                : set.productCount > 0
                  ? 'Reassign products before deleting'
                  : 'Delete'
            }
          >
            Delete
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="space-y-3 p-2">
              <p className="text-sm font-medium">Assigned attributes</p>
              {detail && detail.attributes.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {detail.attributes.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{a.key}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{a.valueType}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleUnassign(a.id)}
                        >
                          Remove
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No attributes assigned yet.</p>
              )}

              {unassigned.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">Add attribute</p>
                  <div className="flex flex-wrap gap-2">
                    {unassigned.map((a) => (
                      <Button
                        key={a.id}
                        variant="outline"
                        size="sm"
                        onClick={() => void handleAssign(a.id)}
                      >
                        + {a.key}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

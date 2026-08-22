import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AttributeSet,
  AttributeSetDetail,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
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
 *   - `@endora-commerce/contracts` types as the single source of truth.
 *
 * Renders the list of Attribute Sets, lets the admin create custom
 * ones, expand a row to inspect / edit assigned attributes, and
 * delete non-system sets.
 */
export function AttributeSetsPage(): ReactNode {
  const t = useTranslation('catalog');
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
        title={t('attributeSets.page.title')}
        description={t('attributeSets.page.description')}
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
          setInfo(t('attributeSets.success.create', { name: setName }));
          void refresh();
        }}
        onError={(msg) => setError(msg)}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('attributeSets.list.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('attributeSets.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('attributeSets.column.code')}</TableHead>
                  <TableHead>{t('attributeSets.column.name')}</TableHead>
                  <TableHead>{t('attributeSets.column.attributes')}</TableHead>
                  <TableHead>{t('attributeSets.column.products')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">{t('attributeSets.column.actions')}</TableHead>
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
                      {t('attributeSets.empty')}
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
  const t = useTranslation('catalog');
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
        onError(t('attributeSets.create.validationError'));
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
        onError(err instanceof ApiError ? err.envelope.error.message : t('attributeSets.error.create'));
      } finally {
        setSubmitting(false);
      }
    },
    [code, labelEn, labelPl, onCreated, onError, t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('attributeSets.create.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="set-code">{t('attributeSets.field.code')}</Label>
            <Input
              id="set-code"
              placeholder="electronics"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              pattern="[a-z0-9_]+"
              title={t('attributeSets.field.codeTitle')}
              required
            />
          </div>
          <div>
            <Label htmlFor="set-label-en">{t('attributeSets.field.nameEn')}</Label>
            <Input
              id="set-label-en"
              placeholder="Electronics"
              value={labelEn}
              onChange={(e) => setLabelEn(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="set-label-pl">{t('attributeSets.field.namePl')}</Label>
            <Input
              id="set-label-pl"
              placeholder="Elektronika"
              value={labelPl}
              onChange={(e) => setLabelPl(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? t('attributeSets.create.submitting') : t('attributeSets.create.submit')}
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
  const t = useTranslation('catalog');
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
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributeSets.error.loadDetail'));
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
        onChanged(t('attributeSets.success.assign', { code: set.code }));
      } catch (err) {
        onError(err instanceof ApiError ? err.envelope.error.message : t('attributeSets.error.assign'));
      }
    },
    [set.id, set.code, onChanged, onError, t],
  );

  const handleUnassign = useCallback(
    async (attributeId: string): Promise<void> => {
      try {
        await apiClient.delete<void>(
          `/api/v1/admin/catalog/attribute-sets/${set.id}/attributes/${attributeId}`,
        );
        await loadDetail();
        onChanged(t('attributeSets.success.unassign', { code: set.code }));
      } catch (err) {
        onError(err instanceof ApiError ? err.envelope.error.message : t('attributeSets.error.remove'));
      }
    },
    [set.id, set.code, loadDetail, onChanged, onError, t],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!confirm(t('attributeSets.deleteConfirm', { code: set.code }))) {
      return;
    }
    try {
      await apiClient.delete<void>(`/api/v1/admin/catalog/attribute-sets/${set.id}`);
      onChanged(t('attributeSets.success.delete', { code: set.code }));
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributeSets.error.delete'));
    }
  }, [set.id, set.code, onChanged, onError, t]);

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
            {expanded ? t('attributeSets.action.collapse') : t('attributeSets.action.manage')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={set.isSystem || set.productCount > 0}
            title={
              set.isSystem
                ? t('attributeSets.deleteHint.system')
                : set.productCount > 0
                  ? t('attributeSets.deleteHint.hasProducts')
                  : t('attributeSets.action.delete')
            }
          >
            {t('attributeSets.action.delete')}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="space-y-3 p-2">
              <p className="text-sm font-medium">{t('attributeSets.assigned.title')}</p>
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
                          {t('attributeSets.action.remove')}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('attributeSets.assigned.empty')}</p>
              )}

              {unassigned.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">{t('attributeSets.add.title')}</p>
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

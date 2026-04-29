import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

interface AttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
  usageCount?: number;
}

/**
 * Attachment Types dictionary CRUD (T087, feature 002 US3).
 *
 * Foundation pattern: single-file module, inline `useState` + `useEffect`,
 * direct `apiClient` calls. Mirrors AttributeSetsPage but lighter — type
 * is just `code + name (multilingual) + position`. The system seeds 4
 * standard rows (certificate / tech_spec / product_card / pdf) which the
 * server reports with `usageCount > 0` once any product attaches one.
 */
export function AttachmentTypesPage(): ReactNode {
  const [types, setTypes] = useState<AttachmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AttachmentType[] }>(
        '/api/v1/admin/catalog/attachment-types',
      );
      setTypes(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Load failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { code: string; nameEn: string; namePl: string }): Promise<void> => {
      try {
        await apiClient.post('/api/v1/admin/catalog/attachment-types', {
          code: input.code,
          name: { 'en-US': input.nameEn, 'pl-PL': input.namePl || input.nameEn },
        });
        setInfo(`Type "${input.code}" created.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string, code: string, usage: number): Promise<void> => {
      if (usage > 0) {
        alert(
          `Cannot delete "${code}" — it's used by ${usage} attachment(s). Reassign them first.`,
        );
        return;
      }
      if (!confirm(`Delete attachment type "${code}"?`)) return;
      try {
        await apiClient.delete(`/api/v1/admin/catalog/attachment-types/${id}`);
        setInfo(`Type "${code}" deleted.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <div>
      <PageHeader
        title="Attachment types"
        description="Dictionary of attachment categories (Certificate, Tech spec, …) selectable from each Product's attachments tab."
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

      <Card>
        <CardHeader>
          <CardTitle>Existing types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name (en-US)</TableHead>
                  <TableHead>Name (pl-PL)</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>In use</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono">{t.code}</TableCell>
                    <TableCell>{t.name['en-US'] ?? '—'}</TableCell>
                    <TableCell>{t.name['pl-PL'] ?? '—'}</TableCell>
                    <TableCell>{t.position}</TableCell>
                    <TableCell>{t.usageCount ?? 0}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete(t.id, t.code, t.usageCount ?? 0)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <CreateAttachmentTypeInline onCreate={handleCreate} />
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAttachmentTypeInline({
  onCreate,
}: {
  onCreate: (input: { code: string; nameEn: string; namePl: string }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!code || !nameEn) return;
    void onCreate({ code, nameEn, namePl }).then(() => {
      setCode('');
      setNameEn('');
      setNamePl('');
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 md:grid-cols-4 border-t pt-4"
      aria-label="Create attachment type"
    >
      <div className="space-y-1">
        <Label htmlFor="atcode">Code</Label>
        <Input
          id="atcode"
          value={code}
          onChange={(e): void => setCode(e.target.value)}
          placeholder="warranty"
          pattern="[a-z0-9_]+"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="atnameen">Name (en-US)</Label>
        <Input
          id="atnameen"
          value={nameEn}
          onChange={(e): void => setNameEn(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="atnamepl">Name (pl-PL)</Label>
        <Input
          id="atnamepl"
          value={namePl}
          onChange={(e): void => setNamePl(e.target.value)}
          placeholder="(falls back to en-US if empty)"
        />
      </div>
      <div className="md:col-span-4">
        <Button type="submit">+ Add type</Button>
      </div>
    </form>
  );
}

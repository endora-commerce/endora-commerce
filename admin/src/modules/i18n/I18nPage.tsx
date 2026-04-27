import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { Currency, Language } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ListEnvelope<T> {
  data: T[];
}

export function I18nPage(): ReactNode {
  return (
    <>
      <PageHeader
        title="Languages & currencies"
        description="The pool of locales and currencies the storefront and admin can pick from. Exactly one default each (enforced at the database)."
      />
      <div className="space-y-4">
        <LanguagesCard />
        <CurrenciesCard />
      </div>
    </>
  );
}

function LanguagesCard(): ReactNode {
  const [rows, setRows] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListEnvelope<Language>>('/api/v1/admin/languages');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load languages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (input: { code: string; label: string; isActive: boolean }): Promise<void> => {
      try {
        await apiClient.put<{ data: Language }>(
          `/api/v1/admin/languages/${encodeURIComponent(input.code)}`,
          { label: input.label, isActive: input.isActive },
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const setDefault = useCallback(
    async (code: string): Promise<void> => {
      try {
        await apiClient.post<{ data: Language }>(
          `/api/v1/admin/languages/${encodeURIComponent(code)}/default`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to set default.');
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (code: string): Promise<void> => {
      if (!confirm(`Delete language ${code}?`)) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/languages/${encodeURIComponent(code)}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Languages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AddLanguageForm onSubmit={upsert} />
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Default</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="font-mono">{row.code}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{row.isActive ? 'yes' : 'no'}</TableCell>
                  <TableCell>
                    {row.isDefault ? (
                      <Badge variant="success">default</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!row.isActive}
                        onClick={(): void => {
                          void setDefault(row.code);
                        }}
                      >
                        Make default
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={row.isDefault}
                      onClick={(): void => {
                        void remove(row.code);
                      }}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CurrenciesCard(): ReactNode {
  const [rows, setRows] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListEnvelope<Currency>>('/api/v1/admin/currencies');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load currencies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (input: {
      code: string;
      label: string;
      symbol: string;
      isActive: boolean;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: Currency }>(`/api/v1/admin/currencies/${input.code}`, {
          label: input.label,
          symbol: input.symbol,
          isActive: input.isActive,
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const setDefault = useCallback(
    async (code: string): Promise<void> => {
      try {
        await apiClient.post<{ data: Currency }>(`/api/v1/admin/currencies/${code}/default`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to set default.');
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (code: string): Promise<void> => {
      if (!confirm(`Delete currency ${code}?`)) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/currencies/${code}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currencies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AddCurrencyForm onSubmit={upsert} />
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Default</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="font-mono">{row.code}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{row.symbol}</TableCell>
                  <TableCell>{row.isActive ? 'yes' : 'no'}</TableCell>
                  <TableCell>
                    {row.isDefault ? (
                      <Badge variant="success">default</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!row.isActive}
                        onClick={(): void => {
                          void setDefault(row.code);
                        }}
                      >
                        Make default
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={row.isDefault}
                      onClick={(): void => {
                        void remove(row.code);
                      }}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddLanguageForm(props: {
  onSubmit: (input: { code: string; label: string; isActive: boolean }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [isActive, setIsActive] = useState(true);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!code.trim() || !label.trim()) return;
    await props.onSubmit({ code: code.trim(), label: label.trim(), isActive });
    setCode('');
    setLabel('');
    setIsActive(true);
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <Input
        className="w-32"
        placeholder="en-US"
        value={code}
        onChange={(e): void => setCode(e.target.value)}
      />
      <Input
        className="w-64"
        placeholder="English (US)"
        value={label}
        onChange={(e): void => setLabel(e.target.value)}
      />
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isActive}
          onChange={(e): void => setIsActive(e.target.checked)}
        />
        Active
      </label>
      <Button type="submit" disabled={!code.trim() || !label.trim()}>
        Save language
      </Button>
    </form>
  );
}

function AddCurrencyForm(props: {
  onSubmit: (input: {
    code: string;
    label: string;
    symbol: string;
    isActive: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [symbol, setSymbol] = useState('');
  const [isActive, setIsActive] = useState(true);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!code.trim() || !label.trim() || !symbol.trim()) return;
    await props.onSubmit({
      code: code.trim().toUpperCase(),
      label: label.trim(),
      symbol: symbol.trim(),
      isActive,
    });
    setCode('');
    setLabel('');
    setSymbol('');
    setIsActive(true);
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <Input
        className="w-24"
        placeholder="EUR"
        value={code}
        onChange={(e): void => setCode(e.target.value.toUpperCase())}
      />
      <Input
        className="w-64"
        placeholder="Euro"
        value={label}
        onChange={(e): void => setLabel(e.target.value)}
      />
      <Input
        className="w-20"
        placeholder="€"
        value={symbol}
        onChange={(e): void => setSymbol(e.target.value)}
      />
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isActive}
          onChange={(e): void => setIsActive(e.target.checked)}
        />
        Active
      </label>
      <Button type="submit" disabled={!code.trim() || !label.trim() || !symbol.trim()}>
        Save currency
      </Button>
    </form>
  );
}

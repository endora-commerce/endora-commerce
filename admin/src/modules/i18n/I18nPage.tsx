import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Currency, Language } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';

interface ListEnvelope<T> {
  data: T[];
}

export function I18nPage(): ReactNode {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Languages &amp; currencies</h1>
          <p>
            The pool of locales and currencies the storefront and admin can pick from. Exactly
            one default each (enforced at the database).
          </p>
        </div>
      </header>

      <LanguagesCard />
      <CurrenciesCard />
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
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to set default.',
        );
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
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Languages</h2>
      {error ? <div className="alert alert--error">{error}</div> : null}
      <AddLanguageForm onSubmit={upsert} />
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Active</th>
              <th>Default</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td className="code">{row.code}</td>
                <td>{row.label}</td>
                <td>{row.isActive ? 'yes' : 'no'}</td>
                <td>
                  {row.isDefault ? (
                    <span className="badge badge--success">default</span>
                  ) : (
                    <button
                      className="btn"
                      onClick={(): void => {
                        void setDefault(row.code);
                      }}
                      disabled={!row.isActive}
                    >
                      Make default
                    </button>
                  )}
                </td>
                <td>
                  <button
                    className="btn btn--danger"
                    onClick={(): void => {
                      void remove(row.code);
                    }}
                    disabled={row.isDefault}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
    async (input: { code: string; label: string; symbol: string; isActive: boolean }): Promise<void> => {
      try {
        await apiClient.put<{ data: Currency }>(
          `/api/v1/admin/currencies/${input.code}`,
          { label: input.label, symbol: input.symbol, isActive: input.isActive },
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
        await apiClient.post<{ data: Currency }>(`/api/v1/admin/currencies/${code}/default`);
        await refresh();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to set default.',
        );
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
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Currencies</h2>
      {error ? <div className="alert alert--error">{error}</div> : null}
      <AddCurrencyForm onSubmit={upsert} />
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Symbol</th>
              <th>Active</th>
              <th>Default</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td className="code">{row.code}</td>
                <td>{row.label}</td>
                <td>{row.symbol}</td>
                <td>{row.isActive ? 'yes' : 'no'}</td>
                <td>
                  {row.isDefault ? (
                    <span className="badge badge--success">default</span>
                  ) : (
                    <button
                      className="btn"
                      onClick={(): void => {
                        void setDefault(row.code);
                      }}
                      disabled={!row.isActive}
                    >
                      Make default
                    </button>
                  )}
                </td>
                <td>
                  <button
                    className="btn btn--danger"
                    onClick={(): void => {
                      void remove(row.code);
                    }}
                    disabled={row.isDefault}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
      style={{ marginBottom: 12 }}
    >
      <div className="toolbar">
        <input
          className="input"
          style={{ width: 120 }}
          placeholder="en-US"
          value={code}
          onChange={(e): void => setCode(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="English (US)"
          value={label}
          onChange={(e): void => setLabel(e.target.value)}
        />
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e): void => setIsActive(e.target.checked)}
          />
          Active
        </label>
        <button type="submit" className="btn btn--primary" disabled={!code.trim() || !label.trim()}>
          Save language
        </button>
      </div>
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
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
      style={{ marginBottom: 12 }}
    >
      <div className="toolbar">
        <input
          className="input"
          style={{ width: 96 }}
          placeholder="EUR"
          value={code}
          onChange={(e): void => setCode(e.target.value.toUpperCase())}
        />
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="Euro"
          value={label}
          onChange={(e): void => setLabel(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 80 }}
          placeholder="€"
          value={symbol}
          onChange={(e): void => setSymbol(e.target.value)}
        />
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e): void => setIsActive(e.target.checked)}
          />
          Active
        </label>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!code.trim() || !label.trim() || !symbol.trim()}
        >
          Save currency
        </button>
      </div>
    </form>
  );
}

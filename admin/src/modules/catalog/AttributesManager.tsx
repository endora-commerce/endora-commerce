import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Attributes manager (T091 / FR-004 / SC-006). The `isSearchable` and
 * `isFilterable` toggles are the high-leverage controls — flipping
 * `isSearchable` re-indexes the attribute into Meilisearch (via the
 * attribute.updated.v1 event); `isFilterable` decides if the storefront
 * surfaces it as a faceted filter.
 *
 * Variant-axis is a creation-time decision driven by the attribute's
 * value type; the toggle is editable but the backend may reject changes
 * once products use the attribute (handled by an error banner).
 */

const VALUE_TYPES = ['string', 'number', 'boolean', 'enum'] as const;
type ValueType = (typeof VALUE_TYPES)[number];

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: ValueType;
  enumValues: string[] | null;
  isSearchable: boolean;
  isFilterable: boolean;
  isVariantAxis: boolean;
}

export function AttributesManager(): ReactNode {
  const [attrs, setAttrs] = useState<AdminAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminAttribute[] }>(
        '/api/v1/admin/catalog/attributes',
      );
      setAttrs(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      key: string;
      labelEn: string;
      labelPl: string;
      valueType: ValueType;
      enumValues: string;
      isSearchable: boolean;
      isFilterable: boolean;
      isVariantAxis: boolean;
    }): Promise<void> => {
      const label: Record<string, string> = {};
      if (input.labelEn) label['en-US'] = input.labelEn;
      if (input.labelPl) label['pl-PL'] = input.labelPl;
      const enumValues =
        input.valueType === 'enum'
          ? input.enumValues
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      try {
        await apiClient.post<{ data: AdminAttribute }>('/api/v1/admin/catalog/attributes', {
          key: input.key,
          label,
          valueType: input.valueType,
          ...(enumValues !== undefined ? { enumValues } : {}),
          isSearchable: input.isSearchable,
          isFilterable: input.isFilterable,
          isVariantAxis: input.isVariantAxis,
        });
        setInfo(`Attribute "${input.key}" created.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const handleToggle = useCallback(
    async (
      attr: AdminAttribute,
      patch: { isSearchable?: boolean; isFilterable?: boolean; isVariantAxis?: boolean },
    ): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminAttribute }>(
          `/api/v1/admin/catalog/attributes/${attr.key}`,
          patch,
        );
        setInfo(`Updated ${attr.key}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Update failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Attributes</h1>
          <p>
            Searchable + filterable attributes drive Meilisearch and the storefront filter
            panel. Hot-toggle to see results within seconds.
          </p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create attribute</h2>
        <CreateAttributeForm onSubmit={handleCreate} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : attrs.length === 0 ? (
        <p className="muted">No attributes yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Type</th>
              <th>Enum values</th>
              <th>Searchable</th>
              <th>Filterable</th>
              <th>Variant axis</th>
            </tr>
          </thead>
          <tbody>
            {attrs.map((a) => (
              <tr key={a.id}>
                <td>
                  <code>{a.key}</code>
                </td>
                <td>{a.label['en-US'] ?? Object.values(a.label)[0] ?? ''}</td>
                <td>{a.valueType}</td>
                <td>{a.enumValues ? a.enumValues.join(', ') : '—'}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={a.isSearchable}
                    onChange={(e): void =>
                      void handleToggle(a, { isSearchable: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={a.isFilterable}
                    onChange={(e): void =>
                      void handleToggle(a, { isFilterable: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={a.isVariantAxis}
                    onChange={(e): void =>
                      void handleToggle(a, { isVariantAxis: e.target.checked })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CreateAttributeForm({
  onSubmit,
}: {
  onSubmit: (input: {
    key: string;
    labelEn: string;
    labelPl: string;
    valueType: ValueType;
    enumValues: string;
    isSearchable: boolean;
    isFilterable: boolean;
    isVariantAxis: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [key, setKey] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelPl, setLabelPl] = useState('');
  const [valueType, setValueType] = useState<ValueType>('string');
  const [enumValues, setEnumValues] = useState('');
  const [isSearchable, setIsSearchable] = useState(false);
  const [isFilterable, setIsFilterable] = useState(false);
  const [isVariantAxis, setIsVariantAxis] = useState(false);

  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          key,
          labelEn,
          labelPl,
          valueType,
          enumValues,
          isSearchable,
          isFilterable,
          isVariantAxis,
        }).then(() => {
          setKey('');
          setLabelEn('');
          setLabelPl('');
          setEnumValues('');
          setIsSearchable(false);
          setIsFilterable(false);
          setIsVariantAxis(false);
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Key (snake_case)</label>
          <input
            className="input"
            value={key}
            onChange={(e): void => setKey(e.target.value)}
            pattern="[a-z][a-z0-9_]*"
            required
            maxLength={64}
          />
        </div>
        <div className="field">
          <label>Type</label>
          <select
            className="input"
            value={valueType}
            onChange={(e): void => setValueType(e.target.value as ValueType)}
          >
            {VALUE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Label [en-US]</label>
          <input
            className="input"
            value={labelEn}
            onChange={(e): void => setLabelEn(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Label [pl-PL]</label>
          <input
            className="input"
            value={labelPl}
            onChange={(e): void => setLabelPl(e.target.value)}
          />
        </div>
      </div>
      {valueType === 'enum' ? (
        <div className="field">
          <label>Enum values (comma-separated)</label>
          <input
            className="input"
            value={enumValues}
            onChange={(e): void => setEnumValues(e.target.value)}
            placeholder="red, green, blue"
          />
        </div>
      ) : null}
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isSearchable}
            onChange={(e): void => setIsSearchable(e.target.checked)}
          />{' '}
          Searchable (indexed by Meilisearch)
        </label>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isFilterable}
            onChange={(e): void => setIsFilterable(e.target.checked)}
          />{' '}
          Filterable (shown as a facet on the storefront)
        </label>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isVariantAxis}
            onChange={(e): void => setIsVariantAxis(e.target.checked)}
          />{' '}
          Variant axis (configurable products discriminate by this attribute)
        </label>
      </div>
      <button className="btn btn--primary" type="submit">
        Create attribute
      </button>
    </form>
  );
}

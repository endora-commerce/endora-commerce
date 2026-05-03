import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CreateWarehouseRequest, Warehouse } from '@b2b/contracts';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { warehousesClient } from './api/warehouses-client';

interface FormState {
  name: string;
  code: string;
  active: boolean;
  description: string;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const EMPTY: FormState = {
  name: '',
  code: '',
  active: true,
  description: '',
  street: '',
  city: '',
  postalCode: '',
  countryCode: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

function fromWarehouse(w: Warehouse): FormState {
  return {
    name: w.name,
    code: w.code,
    active: w.active,
    description: w.description ?? '',
    street: w.address?.street ?? '',
    city: w.address?.city ?? '',
    postalCode: w.address?.postalCode ?? '',
    countryCode: w.address?.countryCode ?? '',
    contactName: w.contact?.name ?? '',
    contactEmail: w.contact?.email ?? '',
    contactPhone: w.contact?.phone ?? '',
  };
}

function buildAddress(s: FormState) {
  const a = {
    street: s.street.trim() || null,
    city: s.city.trim() || null,
    postalCode: s.postalCode.trim() || null,
    countryCode: s.countryCode.trim() || null,
  };
  if (!a.street && !a.city && !a.postalCode && !a.countryCode) return null;
  return a;
}

function buildContact(s: FormState) {
  const c = {
    name: s.contactName.trim() || null,
    email: s.contactEmail.trim() || null,
    phone: s.contactPhone.trim() || null,
  };
  if (!c.name && !c.email && !c.phone) return null;
  return c;
}

/**
 * WarehouseEditor — create + edit a single warehouse (feature 010 / US1).
 */
export function WarehouseEditor(): ReactNode {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    try {
      const w = await warehousesClient.get(id!);
      setLoaded(w);
      setForm(fromWarehouse(w));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load warehouse.');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = (patch: Partial<FormState>): void => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isNew) {
        const body: CreateWarehouseRequest = {
          name: form.name.trim(),
          code: form.code.trim(),
          active: form.active,
          description: form.description.trim() || null,
          address: buildAddress(form),
          contact: buildContact(form),
        };
        const created = await warehousesClient.create(body);
        navigate(`/warehouses/${created.id}`, { replace: true });
      } else {
        const updated = await warehousesClient.update(id!, {
          name: form.name.trim(),
          active: form.active,
          description: form.description.trim() || null,
          address: buildAddress(form),
          contact: buildContact(form),
        });
        setLoaded(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!loaded) return;
    if (!window.confirm(`Delete warehouse "${loaded.name}"? This cannot be undone.`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await warehousesClient.remove(loaded.id);
      navigate('/warehouses', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="b2b-page">Loading…</div>;

  const isDefault = loaded?.code === 'default';
  const canDelete = !isNew && !isDefault;

  return (
    <div className="b2b-page">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            onClick={(): void => { void navigate('/warehouses'); }}
            style={{ marginBottom: 8 }}
          >
            <ArrowLeft size={13} /> All warehouses
          </button>
          <div className="b2b-page-head__title">
            {isNew ? 'New warehouse' : loaded?.name ?? 'Warehouse'}
          </div>
          {!isNew && loaded ? (
            <div className="b2b-page-head__sub">
              <code className="b2b-mono">{loaded.code}</code>
              {isDefault ? ' · system default' : ''}
              {' · '}
              {loaded.totals?.isDefaultForChannelCount ?? 0} channel default(s)
            </div>
          ) : null}
        </div>
        {canDelete ? (
          <div className="b2b-page-head__actions">
            <button
              type="button"
              className="b2b-btn b2b-btn--danger"
              onClick={(): void => void handleDelete()}
              disabled={submitting}
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={(e): void => { void handleSubmit(e); }}>
        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Identity</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-grid b2b-grid--cols-2">
              <div>
                <label className="b2b-label" htmlFor="wh-name">Name</label>
                <input
                  id="wh-name"
                  className="b2b-field"
                  value={form.name}
                  onChange={(e): void => update({ name: e.target.value })}
                  required
                  maxLength={160}
                />
              </div>
              <div>
                <label className="b2b-label" htmlFor="wh-code">Code</label>
                <input
                  id="wh-code"
                  className="b2b-field b2b-field--mono"
                  value={form.code}
                  onChange={(e): void => update({ code: e.target.value })}
                  required
                  pattern="[a-z][a-z0-9_-]*[a-z0-9]"
                  maxLength={64}
                  disabled={!isNew}
                />
                <div className="b2b-help">Lowercase, digits, dashes, underscores. Immutable after creation.</div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="b2b-label" htmlFor="wh-desc">Description</label>
              <textarea
                id="wh-desc"
                className="b2b-field"
                rows={3}
                value={form.description}
                onChange={(e): void => update({ description: e.target.value })}
                maxLength={2000}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e): void => update({ active: e.target.checked })}
                />
                Active
              </label>
            </div>
          </div>
        </div>

        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Address (optional)</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-grid b2b-grid--cols-2">
              <div>
                <label className="b2b-label">Street</label>
                <input className="b2b-field" value={form.street} onChange={(e): void => update({ street: e.target.value })} />
              </div>
              <div>
                <label className="b2b-label">City</label>
                <input className="b2b-field" value={form.city} onChange={(e): void => update({ city: e.target.value })} />
              </div>
              <div>
                <label className="b2b-label">Postal code</label>
                <input className="b2b-field" value={form.postalCode} onChange={(e): void => update({ postalCode: e.target.value })} />
              </div>
              <div>
                <label className="b2b-label">Country code</label>
                <input className="b2b-field" value={form.countryCode} onChange={(e): void => update({ countryCode: e.target.value })} maxLength={2} />
              </div>
            </div>
          </div>
        </div>

        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Contact (optional)</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-grid b2b-grid--cols-3">
              <div>
                <label className="b2b-label">Name</label>
                <input className="b2b-field" value={form.contactName} onChange={(e): void => update({ contactName: e.target.value })} />
              </div>
              <div>
                <label className="b2b-label">Email</label>
                <input className="b2b-field" type="email" value={form.contactEmail} onChange={(e): void => update({ contactEmail: e.target.value })} />
              </div>
              <div>
                <label className="b2b-label">Phone</label>
                <input className="b2b-field" value={form.contactPhone} onChange={(e): void => update({ contactPhone: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        <div className="b2b-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost"
            onClick={(): void => { void navigate('/warehouses'); }}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="b2b-btn b2b-btn--primary" disabled={submitting}>
            {submitting ? 'Saving…' : isNew ? 'Create warehouse' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

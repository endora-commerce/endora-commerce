import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CreateWarehouseRequest, Warehouse } from '@endora-commerce/contracts';
import { Trash2 } from 'lucide-react';
import { ApiError, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  PageHeader,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { CountryPicker, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { warehousesClient } from '../api/warehouses-client.js';

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
  defaultLowStockThreshold: string;
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
  defaultLowStockThreshold: '',
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
    defaultLowStockThreshold:
      w.defaultLowStockThreshold == null ? '' : String(w.defaultLowStockThreshold),
  };
}

function parseThreshold(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number.parseInt(trimmed, 10);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
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
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  /**
   * The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
   * in full. Both halves are asked here because this one screen is both: the
   * `:id` form loads a warehouse over the read route and saves it over the
   * write one, and `/warehouses/new` is a create with nothing to read. So a
   * read-only operator sees the record and no way to change it, and reaches
   * `/warehouses/new` and sees nothing at all.
   */
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (isNew || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const w = await warehousesClient.get(id!);
      setLoaded(w);
      setForm(fromWarehouse(w));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.editor.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, id, isNew, t]);

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
          defaultLowStockThreshold: parseThreshold(form.defaultLowStockThreshold),
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
          defaultLowStockThreshold: parseThreshold(form.defaultLowStockThreshold),
        });
        setLoaded(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.editor.error.save'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!loaded) return;
    const ok = await confirm({
      message: t('warehouses.editor.deleteConfirm', { name: loaded.name }),
      confirmLabel: t('warehouses.action.delete'),
      destructive: true,
    });
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await warehousesClient.remove(loaded.id);
      navigate('/warehouses', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.editor.error.delete'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="b2b-page">
        <p role="status" className="text-sm text-muted-foreground">
          {t('warehouses.loading')}
        </p>
      </div>
    );
  }

  const isDefault = loaded?.code === 'default';
  const canDelete = canWrite && !isNew && !isDefault;

  if (!canRead || (isNew && !canWrite)) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page">
      <PageHeader
        back={{ label: t('warehouses.page.title'), to: '/warehouses' }}
        title={isNew ? t('warehouses.editor.newTitle') : loaded?.name ?? t('warehouses.editor.fallbackTitle')}
        description={
          !isNew && loaded ? (
            <>
              <code className="font-mono">{loaded.code}</code>
              {isDefault ? t('warehouses.editor.systemDefaultSuffix') : ''}
              {' · '}
              {t('warehouses.editor.channelDefaultsSuffix', {
                count: loaded.totals?.isDefaultForChannelCount ?? 0,
              })}
            </>
          ) : undefined
        }
        actions={
          canDelete ? (
            // Outline, not filled red: Save is the one filled button, and the confirm
            // dialog is where the destructive styling belongs (Von Restorff).
            <Button type="button" variant="outline" onClick={(): void => void handleDelete()} disabled={submitting}>
              <Trash2 aria-hidden="true" /> {t('warehouses.action.delete')}
            </Button>
          ) : null
        }
      />

      {/* Issue #1492 (CAT-17): a failure is a kit Alert (role="alert"), not a card painted red. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Every field is a kit FormField, so each label is tied to its input and each hint
          describes it (WCAG 1.3.1, 4.1.2) — the address and contact labels pointed at nothing. */}
      <form
        className="space-y-4"
        onSubmit={(e): void => {
          void handleSubmit(e);
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('warehouses.editor.identityTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('warehouses.editor.field.name')} required>
                <Input
                  value={form.name}
                  onChange={(e): void => update({ name: e.target.value })}
                  required
                  maxLength={160}
                />
              </FormField>
              <FormField label={t('warehouses.editor.field.code')} hint={t('warehouses.editor.field.codeHelp')} required>
                <Input
                  className="font-mono"
                  value={form.code}
                  onChange={(e): void => update({ code: e.target.value })}
                  required
                  pattern="[a-z][a-z0-9_-]*[a-z0-9]"
                  maxLength={64}
                  disabled={!isNew}
                />
              </FormField>
            </div>
            <FormField label={t('warehouses.editor.field.description')}>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e): void => update({ description: e.target.value })}
                maxLength={2000}
              />
            </FormField>
            {/* The whole row is the label, so it is all target (Fitts's Law). */}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.active} onChange={(e): void => update({ active: e.target.checked })} />
              {t('warehouses.editor.field.active')}
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('warehouses.editor.addressTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('warehouses.editor.field.street')}>
                <Input value={form.street} onChange={(e): void => update({ street: e.target.value })} />
              </FormField>
              <FormField label={t('warehouses.editor.field.city')}>
                <Input value={form.city} onChange={(e): void => update({ city: e.target.value })} />
              </FormField>
              <FormField label={t('warehouses.editor.field.postalCode')}>
                <Input value={form.postalCode} onChange={(e): void => update({ postalCode: e.target.value })} />
              </FormField>
              <FormField label={t('warehouses.editor.field.countryCode')}>
                <CountryPicker
                  value={form.countryCode}
                  onChange={(e): void => update({ countryCode: e.target.value })}
                  includeBlank
                  blankLabel={t('warehouses.editor.field.countryNone')}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('warehouses.editor.contactTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label={t('warehouses.editor.field.contactName')}>
                <Input value={form.contactName} onChange={(e): void => update({ contactName: e.target.value })} />
              </FormField>
              <FormField label={t('warehouses.editor.field.contactEmail')}>
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e): void => update({ contactEmail: e.target.value })}
                />
              </FormField>
              <FormField label={t('warehouses.editor.field.contactPhone')}>
                <Input
                  type="tel"
                  value={form.contactPhone}
                  onChange={(e): void => update({ contactPhone: e.target.value })}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('warehouses.editor.lowStockTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              label={t('warehouses.editor.field.defaultLowStockThreshold')}
              description={t('warehouses.editor.field.defaultLowStockThresholdHelp')}
              className="max-w-xs"
            >
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={form.defaultLowStockThreshold}
                placeholder={t('warehouses.editor.field.defaultLowStockThresholdPlaceholder')}
                onChange={(e): void => update({ defaultLowStockThreshold: e.target.value })}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* Save is the page's one filled button and comes last (Von Restorff, Jakob). */}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={(): void => {
              void navigate('/warehouses');
            }}
            disabled={submitting}
          >
            {t('warehouses.action.cancel')}
          </Button>
          {canWrite ? (
            <Button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting
                ? t('warehouses.action.saving')
                : isNew
                  ? t('warehouses.action.create')
                  : t('warehouses.action.saveChanges')}
            </Button>
          ) : null}
        </div>
      </form>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default WarehouseEditor;

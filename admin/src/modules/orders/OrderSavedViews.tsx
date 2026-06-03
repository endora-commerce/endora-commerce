import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';

export interface SavedViewState {
  filters: Record<string, unknown>;
  sort: { field: string; dir: 'asc' | 'desc' };
  /** Column-picker selection; `null`/absent ⇒ the list falls back to defaults. */
  visibleColumns?: string[] | null;
}
interface SavedView extends SavedViewState {
  id: string;
  name: string;
  shared: boolean;
  ownerAdminUserId: string;
}

interface Props {
  current: SavedViewState;
  onLoad: (view: SavedViewState) => void;
  onError: (message: string) => void;
}

/**
 * Feature 038 (US2) — saved orders-list views. Lists the caller's own views
 * plus shared ones, loads a view's filters/sort, and saves/deletes views
 * (optionally shared with everyone who can access the list).
 */
export function OrderSavedViews({ current, onLoad, onError }: Props): ReactNode {
  const t = useTranslation('core');
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: SavedView[] }>('/api/v1/admin/orders/list-views');
      setViews(res.data);
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load views.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLoad = (id: string): void => {
    setSelectedId(id);
    const view = views.find((v) => v.id === id);
    if (view) {
      onLoad({ filters: view.filters, sort: view.sort, visibleColumns: view.visibleColumns ?? null });
    }
  };

  const save = async (): Promise<void> => {
    const name = window.prompt(t('orders.views.namePrompt'));
    if (!name) return;
    const shared = window.confirm(t('orders.views.sharedPrompt'));
    try {
      await apiClient.post('/api/v1/admin/orders/list-views', {
        name,
        shared,
        filters: current.filters,
        sort: current.sort,
        visibleColumns: current.visibleColumns ?? null,
      });
      await load();
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : 'Failed to save view.');
    }
  };

  const remove = async (): Promise<void> => {
    if (!selectedId) return;
    try {
      await apiClient.delete(`/api/v1/admin/orders/list-views/${selectedId}`);
      setSelectedId('');
      await load();
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : 'Failed to delete view.');
    }
  };

  return (
    <div className="space-y-1">
      <Label htmlFor="saved-views">{t('orders.views.label')}</Label>
      <div className="flex items-center gap-2">
        <Select
          id="saved-views"
          value={selectedId}
          onChange={(e): void => handleLoad(e.target.value)}
        >
          <option value="">{t('orders.views.none')}</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.shared ? ' ★' : ''}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="sm" aria-label="save-view" onClick={(): void => void save()}>
          <Save />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="delete-view"
          disabled={!selectedId}
          onClick={(): void => void remove()}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

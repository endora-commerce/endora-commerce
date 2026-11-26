import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The overlay notes fixture's one screen: how many notes the operator's tenant
 * context can see, read through the module's own gated route. It exists so an
 * overlay admin layer is built, type-checked and scanned in this repository.
 */
export default function OverlayNotesFixturePage(): ReactNode {
  const t = useTranslation('overlay_notes_fixture');
  const [notes, setNotes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ notes: number }>('/api/v1/admin/overlay-notes-fixture/notes');
      setNotes(res.notes);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('admin.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.title')} description={t('admin.description')} />
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {notes === null ? t('admin.loading') : t('admin.count', { count: notes })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

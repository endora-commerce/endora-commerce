import { useEffect, useState } from 'react';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { Link } from 'react-router-dom';
import type { EmailBlockSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, FormField, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import { emailScopeLabels } from '../lib/labels.js';

export function EmailBlocksPage(): React.ReactElement {
  const t = useTranslation('transactional_emails');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');
  const [items, setItems] = useState<EmailBlockSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const reload = (): void => {
    transactionalEmailsClient
      .listBlocks()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(reload, []);

  const create = async (): Promise<void> => {
    setError(null);
    try {
      await transactionalEmailsClient.createBlock({ code, name, languages: ['en-US', 'pl-PL'] });
      setCode('');
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string): Promise<void> => {
    const ok = await confirm({ message: t('blocks.deleteConfirm'), confirmLabel: tc('common.action.delete'), destructive: true });
    if (!ok) return;
    try {
      await transactionalEmailsClient.deleteBlock(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('blocks.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('blocks.title')} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <FormField label={t('create.field.code')} className="w-full max-w-[200px]">
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
            </FormField>
            <FormField label={t('create.field.name')} className="w-full max-w-[240px]">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <Button onClick={() => void create()} disabled={!code || !name}>
              {t('blocks.create')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">{t('list.column.name')}</th>
                <th className="p-3 font-medium">{t('list.column.code')}</th>
                <th className="p-3 font-medium">{t('list.column.scope')}</th>
                <th className="p-3 font-medium">{t('list.column.system')}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/blocks/${b.id}`}>
                      {b.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{b.code}</td>
                  <td className="p-3">{emailScopeLabels.label(t, b.scope)}</td>
                  <td className="p-3">{b.isSystem ? t('list.system.yes') : '—'}</td>
                  <td className="p-3 text-right">
                    {canWrite && !b.isSystem ? (
                      <Button variant="outline" size="sm" onClick={() => void remove(b.id)}>
                        {tc('common.action.delete')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default EmailBlocksPage;

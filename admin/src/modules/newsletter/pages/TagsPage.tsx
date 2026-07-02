import { useEffect, useState, useCallback } from 'react';
import type { NewsletterCustomField, NewsletterTag } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

export function TagsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');
  const [tags, setTags] = useState<NewsletterTag[]>([]);
  const [fields, setFields] = useState<NewsletterCustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagCode, setTagCode] = useState('');
  const [tagName, setTagName] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');

  const load = useCallback(() => {
    newsletterClient.listTags().then((r) => setTags(r.items)).catch((e: unknown) => setError(String(e)));
    newsletterClient.listCustomFields().then((r) => setFields(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Newsletter — Tags &amp; fields" description="Segmentation tags and custom subscriber fields." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="code" value={tagCode} onChange={(e) => setTagCode(e.target.value)} className="max-w-[140px]" />
              <Input placeholder="name" value={tagName} onChange={(e) => setTagName(e.target.value)} className="max-w-[200px]" />
              <Button
                size="sm"
                onClick={() =>
                  void run(async () => {
                    await newsletterClient.createTag({ code: tagCode, name: tagName });
                    setTagCode('');
                    setTagName('');
                  })
                }
              >
                Add tag
              </Button>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono text-xs">{t.code}</span> — {t.name}
                </span>
                {canWrite ? (
                  <Button variant="ghost" size="sm" onClick={() => void run(() => newsletterClient.deleteTag(t.id))}>
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Custom subscriber fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="key" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} className="max-w-[140px]" />
              <Input placeholder="label" value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} className="max-w-[200px]" />
              <Button
                size="sm"
                onClick={() =>
                  void run(async () => {
                    await newsletterClient.createCustomField({ key: fieldKey, label: fieldLabel, type: 'text' });
                    setFieldKey('');
                    setFieldLabel('');
                  })
                }
              >
                Add field
              </Button>
            </div>
          ) : null}
          <ul className="divide-y text-sm">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono text-xs">{f.key}</span> — {f.label} ({f.type})
                </span>
                {canWrite ? (
                  <Button variant="ghost" size="sm" onClick={() => void run(() => newsletterClient.deleteCustomField(f.id))}>
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

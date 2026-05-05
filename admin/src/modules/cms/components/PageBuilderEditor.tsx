import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Puck, type Config, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { defaultPageBuilderConfig } from '@b2b/cms-components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cmsClient } from '../api/cms-client';

const emptyData: Data = { root: { props: {} }, content: [] };

export function PageBuilderEditor({
  data,
  onChange,
}: {
  data: Data | null;
  onChange: (data: Data) => void;
}): ReactNode {
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    cmsClient
      .getPageBuilderConfig()
      .then(() => {
        if (live) setRemoteLoaded(true);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const config = useMemo(() => defaultPageBuilderConfig as Config, []);
  const editorData = data ?? emptyData;

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!remoteLoaded && !error ? (
        <p className="text-sm text-muted-foreground">Loading Page Builder config…</p>
      ) : null}
      <div className="min-h-[640px] overflow-hidden rounded-md border">
        <Puck config={config} data={editorData} onChange={onChange} onPublish={onChange} />
      </div>
    </div>
  );
}

export type { Data as PageBuilderData };

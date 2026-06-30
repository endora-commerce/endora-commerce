import { useEffect, useState } from 'react';
import type { EmailBranding } from '@b2b/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ui/color-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AssetFieldPicker } from '@/components/asset-picker/AssetFieldPicker';
import { useAuth } from '@/lib/auth';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

export interface BrandingPanelProps {
  /** null = global scope. */
  salesChannelId: string | null;
}

/**
 * Email branding editor (feature 047, US2). Logo (asset picker) + accent color,
 * resolved and persisted per scope through the Settings-backed branding service.
 */
export function BrandingPanel({ salesChannelId }: BrandingPanelProps): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');
  const [branding, setBranding] = useState<EmailBranding | null>(null);
  const [logoAssetId, setLogoAssetId] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    transactionalEmailsClient
      .branding(salesChannelId)
      .then((b) => {
        if (!live) return;
        setBranding(b);
        setLogoAssetId(b.logoAssetId);
        setAccentColor(b.accentColor);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [salesChannelId]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await transactionalEmailsClient.putBranding(salesChannelId, { logoAssetId, accentColor });
      setBranding(updated);
      setNotice('Branding saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding {salesChannelId ? '(channel)' : '(global)'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="te-logo">Header logo</Label>
          <AssetFieldPicker
            id="te-logo"
            value={logoAssetId}
            onChange={setLogoAssetId}
            acceptMimePrefix="image/"
            allowUpload
            placeholder="Select a logo image"
          />
          {branding?.logoUrl ? (
            <p className="text-xs text-muted-foreground">
              Resolved URL: <span className="font-mono">{branding.logoUrl}</span>
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label>Accent color</Label>
          <ColorPicker
            value={accentColor}
            onChange={setAccentColor}
            label="Accent color"
            customLabel="Custom accent color"
            disabled={!canWrite}
          />
        </div>
        <Button onClick={() => void save()} disabled={!canWrite || busy}>
          Save branding
        </Button>
      </CardContent>
    </Card>
  );
}

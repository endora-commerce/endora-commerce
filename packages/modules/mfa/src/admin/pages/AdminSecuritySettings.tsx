import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@endora-commerce/admin-kit/ui';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Admin self-service 2FA (feature 042, US2). Lets the signed-in admin enable
 * TOTP (scan → confirm → save recovery codes), disable it, and regenerate
 * recovery codes. The admin SPA sends the `b2b_admin_session` cookie with each
 * request, so the component calls the backend directly.
 */
interface MfaStatus {
  totpActive: boolean;
  recoveryCodesRemaining: number;
  totpEnabledForScope: boolean;
}

const BASE = '/api/v1/admin/account/mfa';

export default function AdminSecuritySettings(): ReactNode {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async (): Promise<void> => {
    const res = await apiClient.get<{ data: MfaStatus }>(`${BASE}/status`);
    setStatus(res.data);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const startSetup = (): void =>
    void run(async () => {
      const res = await apiClient.post<{ data: { secret: string; otpauthUri: string } }>(
        `${BASE}/setup`,
      );
      setSetup(res.data);
      setRecoveryCodes(null);
    });

  const confirm = (e: FormEvent): void => {
    e.preventDefault();
    void run(async () => {
      const res = await apiClient.post<{ data: { recoveryCodes: string[] } }>(`${BASE}/activate`, {
        code,
      });
      setRecoveryCodes(res.data.recoveryCodes);
      setSetup(null);
      setCode('');
      await loadStatus();
    });
  };

  const disable = (e: FormEvent): void => {
    e.preventDefault();
    void run(async () => {
      await apiClient.post(`${BASE}/disable`, { code });
      setCode('');
      setRecoveryCodes(null);
      await loadStatus();
    });
  };

  const regenerate = (e: FormEvent): void => {
    e.preventDefault();
    void run(async () => {
      const res = await apiClient.post<{ data: { recoveryCodes: string[] } }>(
        `${BASE}/recovery-codes/regenerate`,
        { code },
      );
      setRecoveryCodes(res.data.recoveryCodes);
      setCode('');
      await loadStatus();
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="size-5 text-primary" />
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            Protect your admin account with a time-based code from an authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {recoveryCodes ? (
            <Alert>
              <AlertTitle>Save your recovery codes</AlertTitle>
              <AlertDescription>
                <p>Each code works once. They are shown only now.</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                  {recoveryCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {status === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : status.totpActive ? (
            <div className="space-y-6">
              <p className="text-sm">
                2FA is <strong>enabled</strong>. Unused recovery codes: {status.recoveryCodesRemaining}.
              </p>
              <form className="space-y-2" onSubmit={disable}>
                <Label htmlFor="disable-code">Enter a current code to disable 2FA</Label>
                <Input id="disable-code" value={code} onChange={(e): void => setCode(e.target.value)} required />
                <Button type="submit" variant="destructive" disabled={busy}>
                  Disable 2FA
                </Button>
              </form>
              <form className="space-y-2" onSubmit={regenerate}>
                <Label htmlFor="regen-code">Enter a current code to regenerate recovery codes</Label>
                <Input id="regen-code" value={code} onChange={(e): void => setCode(e.target.value)} required />
                <Button type="submit" variant="outline" disabled={busy}>
                  Regenerate recovery codes
                </Button>
              </form>
            </div>
          ) : setup ? (
            <form className="space-y-3" onSubmit={confirm}>
              <p className="text-sm">Add this account to your authenticator app:</p>
              <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{setup.otpauthUri}</p>
              <p className="text-sm">
                Manual key: <code className="font-mono">{setup.secret}</code>
              </p>
              <Label htmlFor="confirm-code">Enter the 6-digit code to confirm</Label>
              <Input
                id="confirm-code"
                inputMode="numeric"
                value={code}
                onChange={(e): void => setCode(e.target.value)}
                required
                placeholder="123456"
              />
              <Button type="submit" disabled={busy}>
                Confirm and enable
              </Button>
            </form>
          ) : (
            <Button onClick={startSetup} disabled={busy}>
              Enable 2FA
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

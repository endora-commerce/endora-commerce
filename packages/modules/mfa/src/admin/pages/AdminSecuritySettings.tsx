import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  EditorSection,
  FormField,
  Input,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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
  /**
   * Issue #935 — the server's verdict on switching the factor off: refused
   * while it is the last one and a setting or the admin's role requires it.
   */
  canDisable: boolean;
  disableBlockedReason: 'factor_required' | null;
}

const BASE = '/api/v1/admin/account/mfa';

/** What `POST {BASE}/setup` answers: the manual key, the URI, and a QR code of the URI as SVG. */
interface MfaSetup {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

/**
 * Which form a failure belongs to. A refused code is reported on the field that
 * sent it (issue #1481); `page` is a failure no field caused — starting the
 * setup.
 */
type ErrorTarget = 'page' | 'confirm' | 'disable' | 'regenerate';

/**
 * What every code field shares. `one-time-code` lets the browser and the phone
 * offer the code. The keyboard is **not** forced numeric here: the disable and
 * regenerate fields also take a recovery code, which is hexadecimal, so only
 * the setup confirmation — a TOTP code alone — asks for `inputMode="numeric"`.
 */
const CODE_INPUT = {
  autoComplete: 'one-time-code',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  required: true,
} as const;

export default function AdminSecuritySettings(): ReactNode {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const t = useTranslation('mfa');
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // One code per form (issue #1481): the disable and regenerate fields were
  // bound to one state, so typing in either filled both.
  const [confirmCode, setConfirmCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenerateCode, setRegenerateCode] = useState('');
  const [error, setError] = useState<{ target: ErrorTarget; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async (): Promise<void> => {
    const res = await apiClient.get<{ data: MfaStatus }>(`${BASE}/status`);
    setStatus(res.data);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const run = useCallback(
    async (target: ErrorTarget, fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError({
          target,
          message: err instanceof ApiError ? err.envelope.error.message : t('security.error.generic'),
        });
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const errorFor = (target: ErrorTarget): string | undefined =>
    error?.target === target ? error.message : undefined;

  const startSetup = (): void =>
    void run('page', async () => {
      const res = await apiClient.post<{ data: MfaSetup }>(`${BASE}/setup`);
      setSetup(res.data);
      setRecoveryCodes(null);
    });

  const confirm = (e: FormEvent): void => {
    e.preventDefault();
    void run('confirm', async () => {
      const res = await apiClient.post<{ data: { recoveryCodes: string[] } }>(`${BASE}/activate`, {
        code: confirmCode,
      });
      setRecoveryCodes(res.data.recoveryCodes);
      setSetup(null);
      setConfirmCode('');
      await loadStatus();
    });
  };

  const disable = (e: FormEvent): void => {
    e.preventDefault();
    void run('disable', async () => {
      await apiClient.post(`${BASE}/disable`, { code: disableCode });
      setDisableCode('');
      setRegenerateCode('');
      setRecoveryCodes(null);
      await loadStatus();
    });
  };

  const regenerate = (e: FormEvent): void => {
    e.preventDefault();
    void run('regenerate', async () => {
      const res = await apiClient.post<{ data: { recoveryCodes: string[] } }>(
        `${BASE}/recovery-codes/regenerate`,
        { code: regenerateCode },
      );
      setRecoveryCodes(res.data.recoveryCodes);
      setRegenerateCode('');
      await loadStatus();
    });
  };

  const pageError = errorFor('page');

  return (
    <>
      <PageHeader
        title={
          <>
            <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
            {t('security.page.title')}
          </>
        }
        description={t('security.page.description')}
      />
      <Card className="max-w-2xl">
        <CardContent className="space-y-4">
          {pageError ? (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>{t('security.error.title')}</AlertTitle>
              <AlertDescription>{pageError}</AlertDescription>
            </Alert>
          ) : null}

          {recoveryCodes ? (
            <Alert>
              <AlertTitle>{t('security.recoveryCodes.title')}</AlertTitle>
              <AlertDescription>
                <p>{t('security.recoveryCodes.body')}</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                  {recoveryCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {status === null ? (
            <p className="text-sm text-muted-foreground">{t('security.loading')}</p>
          ) : status.totpActive ? (
            // Two sections in the one card (issue #1437, DS-03): the routine recovery codes first and
            // switching the factor off last, away from it (Fitts), each form named by its heading.
            <div className="space-y-6">
              <p className="text-sm">
                {t('security.status.enabled', { count: status.recoveryCodesRemaining })}
              </p>
              <EditorSection title={t('security.recoveryCodes.sectionTitle')}>
                <form className="space-y-2" onSubmit={regenerate}>
                  <FormField
                    label={t('security.regenerate.label')}
                    hint={t('security.code.hint')}
                    error={errorFor('regenerate')}
                    required
                  >
                    <Input
                      {...CODE_INPUT}
                      value={regenerateCode}
                      onChange={(e): void => setRegenerateCode(e.target.value)}
                    />
                  </FormField>
                  <Button type="submit" variant="outline" disabled={busy}>
                    {t('security.regenerate.submit')}
                  </Button>
                </form>
              </EditorSection>
              <EditorSection title={t('security.disable.sectionTitle')}>
                {status.canDisable ? (
                  <form className="space-y-2" onSubmit={disable}>
                    <FormField
                      label={t('security.disable.label')}
                      hint={t('security.code.hint')}
                      error={errorFor('disable')}
                      required
                    >
                      <Input
                        {...CODE_INPUT}
                        value={disableCode}
                        onChange={(e): void => setDisableCode(e.target.value)}
                      />
                    </FormField>
                    <Button type="submit" variant="destructive" disabled={busy}>
                      {t('security.disable.submit')}
                    </Button>
                  </form>
                ) : (
                  <Alert data-testid="mfa-disable-blocked">
                    <ShieldCheck className="size-4" />
                    <AlertTitle>{t('security.disableBlocked.title')}</AlertTitle>
                    <AlertDescription>{t('security.disableBlocked.body')}</AlertDescription>
                  </Alert>
                )}
              </EditorSection>
            </div>
          ) : setup ? (
            <form className="space-y-3" onSubmit={confirm}>
              <p className="text-sm">{t('security.setup.intro')}</p>
              {/* An <img> of the server-drawn SVG, never inserted as markup. */}
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
                alt={t('security.setup.qrAlt')}
                width={192}
                height={192}
                className="rounded border bg-white p-2"
              />
              <p className="text-sm text-muted-foreground">{t('security.setup.qrHint')}</p>
              <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{setup.otpauthUri}</p>
              <p className="text-sm">
                {t('security.setup.manualKey')} <code className="font-mono">{setup.secret}</code>
              </p>
              <FormField label={t('security.setup.codeLabel')} error={errorFor('confirm')} required>
                <Input
                  {...CODE_INPUT}
                  inputMode="numeric"
                  value={confirmCode}
                  onChange={(e): void => setConfirmCode(e.target.value)}
                  placeholder="123456"
                />
              </FormField>
              <Button type="submit" disabled={busy}>
                {t('security.setup.submit')}
              </Button>
            </form>
          ) : (
            <Button onClick={startSetup} disabled={busy}>
              {t('security.enable.submit')}
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}

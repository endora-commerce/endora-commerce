import { useState, type FormEvent, type ReactNode } from 'react';
import { LogIn, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';

/**
 * Admin login screen. Rendered by App when no session is active; the
 * AuthProvider re-fetches `/admin/me` after a successful POST and the
 * AppShell takes over.
 *
 * Bootstrap the first administrator from the repository root with:
 *   pnpm --filter backend run admin:create -- --email=… --password=… --first-name=… --last-name=…
 */
export function LoginPage(): ReactNode {
  const { login, lastLoginError, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LogIn className="size-5 text-primary" />
            B2B Admin · sign in
          </CardTitle>
          <CardDescription>
            Use the email and password issued by your platform administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastLoginError ? (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>
                {/expired/i.test(lastLoginError) ? 'Session expired' : 'Sign-in failed'}
              </AlertTitle>
              <AlertDescription>{lastLoginError}</AlertDescription>
            </Alert>
          ) : null}
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent): void => {
              e.preventDefault();
              setSubmitting(true);
              void login(email, password).finally(() => setSubmitting(false));
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e): void => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e): void => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || status === 'loading'}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            No account yet? Run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
              pnpm --filter backend run admin:create
            </code>{' '}
            from the repository root.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

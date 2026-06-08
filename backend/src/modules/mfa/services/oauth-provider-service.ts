import * as oidc from 'openid-client';

/**
 * Federated sign-in provider port (feature 042, US4/US5). The `mfa` routes
 * depend on this interface; production wires the `openid-client`-backed
 * implementation below, tests inject a deterministic fake. Provider client
 * id/secret come from backend config/env — never the Settings table (R2).
 */
export type OAuthProviderName = 'google' | 'microsoft';

export interface OAuthIdentity {
  provider: OAuthProviderName;
  /** Stable provider subject (`sub` claim). */
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface OAuthProviderPort {
  /** Whether the provider has client credentials configured. */
  isEnabled(provider: OAuthProviderName): boolean;
  buildAuthorizationUrl(
    provider: OAuthProviderName,
    args: { state: string; codeVerifier: string; nonce: string; redirectUri: string },
  ): Promise<string>;
  exchangeCode(
    provider: OAuthProviderName,
    args: {
      code: string;
      state: string;
      codeVerifier: string;
      nonce: string;
      redirectUri: string;
    },
  ): Promise<OAuthIdentity>;
}

export interface OAuthProviderConfig {
  google?: { clientId: string; clientSecret: string } | undefined;
  microsoft?:
    | { clientId: string; clientSecret: string; tenant?: string | undefined }
    | undefined;
}

/** Builds the provider config from environment, or `null` when nothing is set. */
export function readOAuthConfigFromEnv(env = process.env): OAuthProviderConfig {
  const cfg: OAuthProviderConfig = {};
  if (env['MFA_OAUTH_GOOGLE_CLIENT_ID'] && env['MFA_OAUTH_GOOGLE_CLIENT_SECRET']) {
    cfg.google = {
      clientId: env['MFA_OAUTH_GOOGLE_CLIENT_ID'],
      clientSecret: env['MFA_OAUTH_GOOGLE_CLIENT_SECRET'],
    };
  }
  if (env['MFA_OAUTH_MICROSOFT_CLIENT_ID'] && env['MFA_OAUTH_MICROSOFT_CLIENT_SECRET']) {
    cfg.microsoft = {
      clientId: env['MFA_OAUTH_MICROSOFT_CLIENT_ID'],
      clientSecret: env['MFA_OAUTH_MICROSOFT_CLIENT_SECRET'],
      tenant: env['MFA_OAUTH_MICROSOFT_TENANT'] ?? 'common',
    };
  }
  return cfg;
}

export class OpenIdOAuthProvider implements OAuthProviderPort {
  private readonly configs = new Map<OAuthProviderName, oidc.Configuration>();

  constructor(private readonly cfg: OAuthProviderConfig) {}

  isEnabled(provider: OAuthProviderName): boolean {
    return provider === 'google' ? Boolean(this.cfg.google) : Boolean(this.cfg.microsoft);
  }

  private async config(provider: OAuthProviderName): Promise<oidc.Configuration> {
    const cached = this.configs.get(provider);
    if (cached) return cached;
    if (provider === 'google') {
      if (!this.cfg.google) throw new Error('Google OAuth is not configured.');
      const config = await oidc.discovery(
        new URL('https://accounts.google.com'),
        this.cfg.google.clientId,
        this.cfg.google.clientSecret,
      );
      this.configs.set(provider, config);
      return config;
    }
    if (!this.cfg.microsoft) throw new Error('Microsoft OAuth is not configured.');
    const tenant = this.cfg.microsoft.tenant ?? 'common';
    const config = await oidc.discovery(
      new URL(`https://login.microsoftonline.com/${tenant}/v2.0`),
      this.cfg.microsoft.clientId,
      this.cfg.microsoft.clientSecret,
    );
    this.configs.set(provider, config);
    return config;
  }

  async buildAuthorizationUrl(
    provider: OAuthProviderName,
    args: { state: string; codeVerifier: string; nonce: string; redirectUri: string },
  ): Promise<string> {
    const config = await this.config(provider);
    const codeChallenge = await oidc.calculatePKCECodeChallenge(args.codeVerifier);
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: args.redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: args.state,
      nonce: args.nonce,
    });
    return url.href;
  }

  async exchangeCode(
    provider: OAuthProviderName,
    args: {
      code: string;
      state: string;
      codeVerifier: string;
      nonce: string;
      redirectUri: string;
    },
  ): Promise<OAuthIdentity> {
    const config = await this.config(provider);
    const currentUrl = new URL(args.redirectUri);
    currentUrl.searchParams.set('code', args.code);
    currentUrl.searchParams.set('state', args.state);
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: args.codeVerifier,
      expectedNonce: args.nonce,
      expectedState: args.state,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    return {
      provider,
      sub: String(claims?.sub ?? ''),
      email: typeof claims?.['email'] === 'string' ? (claims['email'] as string) : '',
      emailVerified: claims?.['email_verified'] === true,
    };
  }
}

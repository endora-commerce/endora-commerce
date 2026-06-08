import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { ChallengeStore } from './services/challenge-store.js';
import {
  MfaPolicyResolver,
  type SettingsReader,
} from './services/mfa-policy-resolver.js';
import { MfaLoginService } from './services/mfa-login-service.js';

/**
 * MFA module composition root (feature 042).
 *
 * Owns 2FA enrolment, recovery codes, federated sign-in, policy resolution,
 * and admin reset. Sibling services (settings, audit) are injected from
 * `composition.ts` so the module never imports another module's internals
 * (Constitution Principle I). The module exposes its `MfaLoginPort` via the
 * handle; the per-surface login services consult it through that port.
 *
 * Routes are added per user story (US1+); this Phase-2 plugin registers none
 * yet and exists so the module composes and exposes the login port.
 */
export interface MfaModuleOptions {
  emFactory: () => EntityManager;
  redis: Redis;
  settingsService: SettingsReader;
  auditLogService: AuditLogService;
  /** base64 32-byte AES key for TOTP secrets at rest (required for enrolment). */
  secretEncryptionKey?: string | undefined;
}

export interface MfaModuleHandle {
  mfaLoginPort: MfaLoginPort;
  challengeStore: ChallengeStore;
  policyResolver: MfaPolicyResolver;
}

export function mfaModule(options: MfaModuleOptions): {
  plugin: ModulePlugin;
  handle: () => MfaModuleHandle;
} {
  const challengeStore = new ChallengeStore(options.redis);
  const policyResolver = new MfaPolicyResolver(
    options.settingsService,
    options.emFactory,
  );
  const loginService = new MfaLoginService(
    options.emFactory,
    challengeStore,
    policyResolver,
  );

  const plugin: ModulePlugin = async (_app) => {
    // Routes are registered per user story (verify / enrol / oauth / reset).
  };

  return {
    plugin,
    handle: () => ({ mfaLoginPort: loginService, challengeStore, policyResolver }),
  };
}

import { createHash } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
// Feature 075, Phase C — pure functions over their arguments (a secret and a
// code in, valid or not out), so they live in the kernel: "is this code valid
// for this secret" has no business answering 503 because a module is off.
import { enroll, verifyTotp } from '../../../kernel/crypto/totp.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

/**
 * Customer-side 2FA enrolment (T119).
 *
 *   - enable: generates a TOTP secret + 10 backup codes, persists the secret,
 *     leaves twoFactorConfirmedAt null. Returns the secret + otpauth URI so
 *     the storefront can render a QR.
 *   - confirm: takes the user-supplied code, verifies against the stored
 *     secret, sets twoFactorConfirmedAt.
 *   - disable: requires either a current code or a backup code.
 */

export interface EnableResult {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
}

export class TotpEnrolmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'customer_account',
        objectId,
        stateBefore: null,
        stateAfter: null,
      });
    }
  }

  async enable(customerAccountId: string): Promise<EnableResult> {
    const em = this.emFactory();
    const customer = await this.#load(em, customerAccountId);
    if (customer.twoFactorConfirmedAt) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        '2FA is already enabled for this account.',
      );
    }
    const enrolment = enroll(customer.email);
    // Storage: TOTP secret + sha256 hashes of backup codes (joined with ',').
    customer.twoFactorSecret = `${enrolment.secret}|${enrolment.backupCodes.map(sha256Hex).join(',')}`;
    this.#audit(em, 'customer_account.mfa_enrol_start', customer.id);
    await em.flush();
    return {
      secret: enrolment.secret,
      otpauthUri: enrolment.otpauthUri,
      backupCodes: enrolment.backupCodes,
    };
  }

  async confirm(customerAccountId: string, code: string): Promise<void> {
    const em = this.emFactory();
    const customer = await this.#load(em, customerAccountId);
    if (!customer.twoFactorSecret) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        '2FA enrolment was not started.',
      );
    }
    const [secret] = customer.twoFactorSecret.split('|');
    if (!secret || !verifyTotp(secret, code)) {
      throw new HttpError(
        401,
        ERROR_CODES.UNAUTHORIZED,
        'Invalid 2FA code.',
      );
    }
    customer.twoFactorConfirmedAt = new Date();
    this.#audit(em, 'customer_account.mfa_enabled', customer.id);
    await em.flush();
  }

  async disable(customerAccountId: string, codeOrBackup: string): Promise<void> {
    const em = this.emFactory();
    const customer = await this.#load(em, customerAccountId);
    if (!customer.twoFactorConfirmedAt || !customer.twoFactorSecret) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, '2FA is not enabled.');
    }
    const [secret, backupHashesCsv] = customer.twoFactorSecret.split('|');
    const valid =
      (secret && verifyTotp(secret, codeOrBackup)) ||
      (backupHashesCsv && backupHashesCsv.split(',').includes(sha256Hex(codeOrBackup)));
    if (!valid) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid 2FA code.');
    }
    customer.twoFactorSecret = null;
    customer.twoFactorConfirmedAt = null;
    this.#audit(em, 'customer_account.mfa_disabled', customer.id);
    await em.flush();
  }

  async #load(em: EntityManager, customerAccountId: string): Promise<CustomerAccount> {
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId, deletedAt: null });
    if (!customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    return customer;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

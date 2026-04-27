import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword, verifyPassword } from '../../auth/services/password-hasher.js';
import type { SessionService } from '../../auth/services/session-service.js';
import { AdminUser } from '../entities/admin-user.entity.js';

/**
 * AdminAuthService (T186). login → admin SessionService.createSession;
 * logout → destroy. changePassword mirrors the customer flow.
 */
export interface AdminLoginResult {
  adminUser: AdminUser;
  sessionCookieValue: string;
  sessionExpiresAt: Date;
}

export class AdminAuthService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly sessionService: SessionService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AdminLoginResult> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { email: input.email, deletedAt: null });
    if (!admin || admin.status !== 'active') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid email or password.');
    }
    const ok = await verifyPassword(admin.passwordHash, input.password);
    if (!ok) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid email or password.');
    }
    const session = await this.sessionService.createSession({
      kind: 'admin',
      adminUserId: admin.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });
    admin.lastLoginAt = new Date();
    await em.flush();
    return {
      adminUser: admin,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }

  async changePassword(
    adminUserId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { id: adminUserId, deletedAt: null });
    if (!admin) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    const ok = await verifyPassword(admin.passwordHash, currentPassword);
    if (!ok) {
      throw new HttpError(
        401,
        ERROR_CODES.CURRENT_PASSWORD_INVALID,
        'Current password is incorrect.',
      );
    }
    admin.passwordHash = await hashPassword(newPassword);
    await em.flush();
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.destroySession(sessionId);
  }
}

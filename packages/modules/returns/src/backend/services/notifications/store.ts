import type { EntityManager } from '@mikro-orm/postgresql';
import { ReturnCase } from '../../entities/return-case.entity.js';
import { ReturnCaseComment } from '../../entities/return-case-comment.entity.js';
import { ReturnCaseItem } from '../../entities/return-case-item.entity.js';
import { ReturnStatus } from '../../entities/return-status.entity.js';
import type { NotificationStore } from './dispatch.js';

/**
 * The notification job's reads over this module's tables
 * (`specs/180-off-platform-complaints/` research R-2). **Called inside the system
 * scope the worker enters** — there is no request behind a job, and the case is
 * read by id whoever owns it — so the reads still pass the tenancy guard, which
 * the scope opens; nothing here widens it.
 */
export function createNotificationStore(emFactory: () => EntityManager): NotificationStore {
  return {
    async loadCase(returnCaseId) {
      const em = emFactory();
      const rc = await em.findOne(ReturnCase, { id: returnCaseId });
      if (!rc) return null;
      const items = await em.find(ReturnCaseItem, { returnCaseId }, { orderBy: { id: 'asc' } });
      return {
        id: rc.id,
        rmaNumber: rc.rmaNumber ?? null,
        kind: rc.kind,
        orderId: rc.orderId,
        salesChannelId: rc.salesChannelId,
        customerAccountId: rc.customerAccountId,
        organizationId: rc.organizationId ?? null,
        submittedAt: rc.submittedAt,
        lines: items.map((it) => ({ productName: it.productName, quantity: it.quantity })),
      };
    },
    async loadComment(returnCaseCommentId) {
      const comment = await emFactory().findOne(ReturnCaseComment, { id: returnCaseCommentId });
      if (!comment) return null;
      return {
        id: comment.id,
        returnCaseId: comment.returnCaseId,
        body: comment.body,
        isCustomerVisible: comment.isCustomerVisible,
        notifyCustomer: comment.notifyCustomer,
      };
    },
    async loadStatus(code) {
      const status = await emFactory().findOne(ReturnStatus, { code });
      return status ? { code: status.code, name: status.name, defaultName: status.defaultName } : null;
    },
  };
}

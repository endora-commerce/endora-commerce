/** Admin audit context (mirrors the Settings module's AdminAuditContext). */
export interface AdminAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

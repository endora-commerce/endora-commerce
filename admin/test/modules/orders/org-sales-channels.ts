/**
 * Issue #515 — `GET /api/v1/admin/organizations/:id/sales-channels` as the order
 * create screen reads it: the channels the customer's Organization is assigned
 * to, and every channel it may hold. By default every channel given is
 * assigned; `assigned` narrows that.
 */
export function orgSalesChannels(
  channels: ReadonlyArray<{ id: string; code: string; name: Record<string, string>; active: boolean }>,
  assigned: readonly string[] = channels.map((c) => c.id),
  organizationId = 'org-1',
): {
  data: {
    organizationId: string;
    assignedSalesChannelIds: string[];
    options: Array<{ id: string; code: string; name: Record<string, string>; active: boolean; systemDefault: boolean }>;
  };
} {
  return {
    data: {
      organizationId,
      assignedSalesChannelIds: [...assigned],
      options: channels.map((c) => ({ ...c, systemDefault: false })),
    },
  };
}

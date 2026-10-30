import type { AdminFeedbackRequest } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Sends feedback to the makers of Endora Commerce through this instance
 * (`POST /api/v1/admin/feedback`, the `admin_feedback` module). Any signed-in
 * administrator may; the instance relays it and answers 204.
 */
export async function sendAdminFeedback(body: AdminFeedbackRequest): Promise<void> {
  await apiClient.post<void>('/api/v1/admin/feedback', body);
}

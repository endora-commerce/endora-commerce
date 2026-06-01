import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export interface AdminNotificationItem {
  id: string;
  audience: 'all_admins' | 'admin_user';
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: string;
  isRead: boolean;
}

export interface AdminNotificationFeed {
  items: AdminNotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface UseAdminNotificationsResult {
  items: AdminNotificationItem[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * Drives the admin bell. Polls `GET /api/v1/admin/notifications` every
 * `pollMs` (default 30s) so newly-emitted notifications show up promptly
 * without WebSockets. Tracks an AbortController to drop in-flight requests
 * on unmount.
 *
 * The feed returns the unread-first slice (limit 25 by default); the
 * server already does the per-admin isRead resolution.
 */
export function useAdminNotifications(options?: {
  pollMs?: number;
  limit?: number;
  unreadOnly?: boolean;
}): UseAdminNotificationsResult {
  const pollMs = options?.pollMs ?? 30_000;
  const limit = options?.limit ?? 25;
  const unreadOnly = options?.unreadOnly ?? false;

  const [items, setItems] = useState<AdminNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(limit));
      if (unreadOnly) qs.set('unread', 'true');
      const page = await apiClient.get<AdminNotificationFeed>(
        `/api/v1/admin/notifications?${qs.toString()}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setItems(page.items);
      setUnreadCount(page.unreadCount);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load notifications.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [limit, unreadOnly]);

  const markRead = useCallback(
    async (id: string): Promise<void> => {
      try {
        await apiClient.post(`/api/v1/admin/notifications/${id}/read`, {});
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to mark notification read.');
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post('/api/v1/admin/notifications/mark-all-read', {});
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark notifications read.');
    }
  }, [refresh]);

  // Initial load + polling loop.
  useEffect(() => {
    void refresh();
    const tick = (): void => {
      timerRef.current = setTimeout(() => {
        void refresh().finally(() => tick());
      }, pollMs);
    };
    tick();
    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [refresh, pollMs]);

  return { items, unreadCount, loading, error, refresh, markRead, markAllRead };
}

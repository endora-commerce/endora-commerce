import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';

/**
 * Feature 024 — admin-side hook that fetches the dashboard's curated
 * Recent Activity feed and keeps it fresh.
 *
 * Mirrors the existing HomePage KPI-fetch pattern (no @tanstack/react-query
 * dep in this app — Constitution Principle IV). Refreshes on mount, on
 * tab refocus, and on a 30-second foreground interval — exactly what
 * spec FR-027 / FR-028 require.
 */

export interface RecentActivityItem {
  id: string;
  actedAt: string;
  action: string;
  module: 'catalog' | 'inventory' | 'price_lists';
  actorDisplayName: string;
  actorKind: 'admin' | 'system';
  targetType: string;
  targetId: string;
  targetDisplayName: string;
  targetUrl: string | null;
  summary: Record<string, unknown> | null;
}

interface RecentActivityResponse {
  data: RecentActivityItem[];
  pagination: { limit: number; fetchedAt: string };
}

export interface UseRecentActivityState {
  status: 'loading' | 'ready' | 'error' | 'forbidden';
  items: RecentActivityItem[];
  refetch: () => void;
}

const REFRESH_INTERVAL_MS = 30_000;

export function useRecentActivity(limit = 8): UseRecentActivityState {
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [status, setStatus] = useState<UseRecentActivityState['status']>('loading');
  // Tracks whether the first response has landed so subsequent silent
  // background refreshes don't blink the loading skeleton in the user's face.
  const hasLoadedRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<RecentActivityResponse>(
        `/api/v1/admin/audit-log/recent-activity?limit=${limit}`,
      );
      setItems(res.data);
      setStatus('ready');
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setStatus('forbidden');
        hasLoadedRef.current = true;
        return;
      }
      // Only escalate to the visible error state when the user has not
      // already seen a successful render. Background-refresh errors keep
      // the previous rows on screen.
      if (!hasLoadedRef.current) setStatus('error');
    }
  }, [limit]);

  const refetch = useCallback((): void => {
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      if (!cancelled) await fetchOnce();
    };
    void tick();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, REFRESH_INTERVAL_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return (): void => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchOnce]);

  return { status, items, refetch };
}

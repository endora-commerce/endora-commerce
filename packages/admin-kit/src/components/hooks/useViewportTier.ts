import { useEffect, useState } from 'react';

export type ViewportTier = 'mobile' | 'desktop';

const DESKTOP_QUERY = '(min-width: 1024px)';

function readTier(): ViewportTier {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'mobile';
}

/**
 * Client-side viewport tier aligned with Tailwind `lg` and the mobile
 * admin shell contract (feature 029).
 */
export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(readTier);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (): void => setTier(mq.matches ? 'desktop' : 'mobile');
    mq.addEventListener('change', onChange);
    onChange();
    return (): void => mq.removeEventListener('change', onChange);
  }, []);

  return tier;
}

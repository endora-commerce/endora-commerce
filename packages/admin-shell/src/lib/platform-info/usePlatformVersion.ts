import { useEffect, useState } from 'react';
import { getPlatformInfo } from './api.js';

/**
 * The release the header badge shows, or `null` for "say nothing".
 *
 * **The number is the API's, not this bundle's.** "Which Endora Commerce is
 * this?" is a question about the instance — its schema, its modules, what its
 * endpoints answer — and the admin is a client of that. It is also the only
 * number that is right in all three ways an admin runs: built from the
 * monorepo's sources, installed from npm into a scaffolded instance, and built
 * elsewhere against published packages. A constant baked into this package
 * would be right in each of them only for as long as the admin and the API
 * were deployed together.
 *
 * **`null` covers three states on purpose**, and the badge renders nothing for
 * any of them: still loading, the read failed (an API older than the route
 * answers 404), and the platform could not tell. They are not distinguished
 * because there is nothing an operator can do about any of them from the
 * header, and every placeholder that could stand in — a dash, a skeleton, a
 * `0.0.0` — reads as a version.
 *
 * Read once per mount. The shell mounts once per session and the answer cannot
 * change without the API restarting, so there is no refresh and no cache.
 */
export function usePlatformVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlatformInfo()
      .then((info) => {
        if (cancelled) return;
        // Liberal in what is accepted: anything that is not a non-blank string
        // is "unknown", whatever shape it arrived in.
        const candidate: unknown = (info as { version?: unknown } | null | undefined)?.version;
        const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
        setVersion(trimmed.length > 0 ? trimmed : null);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  return version;
}

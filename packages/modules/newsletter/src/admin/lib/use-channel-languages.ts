import { useEffect, useState } from 'react';
import { fetchScopeSalesChannel, listScopeSalesChannels } from '@endora-commerce/admin-kit/components';

/**
 * The content languages the active sales channels offer, sorted, for a picker
 * (issue #1463, UX audit CONTENT-05 — Tesler's Law: the operator chooses a
 * language the shop has instead of typing a code such as `en-US`).
 *
 * A campaign is not bound to one channel in the editor, so the offer is every
 * active channel's languages together. `current` is always included, so a
 * stored language no channel offers any more still shows as what it is rather
 * than being replaced by the first option. A channel whose read fails offers
 * its default language; a list that cannot be read at all offers `current`.
 */
export function useChannelLanguages(current: string): string[] {
  const [languages, setLanguages] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    listScopeSalesChannels()
      .then((res) =>
        Promise.all(
          res.items.map((channel) =>
            fetchScopeSalesChannel(channel.code)
              .then((detail) => (detail.languages?.length ? detail.languages : [channel.defaultLanguage]))
              .catch(() => [channel.defaultLanguage]),
          ),
        ),
      )
      .then((perChannel) => {
        if (live) setLanguages(perChannel.flat().filter((code): code is string => Boolean(code)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return Array.from(new Set([...languages, ...(current ? [current] : [])])).sort();
}

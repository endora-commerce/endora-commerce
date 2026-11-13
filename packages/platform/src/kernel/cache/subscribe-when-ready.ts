/**
 * `SUBSCRIBE` on an ioredis client only once its handshake is over (issue #1096).
 *
 * ioredis writes a `SUBSCRIBE` issued in the `connect` state — the TCP socket is
 * up, the ready check's `INFO` not yet sent — straight to the socket, because
 * the command carries Redis's `loading` flag. When the `SUBSCRIBE` reply lands
 * first, the connection is already in subscriber mode: ioredis refuses its own
 * `INFO` (`Connection in subscriber mode, only subscriber commands may be
 * used`), re-opens the socket, and a message published during that reconnect
 * reaches no one. In every other state the command is either written on a
 * ready connection or parked in the offline queue, which ioredis flushes only
 * after `ready` — so `connect` is the one state to wait out.
 *
 * Every cross-process invalidation subscriber subscribes through this
 * function, so the ordering no longer depends on where in boot the call
 * happens to sit.
 */

/** The part of an ioredis client this function uses; `Redis` satisfies it. */
export interface HandshakeAwareSubscriber {
  readonly status: string;
  subscribe(...channels: string[]): Promise<unknown>;
  once(event: 'ready' | 'close' | 'end', listener: () => void): unknown;
  removeListener(event: 'ready' | 'close' | 'end', listener: () => void): unknown;
}

/** Resolve on the first of `ready`, `close` or `end` — the handshake's outcomes. */
function handshakeSettled(client: HandshakeAwareSubscriber): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      client.removeListener('ready', settle);
      client.removeListener('close', settle);
      client.removeListener('end', settle);
      resolve();
    };
    client.once('ready', settle);
    client.once('close', settle);
    client.once('end', settle);
  });
}

/**
 * Subscribe `client` to `channels`, waiting out an in-flight handshake first.
 *
 * Rejects as `client.subscribe` does — in particular when the client ends while
 * the handshake is pending — so a caller's existing degraded-mode handling
 * still applies. A connection that closes mid-handshake leaves the client
 * reconnecting, where the command waits in ioredis's offline queue for the
 * next `ready`.
 */
export async function subscribeWhenReady(
  client: HandshakeAwareSubscriber,
  ...channels: string[]
): Promise<void> {
  while (client.status === 'connect') await handshakeSettled(client);
  await client.subscribe(...channels);
}

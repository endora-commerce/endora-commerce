/**
 * Issue #1096 — `SUBSCRIBE` must not reach the socket before ioredis's ready
 * check has run.
 *
 * ioredis writes a `SUBSCRIBE` issued in the `connect` state (TCP up, ready
 * check not yet sent) straight to the socket, because the command carries
 * Redis's `loading` flag. When its reply lands before the ready check's `INFO`
 * is sent, the connection is already in subscriber mode, ioredis refuses its
 * own `INFO` and re-opens the socket — and a message published during that
 * reconnect reaches no one.
 *
 * The race is reproduced against a real ioredis client and a minimal RESP
 * server that holds the handshake's `CLIENT SETINFO` replies — and therefore
 * the `INFO` that follows them — until the test releases them.
 */
import { once } from 'node:events';
import net from 'node:net';

import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

import { subscribeWhenReady } from './subscribe-when-ready.js';

interface FakeConnection {
  readonly socket: net.Socket;
  readonly commands: string[];
}

/** Encode one RESP value: a string as a bulk string, a number as an integer. */
function encode(value: string | number): string {
  return typeof value === 'number' ? `:${value}\r\n` : `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}

function encodeArray(values: readonly (string | number)[]): string {
  return `*${values.length}\r\n${values.map(encode).join('')}`;
}

/**
 * Parse every complete RESP array of bulk strings at the head of `buffer`.
 * Returns the commands and whatever incomplete tail is left over.
 */
function parseCommands(buffer: string): { commands: string[][]; rest: string } {
  const commands: string[][] = [];
  let cursor = 0;
  for (;;) {
    if (buffer[cursor] !== '*') break;
    const headerEnd = buffer.indexOf('\r\n', cursor);
    if (headerEnd < 0) break;
    const count = Number(buffer.slice(cursor + 1, headerEnd));
    let at = headerEnd + 2;
    const args: string[] = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      const lenEnd = buffer.indexOf('\r\n', at);
      if (lenEnd < 0) {
        complete = false;
        break;
      }
      const len = Number(buffer.slice(at + 1, lenEnd));
      const start = lenEnd + 2;
      if (buffer.length < start + len + 2) {
        complete = false;
        break;
      }
      args.push(buffer.slice(start, start + len));
      at = start + len + 2;
    }
    if (!complete) break;
    commands.push(args);
    cursor = at;
  }
  return { commands, rest: buffer.slice(cursor) };
}

/**
 * A RESP server just large enough for ioredis's handshake and `SUBSCRIBE`.
 * On the **first** connection only, `CLIENT` replies are held until
 * `releaseHandshake()`; later connections (an ioredis reconnect) are answered
 * at once, so the unfixed path recovers the way it does against real Redis.
 */
async function startFakeRedis() {
  const connections: FakeConnection[] = [];
  const held: Array<() => void> = [];
  let released = false;
  let notifyClientCommand: (() => void) | null = null;

  const server = net.createServer((socket) => {
    const connection: FakeConnection = { socket, commands: [] };
    const isFirst = connections.length === 0;
    connections.push(connection);
    let pending = '';
    socket.setEncoding('latin1');
    socket.on('error', () => {});
    socket.on('data', (chunk: string) => {
      const parsed = parseCommands(pending + chunk);
      pending = parsed.rest;
      for (const args of parsed.commands) {
        const name = (args[0] ?? '').toUpperCase();
        connection.commands.push(name);
        if (name === 'CLIENT') {
          const reply = () => socket.write('+OK\r\n');
          if (isFirst && !released) held.push(reply);
          else reply();
          notifyClientCommand?.();
        } else if (name === 'INFO') {
          socket.write(encode('# Server\r\nredis_version:7.2.0\r\nloading:0\r\n'));
        } else if (name === 'SUBSCRIBE') {
          args.slice(1).forEach((channel, i) => {
            socket.write(encodeArray(['subscribe', channel, i + 1]));
          });
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    connections,
    /** Resolves once the first connection has sent `count` CLIENT commands. */
    async clientCommandsReceived(count: number): Promise<void> {
      const seen = () => (connections[0]?.commands.filter((c) => c === 'CLIENT').length ?? 0) >= count;
      while (!seen()) {
        await new Promise<void>((resolve) => {
          notifyClientCommand = resolve;
        });
      }
      notifyClientCommand = null;
    },
    releaseHandshake(): void {
      released = true;
      for (const reply of held.splice(0)) reply();
    },
    async close(): Promise<void> {
      for (const { socket } of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('subscribeWhenReady (issue #1096)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('holds SUBSCRIBE until the ready check passed, so no reconnect drops a message', async () => {
    const fake = await startFakeRedis();
    cleanups.push(() => fake.close());
    const client = new Redis({ host: '127.0.0.1', port: fake.port, maxRetriesPerRequest: null, retryStrategy: () => 10 });
    const errors: unknown[] = [];
    client.on('error', (err) => errors.push(err));
    cleanups.push(() => client.disconnect());
    const received: string[] = [];
    client.on('message', (channel: string, message: string) => received.push(`${channel}:${message}`));

    // The handshake is mid-flight: TCP is up, the CLIENT replies are held, so
    // the ready check's INFO has not been sent.
    await fake.clientCommandsReceived(2);
    expect(client.status).toBe('connect');

    const subscribed = subscribeWhenReady(client, 'issue-1096');
    // Long enough on loopback for a SUBSCRIBE written in the `connect` state to
    // have reached the server and been answered.
    await new Promise((resolve) => setTimeout(resolve, 100));
    fake.releaseHandshake();
    await subscribed;
    if (client.status !== 'ready') await once(client, 'ready');

    const first = fake.connections[0]!;
    expect(first.commands.indexOf('INFO')).toBeGreaterThanOrEqual(0);
    expect(first.commands.indexOf('SUBSCRIBE')).toBeGreaterThan(first.commands.indexOf('INFO'));
    expect(fake.connections).toHaveLength(1);
    expect(errors).toEqual([]);

    // Published right after the subscription was confirmed: it must arrive.
    first.socket.write(encodeArray(['message', 'issue-1096', 'hello']));
    const deadline = Date.now() + 2000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(received).toEqual(['issue-1096:hello']);
  });

  it('subscribes at once on a client that is already ready', async () => {
    const fake = await startFakeRedis();
    cleanups.push(() => fake.close());
    fake.releaseHandshake();
    const client = new Redis({ host: '127.0.0.1', port: fake.port, maxRetriesPerRequest: null });
    cleanups.push(() => client.disconnect());
    await once(client, 'ready');

    await subscribeWhenReady(client, 'a', 'b');

    expect(fake.connections[0]!.commands.filter((c) => c === 'SUBSCRIBE')).toHaveLength(1);
  });

  it('rejects, rather than waiting forever, when the client ends during the handshake', async () => {
    const fake = await startFakeRedis();
    cleanups.push(() => fake.close());
    const client = new Redis({ host: '127.0.0.1', port: fake.port, maxRetriesPerRequest: null, retryStrategy: () => null });
    client.on('error', () => {});
    await fake.clientCommandsReceived(2);
    expect(client.status).toBe('connect');

    const subscribed = subscribeWhenReady(client, 'issue-1096');
    client.disconnect();

    await expect(subscribed).rejects.toThrow();
    expect(fake.connections[0]!.commands).not.toContain('SUBSCRIBE');
  });
});

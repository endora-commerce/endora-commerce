import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpProvider } from './smtp-provider.js';

/**
 * `SmtpProvider` against a real SMTP conversation over TCP, authentication
 * included.
 *
 * The sink below is the smallest server `nodemailer` will talk to — greeting,
 * EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT — written against `node:net` so the
 * test needs no container and no dependency. It exists because a `nodemailer`
 * major has moved the module shape and the declarations under this file before
 * (10.0 is a TypeScript/ESM rewrite): a type-check proves the call compiles,
 * only a send proves the message still leaves with every part it was given.
 */
interface Received {
  auth: string | null;
  rcptTo: string[];
  data: string;
}

function startSink(): Promise<{ server: Server; port: number; received: Received[]; logins: string[] }> {
  const received: Received[] = [];
  const logins: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    let auth: string | null = null;
    let current: Received = { auth: null, rcptTo: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 sink.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          current.auth = auth;
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(current);
          current = { auth: null, rcptTo: [], data: '' };
          reply('250 2.0.0 queued');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') reply('250-sink.test\r\n250-AUTH PLAIN\r\n250 8BITMIME');
        else if (verb === 'AUTH') {
          // `AUTH PLAIN <base64(\0user\0pass)>`
          auth = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
          logins.push(auth);
          reply('235 2.7.0 authenticated');
        } else if (verb === 'RCPT') {
          current.rcptTo.push(line);
          reply('250 2.1.5 ok');
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 go ahead');
        } else if (verb === 'QUIT') {
          reply('221 bye');
          socket.end();
          return;
        } else reply('250 ok');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, received, logins });
    });
  });
}

describe('SmtpProvider — a real SMTP send', () => {
  let sink: Awaited<ReturnType<typeof startSink>>;

  beforeAll(async () => {
    sink = await startSink();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => sink.server.close(() => resolve()));
  });

  const provider = () =>
    new SmtpProvider({
      host: '127.0.0.1',
      port: sink.port,
      secure: false,
      username: 'relay-user',
      password: 'relay-secret',
    });

  it('verifies the relay, authenticating with the configured credentials', async () => {
    await expect(provider().verify()).resolves.toEqual({ ok: true });
    expect(sink.logins).toContain('\0relay-user\0relay-secret');
  });

  it('hands over a text body, an HTML body and the list headers in one message', async () => {
    const result = await provider().send({
      to: 'subscriber@example.com',
      fromEmail: 'news@endora.test',
      fromName: 'Endora News',
      subject: 'Autumn issue',
      text: 'Plain body of the newsletter',
      html: '<p>HTML body of the newsletter</p>',
      messageId: '<campaign.1.subscriber.2@endora.test>',
      headers: { 'List-Unsubscribe': '<https://endora.test/u/token>' },
    });

    expect(result).toEqual({ providerMessageId: '<campaign.1.subscriber.2@endora.test>' });
    expect(sink.received).toHaveLength(1);
    const message = sink.received[0]!;
    expect(message.auth).toBe('\0relay-user\0relay-secret');
    expect(message.rcptTo).toEqual(['RCPT TO:<subscriber@example.com>']);
    expect(message.data).toContain('From: Endora News <news@endora.test>');
    expect(message.data).toContain('Subject: Autumn issue');
    expect(message.data).toContain('List-Unsubscribe: <https://endora.test/u/token>');
    expect(message.data).toContain('multipart/alternative');
    expect(message.data).toContain('Plain body of the newsletter');
    expect(message.data).toContain('<p>HTML body of the newsletter</p>');
  });
});

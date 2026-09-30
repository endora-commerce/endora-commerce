import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpMailer } from './smtp-mailer.js';

/**
 * `SmtpMailer` against a real SMTP conversation over TCP.
 *
 * The sink below is the smallest server `nodemailer` will talk to — greeting,
 * EHLO, MAIL, RCPT, DATA, QUIT — written against `node:net` so the test needs
 * no container and no dependency. It exists because a `nodemailer` major has
 * moved the module shape and the declarations under this file before (10.0 is
 * a TypeScript/ESM rewrite): a type-check proves the call compiles, only a
 * send proves the message still leaves with every part it was given.
 */
interface Received {
  mailFrom: string;
  rcptTo: string[];
  data: string;
}

function startSink(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    let current: Received = { mailFrom: '', rcptTo: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 sink.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(current);
          current = { mailFrom: '', rcptTo: [], data: '' };
          reply('250 2.0.0 queued');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') reply('250-sink.test\r\n250 8BITMIME');
        else if (verb === 'MAIL') {
          current.mailFrom = line;
          reply('250 2.1.0 ok');
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
      resolve({ server, port: (server.address() as AddressInfo).port, received });
    });
  });
}

describe('SmtpMailer — a real SMTP send', () => {
  let sink: Awaited<ReturnType<typeof startSink>>;

  beforeAll(async () => {
    sink = await startSink();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => sink.server.close(() => resolve()));
  });

  it('hands over a text body, an HTML body and an attachment in one message', async () => {
    const mailer = new SmtpMailer(`smtp://127.0.0.1:${sink.port}`);
    const pdf = Buffer.from('%PDF-1.4 smtp-mailer test attachment');

    await expect(
      mailer.send({
        messageId: '<invoice_issued.abc@endora.test>',
        to: 'buyer@example.com',
        subject: 'Invoice FV 1/2026',
        text: 'Plain body of the invoice mail',
        html: '<p>HTML body of the invoice mail</p>',
        attachments: [
          { filename: 'invoice-FV_1_2026.pdf', content: pdf, contentType: 'application/pdf' },
        ],
      }),
    ).resolves.toEqual({ status: 'sent' });

    expect(sink.received).toHaveLength(1);
    const message = sink.received[0]!;
    expect(message.rcptTo).toEqual(['RCPT TO:<buyer@example.com>']);
    expect(message.data).toContain('Subject: Invoice FV 1/2026');
    expect(message.data).toContain('Message-ID: <invoice_issued.abc@endora.test>');
    expect(message.data).toContain('multipart/mixed');
    expect(message.data).toContain('multipart/alternative');
    expect(message.data).toContain('Plain body of the invoice mail');
    expect(message.data).toContain('<p>HTML body of the invoice mail</p>');
    expect(message.data).toMatch(/Content-Type: application\/pdf; name=invoice-FV_1_2026\.pdf/);
    expect(message.data.replace(/\r\n/g, '')).toContain(pdf.toString('base64'));
  });
});

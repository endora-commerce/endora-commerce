import nodemailer from 'nodemailer';
import type { Mailer, MailerSendInput } from './mailer.js';

/**
 * Production SMTP mailer using `nodemailer`. Configure via `SMTP_URL`
 * (e.g. `smtps://user:pass@smtp.example.com:465` or SendGrid SMTP relay).
 */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(smtpUrl: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(input: MailerSendInput): Promise<void> {
    await this.transport.sendMail({
      from: process.env['SMTP_FROM'] ?? process.env['MAIL_FROM'] ?? 'noreply@localhost',
      to: input.to,
      subject: input.subject,
      text: input.text,
      // Send a multipart alternative when an HTML body is provided (feature 047).
      ...(input.html ? { html: input.html } : {}),
      ...(input.attachments && input.attachments.length
        ? {
            attachments: input.attachments.map((a) => ({
              filename: a.filename,
              // nodemailer wants a Buffer/string; a Buffer is already one, a
              // plain Uint8Array is wrapped without copying its backing memory.
              content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
      messageId: input.messageId,
    });
  }
}

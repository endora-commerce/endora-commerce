import nodemailer from 'nodemailer';
import type { NewsletterSendMessage, NewsletterSendProvider } from '@endora-commerce/contracts';

export interface SmtpProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Decrypted secret (from Settings `secret` value type). */
  password: string;
}

/**
 * Bulk SMTP provider (feature 048, research R7). Built on the already-present
 * `nodemailer`, it reaches Amazon SES (SMTP interface), Mailgun, Postmark, or
 * any relay. This transport is OWNED by the newsletter module and is
 * independent of the transactional `email` module's mailer. Throughput
 * throttling is applied by the BullMQ send-worker limiter, not here.
 */
export class SmtpProvider implements NewsletterSendProvider {
  private readonly transport: nodemailer.Transporter;

  constructor(config: SmtpProviderConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.username ? { user: config.username, pass: config.password } : undefined,
    });
  }

  async send(msg: NewsletterSendMessage): Promise<{ providerMessageId?: string }> {
    const from = msg.fromName ? `"${msg.fromName}" <${msg.fromEmail}>` : msg.fromEmail;
    const info = await this.transport.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      messageId: msg.messageId,
      headers: msg.headers,
    });
    return { providerMessageId: info.messageId ?? msg.messageId };
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.transport.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

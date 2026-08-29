import type { NewsletterSendMessage, NewsletterSendProvider } from '@endora-commerce/contracts';

/**
 * Default newsletter provider for dev/tests (feature 048). Logs the message and
 * is idempotent on `messageId`, mirroring the transactional ConsoleMailer. Real
 * bulk delivery uses the SmtpProvider configured from Settings.
 */
export class ConsoleNewsletterProvider implements NewsletterSendProvider {
  private readonly seen = new Set<string>();

  async send(msg: NewsletterSendMessage): Promise<{ providerMessageId?: string }> {
    if (this.seen.has(msg.messageId)) return { providerMessageId: msg.messageId };
    this.seen.add(msg.messageId);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ msg: 'console-newsletter', to: msg.to, subject: msg.subject }),
    );
    return { providerMessageId: msg.messageId };
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: true };
  }
}

/** In-memory provider for tests — captures every dispatched message. */
export class InMemoryNewsletterProvider implements NewsletterSendProvider {
  readonly sent: NewsletterSendMessage[] = [];

  async send(msg: NewsletterSendMessage): Promise<{ providerMessageId?: string }> {
    this.sent.push(msg);
    return { providerMessageId: msg.messageId };
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: true };
  }
}

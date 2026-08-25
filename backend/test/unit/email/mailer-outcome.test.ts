import { describe, expect, it } from 'vitest';
import { ConsoleMailer, InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * D-59 — `Mailer.send` answers an outcome instead of `void`.
 *
 * The transport was the one layer in the send path that reported nothing at
 * all: `TransactionalSendOutcome` and `OrderEmailResult` already distinguish a
 * delivered message from a suppressed one, and both were computed *above* a
 * call whose own answer was `Promise<void>`. So "the message left the building"
 * and "the transport deliberately dropped it" were the same value.
 *
 * A transport *failure* still throws — unchanged, so every caller's existing
 * tolerance keeps its meaning. The outcome enumerates the ways a message can
 * fail to go out **without** an error.
 */
describe('email — the transport reports what it did with a message (D-59)', () => {
  const message = {
    messageId: 'invoice_issued:abc',
    to: 'buyer@example.com',
    subject: 'Invoice FV 1/2026',
    text: 'Your invoice',
  };

  it('reports a delivered message as sent', async () => {
    await expect(new InMemoryMailer().send(message)).resolves.toEqual({ status: 'sent' });
  });

  it('reports the dedupe on a repeated message id as suppressed, not as sent', async () => {
    const mailer = new ConsoleMailer();
    await expect(mailer.send(message)).resolves.toEqual({ status: 'sent' });
    await expect(mailer.send(message)).resolves.toEqual({
      status: 'suppressed',
      reason: 'duplicate_message_id',
    });
  });
});

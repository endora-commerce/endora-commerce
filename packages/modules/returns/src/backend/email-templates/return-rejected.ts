import type { EmailMailerSendInput } from '@endora-commerce/contracts';

/**
 * Feature 046 (US2) — email to the customer when their return/complaint case is
 * rejected, including the reason.
 */
export function buildReturnRejectedEmail(params: {
  to: string;
  reason: string;
  returnCaseId: string;
}): EmailMailerSendInput {
  return {
    messageId: `return_rejected:${params.returnCaseId}`,
    to: params.to,
    subject: 'Your return request was declined',
    text: [
      'We have reviewed your return request and are unable to accept it.',
      params.reason ? `Reason: ${params.reason}` : '',
      'If you have questions, you can reply on the case from your account under Returns.',
    ]
      .filter(Boolean)
      .join('\n'),
    meta: { returnCaseId: params.returnCaseId, kind: 'return_rejected' },
  };
}

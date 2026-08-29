import type { EmailMailerSendInput } from '@endora-commerce/contracts';

/**
 * Feature 046 (US2) — email to the customer when their return/complaint case is
 * authorized: the RMA number plus return instructions.
 */
export function buildReturnAuthorizedEmail(params: {
  to: string;
  rmaNumber: string;
  returnCaseId: string;
}): EmailMailerSendInput {
  return {
    messageId: `return_authorized:${params.returnCaseId}`,
    to: params.to,
    subject: `Your return was approved — RMA ${params.rmaNumber}`,
    text: [
      `Your return request has been approved. Your RMA number is ${params.rmaNumber}.`,
      'Please write this RMA number on the package or the return label before sending the goods back.',
      'You can track the case from your account under Returns.',
    ].join('\n'),
    meta: { returnCaseId: params.returnCaseId, kind: 'return_authorized' },
  };
}

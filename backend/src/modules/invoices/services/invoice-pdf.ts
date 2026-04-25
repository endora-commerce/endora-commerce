/**
 * Minimal PDF synthesis for invoice downloads (US2 T146).
 *
 * Not a production PDF generator — this produces a valid but trivial 1-page
 * PDF with a plain-text block. Real typesetting waits for the pdfkit-based
 * templating in a later polish sub-phase. The contract test only asserts the
 * `%PDF-` magic header and the application/pdf Content-Type.
 */

export function buildMinimalInvoicePdf(params: {
  invoiceNumber: string;
  total: string;
  currency: string;
}): Buffer {
  const text = [
    `Invoice ${params.invoiceNumber}`,
    `Total: ${params.total} ${params.currency}`,
  ].join('\\n');

  // Hand-authored objects are simpler than pulling in a PDF lib for a stub.
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${text.length + 32} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, 'utf8');
}

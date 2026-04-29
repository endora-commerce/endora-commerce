/**
 * Nodemailer connection URL: `SMTP_URL` if set, else `SMTP_HOST` + `SMTP_PORT`
 * when not using the console driver (see `backend/.env.example` for Mailhog).
 */
export function resolveSmtpUrlFromEnv(): string | null {
  const explicit = process.env['SMTP_URL']?.trim();
  if (explicit) return explicit;

  if (process.env['MAIL_DRIVER'] === 'console') {
    return null;
  }

  const host = process.env['SMTP_HOST']?.trim();
  const port = process.env['SMTP_PORT']?.trim();
  if (host && port) {
    const user = process.env['SMTP_USER']?.trim() ?? '';
    const pass = process.env['SMTP_PASSWORD']?.trim() ?? '';
    if (user) {
      return `smtp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }
    return `smtp://${host}:${port}`;
  }

  return null;
}

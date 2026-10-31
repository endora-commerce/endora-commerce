'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { trackContactFormSubmitted } from '../../lib/analytics/ecommerce';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Storefront contact form (feature 049). On submit it fires the
 * `contact_form_submitted` custom-event trigger with every text field — never
 * the file attachment (FR-018) — then shows a confirmation. There is no contact
 * backend yet, so submission is client-side only; wiring a server action to
 * actually deliver the message is a one-line addition here.
 *
 * `locale` is the page language, handed down by the server page that renders
 * the form (issue #85) — a client component does not read it on its own.
 */
export function ContactForm({ locale }: { locale: string }): ReactNode {
  const t = tForLocale(locale);
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    subject: '',
    message: '',
  });

  const set = (key: keyof typeof values) => (e: { target: { value: string } }): void =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    // Text fields only — the attachment is deliberately excluded.
    trackContactFormSubmitted({
      name: values.name,
      email: values.email,
      phone: values.phone,
      company: values.company,
      subject: values.subject,
      message: values.message,
    });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-line bg-surface p-6" role="status">
        <h2 className="text-[18px] font-semibold">{t('content.contact.form.sentHeading')}</h2>
        <p className="mt-2 text-[14px] text-muted">{t('content.contact.form.sentBody')}</p>
      </div>
    );
  }

  const input = 'w-full rounded-sm border border-line px-[10px] py-[8px] text-[14px]';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13px]">
          {t('cms.contactForm.field.name')} *
          <input className={input} name="name" required value={values.name} onChange={set('name')} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          {t('cms.contactForm.field.email')} *
          <input
            className={input}
            type="email"
            name="email"
            required
            value={values.email}
            onChange={set('email')}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          {t('cms.contactForm.field.phone')}
          <input className={input} name="phone" value={values.phone} onChange={set('phone')} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          {t('cms.contactForm.field.company')}
          <input className={input} name="company" value={values.company} onChange={set('company')} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[13px]">
        {t('cms.contactForm.field.subject')}
        <input className={input} name="subject" value={values.subject} onChange={set('subject')} />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        {t('cms.contactForm.field.message')} *
        <textarea
          className={`${input} min-h-[140px]`}
          name="message"
          required
          value={values.message}
          onChange={set('message')}
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        {t('content.contact.form.attachment')}
        {/* The file is never captured into the analytics payload (FR-018). */}
        <input className="text-[13px]" type="file" name="attachment" />
      </label>
      <div>
        <button type="submit" className="btn btn--primary btn--lg">
          {t('content.contact.form.submit')}
        </button>
      </div>
    </form>
  );
}

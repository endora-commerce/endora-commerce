import { defineMessages } from './define';

/**
 * The `content` namespace (issue #85): the blog, the contact page, the
 * newsletter components and other CMS-shaped content.
 *
 * Keys are `content.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`content.blog.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const content = defineMessages({
  'en-US': {
    /** The `<title>` of a blog or CMS address that does not resolve (the page answers 404). */
    'content.notFound.title': 'Not found',

    // Blog (`app/blog/`).
    'content.blog.title': 'Blog',
    /** `{category}` is the category's name, used when it has no meta title of its own. */
    'content.blog.categoryTitle': '{category} — Blog',
    /** `{tag}` is the tag's name. */
    'content.blog.tagTitle': '#{tag} — Blog',
    'content.blog.latestPosts': 'Latest posts',
    'content.blog.noPosts': 'No posts yet — check back soon.',
    'content.blog.categories': 'Categories',
    'content.blog.category.empty': 'No posts in this category yet.',
    'content.blog.tag.empty': 'No posts carry this tag yet.',
    'content.blog.subcategories': 'Subcategories',
    'content.blog.relatedPosts': 'Related posts',
    'content.blog.pagination.label': 'Pagination',
    'content.blog.pagination.previous': 'Previous',
    'content.blog.pagination.next': 'Next',

    // Contact page (`app/kontakt/`) and its form.
    'content.contact.title': 'Contact',
    'content.contact.metaDescription': 'Get in touch with us — contact form.',
    'content.contact.intro': 'Have a question? Fill in the form and we will get back to you as soon as we can.',
    'content.contact.details.email': 'Email',
    'content.contact.details.phone': 'Phone',
    'content.contact.form.attachment': 'Attachment (optional)',
    'content.contact.form.submit': 'Send message',
    'content.contact.form.sentHeading': 'Thank you for your message',
    'content.contact.form.sentBody': 'We will get back to you as soon as we can.',

    // Newsletter (`app/newsletter/*`, `components/newsletter/`).
    'content.newsletter.heading': 'Newsletter',
    'content.newsletter.confirm.ok': 'Your subscription is confirmed. Thank you!',
    'content.newsletter.confirm.invalid': 'This confirmation link is invalid or has expired.',
    'content.newsletter.subscribed.active': 'You are subscribed. Thank you!',
    'content.newsletter.subscribed.error': 'We could not complete your subscription. Please try again.',
    'content.newsletter.subscribed.pending': 'Almost there — please check your inbox and confirm your subscription.',
    'content.newsletter.unsubscribe.heading': 'Unsubscribe',
    'content.newsletter.unsubscribe.intro':
      'Confirm you want to stop receiving our newsletter. You may optionally tell us why.',
    'content.newsletter.unsubscribe.reasonPlaceholder': 'Reason (optional)',
    'content.newsletter.unsubscribe.submit': 'Unsubscribe',
    'content.newsletter.unsubscribe.done': 'You have been unsubscribed. We are sorry to see you go.',
    'content.newsletter.unsubscribe.invalid': 'This unsubscribe link is invalid or has expired.',
    'content.newsletter.signup.title': 'Subscribe to our newsletter',
    'content.newsletter.signup.emailLabel': 'Email',
    'content.newsletter.signup.emailPlaceholder': 'you@example.com',
    'content.newsletter.signup.submit': 'Subscribe',
    /**
     * The registration form's built-in consent, shown when the
     * `newsletter_consent` CMS block does not resolve. `{link}` is replaced by a
     * link whose text is `content.newsletter.consent.privacyPolicy`.
     */
    'content.newsletter.consent.text':
      'Yes, I would like to receive the newsletter and marketing emails. See our {link}.',
    /** The link text inside `content.newsletter.consent.text` — inflected to fit that sentence. */
    'content.newsletter.consent.privacyPolicy': 'Privacy Policy',
  },
  'pl-PL': {
    'content.notFound.title': 'Nie znaleziono',

    'content.blog.title': 'Blog',
    'content.blog.categoryTitle': '{category} — Blog',
    'content.blog.tagTitle': '#{tag} — Blog',
    'content.blog.latestPosts': 'Najnowsze wpisy',
    'content.blog.noPosts': 'Nie ma jeszcze wpisów — zajrzyj tu wkrótce.',
    'content.blog.categories': 'Kategorie',
    'content.blog.category.empty': 'W tej kategorii nie ma jeszcze wpisów.',
    'content.blog.tag.empty': 'Żaden wpis nie ma jeszcze tego tagu.',
    'content.blog.subcategories': 'Podkategorie',
    'content.blog.relatedPosts': 'Powiązane wpisy',
    'content.blog.pagination.label': 'Paginacja',
    'content.blog.pagination.previous': 'Poprzednia',
    'content.blog.pagination.next': 'Następna',

    'content.contact.title': 'Kontakt',
    'content.contact.metaDescription': 'Skontaktuj się z nami — formularz kontaktowy.',
    'content.contact.intro': 'Masz pytanie? Wypełnij formularz — odpowiemy najszybciej, jak to możliwe.',
    'content.contact.details.email': 'E-mail',
    'content.contact.details.phone': 'Tel.',
    'content.contact.form.attachment': 'Załącznik (opcjonalnie)',
    'content.contact.form.submit': 'Wyślij wiadomość',
    'content.contact.form.sentHeading': 'Dziękujemy za wiadomość',
    'content.contact.form.sentBody': 'Odpowiemy najszybciej, jak to możliwe.',

    'content.newsletter.heading': 'Newsletter',
    'content.newsletter.confirm.ok': 'Twoja subskrypcja została potwierdzona. Dziękujemy!',
    'content.newsletter.confirm.invalid': 'Ten link potwierdzający jest nieprawidłowy lub wygasł.',
    'content.newsletter.subscribed.active': 'Zapisano Cię do newslettera. Dziękujemy!',
    'content.newsletter.subscribed.error': 'Nie udało się dokończyć zapisu. Spróbuj ponownie.',
    'content.newsletter.subscribed.pending': 'Jeszcze jeden krok — sprawdź skrzynkę odbiorczą i potwierdź subskrypcję.',
    'content.newsletter.unsubscribe.heading': 'Rezygnacja z newslettera',
    'content.newsletter.unsubscribe.intro':
      'Potwierdź, że nie chcesz już otrzymywać naszego newslettera. Jeśli chcesz, napisz nam, dlaczego.',
    'content.newsletter.unsubscribe.reasonPlaceholder': 'Powód (opcjonalnie)',
    'content.newsletter.unsubscribe.submit': 'Wypisz się',
    'content.newsletter.unsubscribe.done': 'Wypisano Cię z newslettera. Szkoda, że nas opuszczasz.',
    'content.newsletter.unsubscribe.invalid': 'Ten link do rezygnacji jest nieprawidłowy lub wygasł.',
    'content.newsletter.signup.title': 'Zapisz się do naszego newslettera',
    'content.newsletter.signup.emailLabel': 'Adres e-mail',
    'content.newsletter.signup.emailPlaceholder': 'adres@firma.pl',
    'content.newsletter.signup.submit': 'Zapisz się',
    'content.newsletter.consent.text':
      'Tak, chcę otrzymywać newsletter i e-maile marketingowe. Szczegóły znajdziesz w naszej {link}.',
    'content.newsletter.consent.privacyPolicy': 'Polityce prywatności',
  },
});

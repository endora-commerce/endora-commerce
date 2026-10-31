import { defineMessages } from './define';

/**
 * The `auth` namespace (issue #85): login, registration, verification,
 * password reset, invitations, the security pages and MFA.
 *
 * Keys are `auth.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`auth.login.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 *
 * A sentence with a link or an emphasised value inside it is keyed as
 * `…Before` / `…Link` / `…After` parts, each a whole phrase in its own
 * language, because the link sits at a different place in the Polish
 * sentence. A part that starts with a space or punctuation does so on purpose.
 */
export const auth = defineMessages({
  'en-US': {
    // Fields and prompts several of the sign-in and registration forms share.
    'auth.field.email': 'Email',
    'auth.field.password': 'Password',
    'auth.field.firstName': 'First name',
    'auth.field.lastName': 'Last name',
    'auth.field.newPasswordMin': 'Password (at least 12 characters)',
    'auth.common.haveAccountPrompt': 'Already have an account?',
    'auth.common.createAccount': 'Create account',
    'auth.common.tokenMissingBefore': 'This page expects a',
    // The sign-in page and its server action.
    'auth.login.heading': 'Sign in',
    'auth.login.intro': 'Use your work email and password.',
    'auth.login.submit': 'Sign in',
    'auth.login.forgotPrompt': 'Forgot your password?',
    'auth.login.forgotLink': 'Reset it',
    'auth.login.newPrompt': 'New here?',
    'auth.login.registerLink': 'Create an account',
    'auth.login.failed': 'Sign-in failed. Please try again.',
    'auth.login.setupStartFailed': 'Could not start two-step verification setup. Please try again.',
    // Business (Organization) registration.
    'auth.register.pending.heading': 'Almost there',
    'auth.register.pending.sentBefore': 'We sent a verification email to',
    'auth.register.pending.sentAfter': '. Click the link in that email to activate your account.',
    'auth.register.pending.verifiedPrompt': 'Already verified?',
    'auth.register.heading': 'Create your business account',
    'auth.register.intro':
      'Tell us about your organization. We use this to set up invoicing and tax handling.',
    'auth.register.organizationLegend': 'Organization',
    'auth.register.legalName': 'Legal name',
    'auth.register.taxId': 'Tax ID',
    'auth.register.street': 'Street',
    'auth.register.country': 'Country',
    'auth.register.ownerLegend': 'Account owner',
    'auth.register.failed': 'Registration failed. Please try again.',
    // Individual (org-less) registration.
    'auth.registerCustomer.heading': 'Create your account',
    'auth.registerCustomer.intro':
      'Register a personal account to browse and order. You can be linked to an organization later.',
    'auth.registerCustomer.orgRequiredBefore':
      'Registration without an organization is currently disabled.',
    'auth.registerCustomer.orgRequiredLink': 'Register your organization',
    'auth.registerCustomer.orgRequiredAfter': ' instead.',
    // Accepting an invitation to an Organization.
    'auth.invitation.heading': 'Accept invitation',
    'auth.invitation.intro': 'Set your name and password to join the organization.',
    'auth.invitation.wrongLinkBefore': 'Wrong link? Ask your admin for a new invitation or',
    'auth.invitation.wrongLinkLink': 'sign in',
    'auth.invitation.wrongLinkAfter': ' if you already have an account.',
    'auth.invitation.invalidLink': 'Invitation link is invalid.',
    'auth.invitation.signInToContinue': 'Account created. Please sign in to continue.',
    'auth.invitation.failed': 'Could not accept invitation. Try again.',
    // Password reset — request.
    'auth.passwordReset.sent.heading': 'Check your inbox',
    'auth.passwordReset.sent.before': 'If',
    'auth.passwordReset.sent.after': 'matches an account, we just emailed a reset link.',
    'auth.passwordReset.sent.expiry': 'The link expires in 24 hours.',
    'auth.passwordReset.sent.backToSignIn': 'Back to sign-in',
    'auth.passwordReset.request.heading': 'Reset your password',
    'auth.passwordReset.request.intro':
      'Enter your account email — we’ll send a reset link if it matches.',
    'auth.passwordReset.request.submit': 'Send reset link',
    'auth.passwordReset.request.rememberedPrompt': 'Remembered it?',
    // Password reset — confirm.
    'auth.passwordReset.done.heading': 'Password updated',
    'auth.passwordReset.done.body': 'You can now sign in with your new password.',
    'auth.passwordReset.done.continue': 'Continue to sign-in',
    'auth.passwordReset.missing.heading': 'Reset link missing',
    'auth.passwordReset.missing.after': 'query parameter from your reset email.',
    'auth.passwordReset.confirm.heading': 'Choose a new password',
    'auth.passwordReset.confirm.newPassword': 'New password (at least 12 characters)',
    'auth.passwordReset.confirm.submit': 'Update password',
    'auth.passwordReset.confirm.failed': 'Could not reset your password.',
    // E-mail verification landing.
    'auth.verify.missing.heading': 'Verification link missing',
    'auth.verify.missing.after': 'query parameter from your verification email.',
    'auth.verify.heading': 'Email verification',
    'auth.verify.success': 'Your email is verified.',
    'auth.verify.continue': 'Sign in to continue',
    'auth.verify.failed': 'Verification failed.',
    'auth.verify.newLinkPrompt': 'Need a new link?',
    'auth.verify.registerAgain': 'Register again',
    'auth.verify.contactSupport': ' or contact support.',
    // Two-step verification: the second step, forced setup and enrolment.
    'auth.mfa.heading': 'Two-step verification',
    'auth.mfa.intro': 'Enter the 6-digit code from your authenticator app, or a recovery code.',
    'auth.mfa.codeLabel': 'Authentication code',
    'auth.mfa.submit': 'Verify',
    'auth.mfa.verifyFailed': 'Verification failed. Please try again.',
    'auth.mfa.manualKey': 'Manual key:',
    'auth.mfa.sixDigitCode': '6-digit code',
    'auth.mfaSetup.heading': 'Set up two-step verification',
    'auth.mfaSetup.intro':
      'Your account requires two-step verification. Add this account to your authenticator app, then enter a code.',
    'auth.mfaSetup.submit': 'Confirm and continue',
    'auth.mfaSetup.failed': 'Setup failed. Please try again.',
    // The account security page.
    'auth.security.heading': 'Account security',
    'auth.security.start.heading': 'Two-step verification',
    'auth.security.start.intro': 'Add a second step to your sign-in using an authenticator app.',
    'auth.security.start.submit': 'Turn on two-step verification',
    'auth.security.confirm.heading': 'Scan and confirm',
    'auth.security.confirm.intro':
      'Scan this setup link in your authenticator app, or enter the key manually:',
    'auth.security.confirm.submit': 'Confirm and enable',
    'auth.security.active.heading': 'Two-step verification is on',
    'auth.security.active.remaining': 'Unused recovery codes remaining: {count}',
    'auth.security.active.disableLabel': 'Enter a current code to turn off two-step verification',
    'auth.security.active.disable': 'Turn off two-step verification',
    'auth.security.active.regenerateLabel': 'Enter a current code to regenerate recovery codes',
    'auth.security.active.regenerate': 'Regenerate recovery codes',
    'auth.security.recovery.heading': 'Save your recovery codes',
    'auth.security.recovery.intro':
      'Each code works once. Store them somewhere safe — they are shown only now.',
    'auth.security.failed': 'Something went wrong. Please try again.',
    // The Organization security page.
    'auth.organizationSecurity.heading': 'Organization security',
    'auth.organizationSecurity.intro':
      'Require two-step verification for everyone in your organization.',
    'auth.organizationSecurity.done': 'Enforcement updated.',
    'auth.organizationSecurity.require': 'Require two-step verification for all members',
    'auth.organizationSecurity.stop': 'Stop requiring two-step verification',
    'auth.organizationSecurity.failed': 'Could not update enforcement.',
    // The sign-out button (account sidebar; callers may pass their own label).
    'auth.signOut.button': 'Sign out',
  },
  'pl-PL': {
    'auth.field.email': 'Adres e-mail',
    'auth.field.password': 'Hasło',
    'auth.field.firstName': 'Imię',
    'auth.field.lastName': 'Nazwisko',
    'auth.field.newPasswordMin': 'Hasło (co najmniej 12 znaków)',
    'auth.common.haveAccountPrompt': 'Masz już konto?',
    'auth.common.createAccount': 'Załóż konto',
    'auth.common.tokenMissingBefore': 'Ta strona wymaga parametru',
    'auth.login.heading': 'Zaloguj się',
    'auth.login.intro': 'Użyj służbowego adresu e-mail i hasła.',
    'auth.login.submit': 'Zaloguj się',
    'auth.login.forgotPrompt': 'Nie pamiętasz hasła?',
    'auth.login.forgotLink': 'Zresetuj je',
    'auth.login.newPrompt': 'Nie masz jeszcze konta?',
    'auth.login.registerLink': 'Załóż konto',
    'auth.login.failed': 'Logowanie nie powiodło się. Spróbuj ponownie.',
    'auth.login.setupStartFailed':
      'Nie udało się rozpocząć konfiguracji weryfikacji dwuetapowej. Spróbuj ponownie.',
    'auth.register.pending.heading': 'Jeszcze tylko jeden krok',
    'auth.register.pending.sentBefore': 'Wysłaliśmy wiadomość weryfikacyjną na adres',
    'auth.register.pending.sentAfter': '. Kliknij link w tej wiadomości, aby aktywować konto.',
    'auth.register.pending.verifiedPrompt': 'Adres jest już potwierdzony?',
    'auth.register.heading': 'Załóż konto firmowe',
    'auth.register.intro':
      'Podaj dane swojej organizacji. Wykorzystamy je do wystawiania faktur i rozliczeń podatkowych.',
    'auth.register.organizationLegend': 'Organizacja',
    'auth.register.legalName': 'Pełna nazwa firmy',
    'auth.register.taxId': 'NIP',
    'auth.register.street': 'Ulica',
    'auth.register.country': 'Kraj',
    'auth.register.ownerLegend': 'Właściciel konta',
    'auth.register.failed': 'Rejestracja nie powiodła się. Spróbuj ponownie.',
    'auth.registerCustomer.heading': 'Załóż konto',
    'auth.registerCustomer.intro':
      'Zarejestruj konto osobiste, aby przeglądać ofertę i składać zamówienia. Konto można później powiązać z organizacją.',
    'auth.registerCustomer.orgRequiredBefore':
      'Rejestracja bez organizacji jest obecnie wyłączona. Zamiast tego',
    'auth.registerCustomer.orgRequiredLink': 'zarejestruj swoją organizację',
    'auth.registerCustomer.orgRequiredAfter': '.',
    'auth.invitation.heading': 'Przyjmij zaproszenie',
    'auth.invitation.intro': 'Podaj imię, nazwisko i hasło, aby dołączyć do organizacji.',
    'auth.invitation.wrongLinkBefore':
      'Nieprawidłowy link? Poproś administratora o nowe zaproszenie lub',
    'auth.invitation.wrongLinkLink': 'zaloguj się',
    'auth.invitation.wrongLinkAfter': ', jeśli masz już konto.',
    'auth.invitation.invalidLink': 'Link z zaproszeniem jest nieprawidłowy.',
    'auth.invitation.signInToContinue': 'Konto zostało utworzone. Zaloguj się, aby kontynuować.',
    'auth.invitation.failed': 'Nie udało się przyjąć zaproszenia. Spróbuj ponownie.',
    'auth.passwordReset.sent.heading': 'Sprawdź skrzynkę odbiorczą',
    'auth.passwordReset.sent.before': 'Jeśli adres',
    'auth.passwordReset.sent.after':
      'należy do konta, właśnie wysłaliśmy na niego link do zresetowania hasła.',
    'auth.passwordReset.sent.expiry': 'Link wygasa po 24 godzinach.',
    'auth.passwordReset.sent.backToSignIn': 'Wróć do logowania',
    'auth.passwordReset.request.heading': 'Zresetuj hasło',
    'auth.passwordReset.request.intro':
      'Podaj adres e-mail swojego konta — jeśli go znajdziemy, wyślemy link do zresetowania hasła.',
    'auth.passwordReset.request.submit': 'Wyślij link',
    'auth.passwordReset.request.rememberedPrompt': 'Pamiętasz hasło?',
    'auth.passwordReset.done.heading': 'Hasło zostało zmienione',
    'auth.passwordReset.done.body': 'Możesz teraz zalogować się nowym hasłem.',
    'auth.passwordReset.done.continue': 'Przejdź do logowania',
    'auth.passwordReset.missing.heading': 'Brak linku do resetowania hasła',
    'auth.passwordReset.missing.after': 'z linku w wiadomości o resetowaniu hasła.',
    'auth.passwordReset.confirm.heading': 'Ustaw nowe hasło',
    'auth.passwordReset.confirm.newPassword': 'Nowe hasło (co najmniej 12 znaków)',
    'auth.passwordReset.confirm.submit': 'Zmień hasło',
    'auth.passwordReset.confirm.failed': 'Nie udało się zresetować hasła.',
    'auth.verify.missing.heading': 'Brak linku weryfikacyjnego',
    'auth.verify.missing.after': 'z linku w wiadomości weryfikacyjnej.',
    'auth.verify.heading': 'Weryfikacja adresu e-mail',
    'auth.verify.success': 'Twój adres e-mail został zweryfikowany.',
    'auth.verify.continue': 'Zaloguj się, aby kontynuować',
    'auth.verify.failed': 'Weryfikacja nie powiodła się.',
    'auth.verify.newLinkPrompt': 'Potrzebujesz nowego linku?',
    'auth.verify.registerAgain': 'Zarejestruj się ponownie',
    'auth.verify.contactSupport': ' lub skontaktuj się z obsługą klienta.',
    'auth.mfa.heading': 'Weryfikacja dwuetapowa',
    'auth.mfa.intro': 'Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej lub kod odzyskiwania.',
    'auth.mfa.codeLabel': 'Kod uwierzytelniający',
    'auth.mfa.submit': 'Zweryfikuj',
    'auth.mfa.verifyFailed': 'Weryfikacja nie powiodła się. Spróbuj ponownie.',
    'auth.mfa.manualKey': 'Klucz do wpisania ręcznie:',
    'auth.mfa.sixDigitCode': 'Kod 6-cyfrowy',
    'auth.mfaSetup.heading': 'Skonfiguruj weryfikację dwuetapową',
    'auth.mfaSetup.intro':
      'Twoje konto wymaga weryfikacji dwuetapowej. Dodaj to konto do aplikacji uwierzytelniającej, a następnie wpisz kod.',
    'auth.mfaSetup.submit': 'Potwierdź i kontynuuj',
    'auth.mfaSetup.failed': 'Konfiguracja nie powiodła się. Spróbuj ponownie.',
    'auth.security.heading': 'Bezpieczeństwo konta',
    'auth.security.start.heading': 'Weryfikacja dwuetapowa',
    'auth.security.start.intro':
      'Dodaj drugi krok logowania za pomocą aplikacji uwierzytelniającej.',
    'auth.security.start.submit': 'Włącz weryfikację dwuetapową',
    'auth.security.confirm.heading': 'Zeskanuj i potwierdź',
    'auth.security.confirm.intro':
      'Zeskanuj ten link konfiguracyjny w aplikacji uwierzytelniającej lub wpisz klucz ręcznie:',
    'auth.security.confirm.submit': 'Potwierdź i włącz',
    'auth.security.active.heading': 'Weryfikacja dwuetapowa jest włączona',
    'auth.security.active.remaining': 'Pozostałe niewykorzystane kody odzyskiwania: {count}',
    'auth.security.active.disableLabel': 'Wpisz aktualny kod, aby wyłączyć weryfikację dwuetapową',
    'auth.security.active.disable': 'Wyłącz weryfikację dwuetapową',
    'auth.security.active.regenerateLabel':
      'Wpisz aktualny kod, aby wygenerować nowe kody odzyskiwania',
    'auth.security.active.regenerate': 'Wygeneruj nowe kody odzyskiwania',
    'auth.security.recovery.heading': 'Zapisz kody odzyskiwania',
    'auth.security.recovery.intro':
      'Każdy kod działa tylko raz. Przechowuj je w bezpiecznym miejscu — są wyświetlane tylko teraz.',
    'auth.security.failed': 'Coś poszło nie tak. Spróbuj ponownie.',
    'auth.organizationSecurity.heading': 'Bezpieczeństwo organizacji',
    'auth.organizationSecurity.intro':
      'Wymagaj weryfikacji dwuetapowej od wszystkich członków organizacji.',
    'auth.organizationSecurity.done': 'Wymóg został zaktualizowany.',
    'auth.organizationSecurity.require': 'Wymagaj weryfikacji dwuetapowej od wszystkich członków',
    'auth.organizationSecurity.stop': 'Wyłącz wymóg weryfikacji dwuetapowej',
    'auth.organizationSecurity.failed': 'Nie udało się zaktualizować wymogu.',
    'auth.signOut.button': 'Wyloguj się',
  },
});

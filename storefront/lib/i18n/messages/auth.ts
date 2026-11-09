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
    // Feature 173 — the company registry lookup on the registration form.
    'auth.register.lookup.button': 'Fetch company data',
    'auth.register.lookup.hint':
      'Enter your NIP or EU VAT number and choose the country, and we will fill in your company details from the public registry. You can change them before you create the account.',
    'auth.register.lookup.loading': 'Fetching company data…',
    'auth.register.lookup.found':
      'Company details filled in from {source}. Check them and correct anything out of date.',
    'auth.register.lookup.source.gus': 'the GUS REGON registry',
    'auth.register.lookup.source.mf': 'the Ministry of Finance VAT White List',
    'auth.register.lookup.source.vies': 'the EU VIES system',
    'auth.register.lookup.vat.active': 'VAT status: active VAT payer.',
    'auth.register.lookup.vat.exempt':
      'VAT status: exempt from VAT. You can still register; our team will review your application.',
    'auth.register.lookup.vat.notRegistered':
      'The registry reports this company is not registered for VAT. You can still register; our team will review your application.',
    'auth.register.lookup.vat.unknown': 'VAT status not checked.',
    'auth.register.lookup.ceased': 'The registry reports that this company has ceased its activity.',
    'auth.register.lookup.noDetails':
      'This VAT number is valid, but the registry does not share company details for this country. Enter them below.',
    'auth.register.lookup.notFound':
      'We could not find this tax ID in the registry. Check the number or enter your company details below.',
    'auth.register.lookup.unavailable': 'The registry is not responding right now. Enter your company details below.',
    'auth.register.lookup.invalidTaxId': 'This tax ID does not look valid. Check the number.',
    'auth.register.lookup.unsupportedCountry':
      'Automatic lookup is not available for this country. Enter your company details below.',
    'auth.register.lookup.rateLimited':
      'Too many lookups in a short time. Wait a few minutes or enter your company details below.',
    'auth.register.lookup.filledMark': 'Filled from the registry',
    // Feature 175 — the custom fields an administrator opened on registration.
    'auth.register.customFields.organizationLegend': 'More about your company',
    'auth.register.customFields.customerLegend': 'More about you',
    'auth.register.customFields.required': '(required)',
    'auth.register.customFields.choose': 'Choose…',
    // The backend words each refusal (module-i18n case 1); this is only for one
    // that arrived without a sentence.
    'auth.register.customFields.error.invalid': 'Check this field.',
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
    'auth.organizationSecurity.forbidden': 'Only the organization’s administrators can change this setting.',
    // The sign-out button (account sidebar; callers may pass their own label).
    'auth.signOut.button': 'Sign out',
    // ── issue #745: the two-step verification codes the sign-in and security pages
    // carry in `?error=` (`lib/auth/mfa-errors.ts`).
    'auth.mfa.error.MFA_INVALID_CODE':
      'That code was not accepted. A code from your authenticator app is only valid for about half a minute, so wait for the next one and enter it without spaces; a recovery code can be used only once.',
    'auth.mfa.error.MFA_INVALID_CHALLENGE':
      'This sign-in step is no longer valid — it has expired, or it was already finished. Sign in again to start a new one.',
    'auth.mfa.error.MFA_TOO_MANY_ATTEMPTS':
      'Too many incorrect codes were entered, so this sign-in attempt was stopped. Sign in again and use the next code straight from your authenticator app, or one of your recovery codes.',
    'auth.mfa.error.MFA_WRONG_SURFACE':
      'This sign-in was started somewhere else, so the code cannot be confirmed here. Go back to the page you were signing in on and enter it there.',
    'auth.mfa.error.MFA_ALREADY_ENROLLED':
      'Two-step verification is already set up on this account, so there is nothing left to configure. To move it to a different authenticator app, switch it off first and then set it up again.',
    'auth.mfa.error.MFA_NO_PENDING_ENROLMENT':
      'There is no setup waiting to be confirmed — it was either finished already, or started again somewhere else. Begin the setup again and scan the new QR code before entering a code.',
    'auth.mfa.error.MFA_NO_ACTIVE_ENROLMENT':
      'Two-step verification is not switched on for this account, so there are no recovery codes to reissue. Set it up first — the codes are handed to you at the end of setup.',
    'auth.mfa.error.MFA_NOT_ENABLED':
      'Two-step verification is not available here, so it cannot be switched on for this account. Your administrator decides where it can be used — ask them to enable it.',
    'auth.mfa.error.MFA_REAUTH_REQUIRED':
      'Switching two-step verification off has to be confirmed by you. Enter a current code from your authenticator app, or the password for this account.',
    'auth.mfa.error.MFA_SOCIAL_LAST_CREDENTIAL':
      'This is the last sign-in identity linked to the account, and the account has no password on record — removing it could lock its holder out for good. Set a password for the account first, then this link can be removed.',
    // ── issue #745: what the sign-in, registration and password-reset pages'
    // `?error=` codes say (`lib/auth/sign-in-errors.ts`, `lib/auth/auth-errors.ts`).
    'auth.error.INVALID_CREDENTIALS': 'Invalid email or password. Please try again.',
    'auth.error.ACCOUNT_BLOCKED': 'This account has been blocked. Please contact support.',
    'auth.error.CUSTOMER_AUTHENTICATION_THROTTLED':
      'Too many attempts were made for this account, so further attempts are paused for a few minutes. Wait a moment and try again.',
    'auth.error.CUSTOMER_AUTHENTICATION_UNAVAILABLE': 'Signing in is temporarily unavailable. Please try again in a moment.',
    'auth.error.EMAIL_ALREADY_REGISTERED': 'An account with this email address already exists.',
    'auth.error.TOKEN_INVALID_OR_EXPIRED': 'This link is invalid or has expired.',
    'auth.error.VALIDATION_FAILED': 'Check the details you entered. The password needs at least 12 characters.',
    'auth.federated.error.unknownProvider': 'This sign-in provider is not known.',
    'auth.federated.error.providerUnavailable': 'Sign-in with this provider is not available.',
    'auth.federated.error.cancelled': 'Sign-in was cancelled or failed.',
    'auth.federated.error.expired': 'This sign-in attempt has expired.',
    'auth.federated.error.emailUnverified': 'Your provider email is not verified.',
    'auth.federated.error.noMatchingAccount': 'No account matches this provider. Please contact an administrator.',
    'auth.federated.error.registrationDisabledInChannel':
      'This store does not offer personal accounts, so no account was created. Sign in with an existing account, or register your organization.',
    'auth.federated.error.setupRequired':
      'Two-step verification is required for your account. Sign in with your email and password to set it up.',
    'auth.passwordReset.request.failed': 'Could not send the reset link. Please try again.',
    'auth.register.pending.sent':
      'We sent a verification email to the address you entered. Click the link in that email to activate your account.',
    'auth.passwordReset.sent.body': 'If the address you entered matches an account, we just emailed a reset link.',
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
    'auth.register.lookup.button': 'Pobierz dane firmy',
    'auth.register.lookup.hint':
      'Wpisz NIP lub unijny numer VAT i wybierz kraj, a uzupełnimy dane firmy z publicznego rejestru. Przed założeniem konta możesz je zmienić.',
    'auth.register.lookup.loading': 'Pobieramy dane firmy…',
    'auth.register.lookup.found': 'Dane firmy uzupełnione z {source}. Sprawdź je i popraw, jeśli są nieaktualne.',
    'auth.register.lookup.source.gus': 'rejestru REGON (GUS)',
    'auth.register.lookup.source.mf': 'Białej listy podatników VAT',
    'auth.register.lookup.source.vies': 'systemu VIES',
    'auth.register.lookup.vat.active': 'Status VAT: czynny podatnik VAT.',
    'auth.register.lookup.vat.exempt':
      'Status VAT: zwolniony z VAT. Mimo to możesz się zarejestrować — nasz zespół zweryfikuje zgłoszenie.',
    'auth.register.lookup.vat.notRegistered':
      'Według rejestru firma nie jest zarejestrowana jako podatnik VAT. Mimo to możesz się zarejestrować — nasz zespół zweryfikuje zgłoszenie.',
    'auth.register.lookup.vat.unknown': 'Status VAT nie został sprawdzony.',
    'auth.register.lookup.ceased': 'Według rejestru firma zakończyła działalność.',
    'auth.register.lookup.noDetails':
      'Ten numer VAT jest prawidłowy, ale rejestr nie udostępnia danych firm z tego kraju. Wpisz je poniżej.',
    'auth.register.lookup.notFound':
      'Nie znaleźliśmy tego numeru w rejestrze. Sprawdź numer albo wpisz dane firmy poniżej.',
    'auth.register.lookup.unavailable': 'Rejestr w tej chwili nie odpowiada. Wpisz dane firmy poniżej.',
    'auth.register.lookup.invalidTaxId': 'Ten numer wygląda na nieprawidłowy. Sprawdź go.',
    'auth.register.lookup.unsupportedCountry':
      'Automatyczne pobieranie danych nie jest dostępne dla tego kraju. Wpisz dane firmy poniżej.',
    'auth.register.lookup.rateLimited':
      'Zbyt wiele zapytań w krótkim czasie. Odczekaj kilka minut albo wpisz dane firmy poniżej.',
    'auth.register.lookup.filledMark': 'Uzupełniono z rejestru',
    'auth.register.customFields.organizationLegend': 'Więcej o firmie',
    'auth.register.customFields.customerLegend': 'Więcej o Tobie',
    'auth.register.customFields.required': '(wymagane)',
    'auth.register.customFields.choose': 'Wybierz…',
    'auth.register.customFields.error.invalid': 'Sprawdź to pole.',
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
    'auth.organizationSecurity.forbidden': 'To ustawienie mogą zmieniać tylko administratorzy organizacji.',
    'auth.signOut.button': 'Wyloguj się',
    // ── issue #745
    'auth.mfa.error.MFA_INVALID_CODE':
      'Ten kod nie został przyjęty. Kod z aplikacji uwierzytelniającej jest ważny tylko przez około pół minuty, więc poczekaj na kolejny i wpisz go bez spacji; kodu odzyskiwania można użyć tylko raz.',
    'auth.mfa.error.MFA_INVALID_CHALLENGE':
      'Ten krok logowania nie jest już ważny — wygasł albo został już zakończony. Zaloguj się ponownie, aby rozpocząć nowy.',
    'auth.mfa.error.MFA_TOO_MANY_ATTEMPTS':
      'Wpisano zbyt wiele błędnych kodów, więc ta próba logowania została przerwana. Zaloguj się ponownie i użyj kolejnego kodu prosto z aplikacji uwierzytelniającej albo jednego z kodów odzyskiwania.',
    'auth.mfa.error.MFA_WRONG_SURFACE':
      'To logowanie zostało rozpoczęte w innym miejscu, więc tego kodu nie można tu potwierdzić. Wróć na stronę, na której rozpoczęło się logowanie, i wpisz kod tam.',
    'auth.mfa.error.MFA_ALREADY_ENROLLED':
      'Weryfikacja dwuetapowa jest już skonfigurowana na tym koncie i nie ma nic więcej do ustawienia. Aby przenieść ją do innej aplikacji uwierzytelniającej, najpierw ją wyłącz, a potem skonfiguruj od nowa.',
    'auth.mfa.error.MFA_NO_PENDING_ENROLMENT':
      'Nie ma konfiguracji czekającej na potwierdzenie — została już zakończona albo rozpoczęta na nowo w innym miejscu. Rozpocznij konfigurację jeszcze raz i zeskanuj nowy kod QR, zanim wpiszesz kod.',
    'auth.mfa.error.MFA_NO_ACTIVE_ENROLMENT':
      'Weryfikacja dwuetapowa nie jest włączona na tym koncie, więc nie ma kodów odzyskiwania do wygenerowania na nowo. Najpierw ją skonfiguruj — kody otrzymasz na końcu konfiguracji.',
    'auth.mfa.error.MFA_NOT_ENABLED':
      'Weryfikacja dwuetapowa nie jest tu dostępna, więc nie można jej włączyć na tym koncie. O tym, gdzie można z niej korzystać, decyduje administrator — poproś go o włączenie tej opcji.',
    'auth.mfa.error.MFA_REAUTH_REQUIRED':
      'Wyłączenie weryfikacji dwuetapowej musi zostać przez Ciebie potwierdzone. Podaj aktualny kod z aplikacji uwierzytelniającej albo hasło do tego konta.',
    'auth.mfa.error.MFA_SOCIAL_LAST_CREDENTIAL':
      'To ostatnia tożsamość logowania powiązana z kontem, a konto nie ma zapisanego hasła — usunięcie jej mogłoby trwale odciąć dostęp do konta. Najpierw ustaw hasło do konta, a potem to powiązanie będzie można usunąć.',
    // ── issue #745
    'auth.error.INVALID_CREDENTIALS': 'Nieprawidłowy e-mail lub hasło. Spróbuj ponownie.',
    'auth.error.ACCOUNT_BLOCKED': 'To konto zostało zablokowane. Skontaktuj się z obsługą.',
    'auth.error.CUSTOMER_AUTHENTICATION_THROTTLED':
      'Dla tego konta podjęto zbyt wiele prób, dlatego kolejne są wstrzymane na kilka minut. Odczekaj chwilę i spróbuj ponownie.',
    'auth.error.CUSTOMER_AUTHENTICATION_UNAVAILABLE': 'Logowanie jest chwilowo niedostępne. Spróbuj ponownie za chwilę.',
    'auth.error.EMAIL_ALREADY_REGISTERED': 'Konto z tym adresem e-mail już istnieje.',
    'auth.error.TOKEN_INVALID_OR_EXPIRED': 'Ten link jest nieprawidłowy lub wygasł.',
    'auth.error.VALIDATION_FAILED': 'Sprawdź wpisane dane. Hasło musi mieć co najmniej 12 znaków.',
    'auth.federated.error.unknownProvider': 'Ten dostawca logowania jest nieznany.',
    'auth.federated.error.providerUnavailable': 'Logowanie przez tego dostawcę jest niedostępne.',
    'auth.federated.error.cancelled': 'Logowanie zostało anulowane albo się nie powiodło.',
    'auth.federated.error.expired': 'Ta próba logowania wygasła.',
    'auth.federated.error.emailUnverified': 'Adres e-mail u dostawcy nie jest potwierdzony.',
    'auth.federated.error.noMatchingAccount': 'Żadne konto nie odpowiada temu dostawcy. Skontaktuj się z administratorem.',
    'auth.federated.error.registrationDisabledInChannel':
      'Ten sklep nie oferuje kont osobistych, więc konto nie zostało utworzone. Zaloguj się na istniejące konto albo zarejestruj swoją organizację.',
    'auth.federated.error.setupRequired':
      'Twoje konto wymaga weryfikacji dwuetapowej. Zaloguj się e-mailem i hasłem, aby ją skonfigurować.',
    'auth.passwordReset.request.failed': 'Nie udało się wysłać linku do zresetowania hasła. Spróbuj ponownie.',
    'auth.register.pending.sent':
      'Wysłaliśmy wiadomość weryfikacyjną na podany adres. Kliknij link w tej wiadomości, aby aktywować konto.',
    'auth.passwordReset.sent.body': 'Jeśli podany adres należy do konta, właśnie wysłaliśmy na niego link do zresetowania hasła.',
  },
});

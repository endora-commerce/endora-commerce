---
'@endora-commerce/mod-organizations': minor
---

Business registration (`POST /api/v1/organizations/register`) and invitation accept (`POST /api/v1/organizations/invitations/:token/accept`) record the request's language on the new account, resolved against the request's sales channel; an invitation records the invitee's language, not the inviter's. The customer sign-in (`POST /api/v1/auth/customer/login`) passes the request's language so that an account without one gets it (issue #652). `GET /api/v1/me` answers `customerAccount.preferredLanguage`. `RegistrationService.registerOrganization` accepts `context.preferredLanguage` and `InvitationService.acceptByToken` accepts `input.preferredLanguage`.

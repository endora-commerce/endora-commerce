// Fixture: a `backend.ts` with no `registerModule` export. Refused, not
// skipped — a skipped module composes nothing and the first symptom is a 404.
export const notAnEntryPoint = true;

// A directory the overlay scan reports as a module and that carries no manifest
// in either extension. It has no id and no version, so there is nothing to
// compose it under — the loader must say so, rather than fail on a raw
// ERR_MODULE_NOT_FOUND naming a path nobody wrote.
//
// Its own root, because a refusal fixture sharing a root with the others would
// abort the whole scan and every case under it would be measuring this throw.
export function registerModule(): void {
  // never reached
}

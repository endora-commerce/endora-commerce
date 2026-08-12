// Fixture — a service file shadowing a core service by path.
//
// This is what feature 057 accepted as a service override and feature 072
// rejects: the path no longer means anything to the resolver, so a file here
// would be one the platform silently never loads.
export class PricingService {}

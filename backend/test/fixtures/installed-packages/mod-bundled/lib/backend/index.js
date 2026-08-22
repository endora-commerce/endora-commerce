// A `./backend` entry point that composes a `registerModule` its own source
// never names. The container-name half is a static read of this file, so what
// this package registers is unreadable here — and crediting it with zero names
// is the silence the loader refuses.
export * from './inner.js';

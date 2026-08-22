export function registerModule(ctx) {
  ctx.di.providePort('fixtureBundledPort', ctx.asFunction(() => ({})).singleton());
}

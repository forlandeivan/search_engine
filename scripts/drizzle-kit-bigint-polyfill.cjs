// Fix Drizzle CLI JSON serialization when PG returns BigInt values during schema diff.
// We stringify BigInt as a decimal string to avoid "Do not know how to serialize a BigInt" errors.
// This file is loaded via `node -r ./scripts/drizzle-kit-bigint-polyfill.cjs ...`.
// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function toJSON() {
  return this.toString();
};

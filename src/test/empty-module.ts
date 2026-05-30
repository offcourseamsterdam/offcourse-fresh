// Test stub for `server-only` / `client-only`.
//
// Those packages intentionally throw when imported in the "wrong" bundle so that
// a Client Component importing server code (or vice-versa) fails the Next.js build.
// Under Vitest there is no bundler boundary, so we alias them to this empty module
// (see vitest.config.ts) — the guard still protects the real `next build`, while
// unit tests can import server modules freely.
export {}

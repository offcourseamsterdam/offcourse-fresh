// Shim for `server-only` — the Next.js guard that prevents importing server
// modules in client components. In plain Node.js scripts (outside Next.js)
// this module doesn't exist; this shim makes it a no-op so we can run
// server-side lib code directly in scripts and tests.
module.exports = {}

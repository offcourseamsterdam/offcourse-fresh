// Global Vitest setup — runs once before all test files.
//
// Sets placeholder values for required env vars so that modules which transitively
// import src/env.ts don't throw on import in the test runner. Real values are never
// needed in unit tests (all external calls are mocked); these are just schema-valid
// stubs that satisfy the zod validation.
//
// Individual tests that exercise env validation (src/env.test.ts) use vi.resetModules()
// + vi.stubEnv() to override these and re-import the module with controlled values.

const defaults: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  FAREHARBOR_API_APP: 'test-fh-app',
  FAREHARBOR_API_USER: 'test-fh-user',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
}

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value
}

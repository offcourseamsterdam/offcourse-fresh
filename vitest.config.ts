import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Claude Code checks out throwaway git worktrees under `.claude/worktrees/`.
    // Those are full copies of the repo at some older commit, so without this the
    // runner collects every test 2-4x over — inflating the suite (443 files instead
    // of 122), reporting failures from stale code that no longer exists on main, and
    // starving the genuinely slow tests of CPU until they trip the 5s timeout.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only`/`client-only` throw outside a bundler; alias to an empty
      // module so tests can import server code. The guard still applies to `next build`.
      'server-only': path.resolve(__dirname, './src/test/empty-module.ts'),
      'client-only': path.resolve(__dirname, './src/test/empty-module.ts'),
    },
  },
})

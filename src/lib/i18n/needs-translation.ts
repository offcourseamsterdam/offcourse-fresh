/**
 * The team reads English + Dutch; everything else gets an English translation
 * shown alongside the original. Dependency-free by design — safe to import
 * from both server code (shadow-drafter.ts, deciding whether to translate a
 * draft before storing it) and client components (ContextPane.tsx, deciding
 * whether to show a "translate" affordance for an inbound message), same
 * reasoning as lib/phone/normalize.ts's own dependency-free split.
 */
export function draftNeedsEnglish(language: string | null | undefined): boolean {
  return !!language && !/^(english|dutch|en|nl)$/i.test(language.trim())
}

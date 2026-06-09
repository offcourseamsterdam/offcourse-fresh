import type { CSSProperties } from 'react'

/**
 * Per-homepage-section appearance.
 *
 * Each section on the homepage can have a custom background texture and custom
 * H2 / H3 / body text colours, set by an admin. This module is the single source
 * of truth for:
 *   • which sections exist + the text roles each one exposes (with coded defaults)
 *   • how a stored style turns into inline CSS on the section's root element
 *
 * How the colours reach the text: `sectionRootStyle()` sets CSS custom properties
 * (`--sec-h2` / `--sec-h3` / `--sec-body`) on the section root. Each text element
 * inside the section reads `color: var(--sec-h2, <coded default>)`, so the coded
 * default wins until an admin overrides it — nothing changes for sections left
 * untouched.
 */

export type SectionKey =
  | 'hero'
  | 'featured_cruises'
  | 'reviews'
  | 'priorities'
  | 'fleet'
  | 'location'
  | 'footer'

export type TextRoleKey = 'h2' | 'h3' | 'body'

export interface SectionBackground {
  /** Optimized texture URL + average colour (instant paint before the image loads). */
  webp: string
  /** Legacy — older rows may have an AVIF URL; new uploads are WebP-only. */
  avif?: string
  color: string
}

export type SectionTextColors = Partial<Record<TextRoleKey, string>>

export interface SectionStyle {
  background: SectionBackground | null
  text_colors: SectionTextColors
  /** Optional decorative Polaroid image(s) (only sections with `polaroid` use them). */
  decoration_image_url?: string | null
  decoration_image_url_2?: string | null
}

export interface TextRole {
  key: TextRoleKey
  label: string
  /** The section's current/coded colour — shown as the picker's starting value. */
  default: string
}

export interface SectionDef {
  key: SectionKey
  label: string
  /** Coded fallback background class, used until a custom texture is uploaded. */
  defaultBgClass: string
  /** Which text colours this section exposes (some sections have no on-bg text). */
  roles: TextRole[]
  /** When true, the admin can upload a decorative Polaroid image for this section. */
  polaroid?: boolean
}

/**
 * The homepage sections, in render order, with the colours they expose. Defaults
 * mirror each section's current hardcoded colours so the site looks identical
 * until an admin changes something.
 */
export const SECTION_DEFS: SectionDef[] = [
  {
    key: 'hero',
    label: 'Hero',
    defaultBgClass: 'bg-texture-purple-dark',
    roles: [], // logo is an image, caption stays white — background only
  },
  {
    key: 'featured_cruises',
    label: '“We drift different” — Featured cruises',
    defaultBgClass: 'bg-texture-lavender',
    roles: [
      { key: 'h2', label: 'Heading', default: '#990000' },
      { key: 'h3', label: 'Tagline', default: '#990000' },
      { key: 'body', label: 'Card text', default: '#ffffff' },
    ],
  },
  {
    key: 'reviews',
    label: 'Reviews',
    defaultBgClass: '', // uses bg-[var(--color-sand)] inline in the component
    roles: [
      { key: 'h2', label: 'Heading', default: '#343499' },
      { key: 'body', label: 'Body', default: '#6b7280' },
    ],
  },
  {
    key: 'priorities',
    label: '“We got our priorities straight”',
    defaultBgClass: 'bg-texture-sand',
    // Card captions sit on white polaroids, so only the on-background heading
    // + tagline are themeable here.
    roles: [
      { key: 'h2', label: 'Heading', default: '#980201' },
      { key: 'h3', label: 'Tagline', default: '#980201' },
    ],
  },
  {
    key: 'fleet',
    label: 'Fleet (boats)',
    defaultBgClass: 'bg-texture-purple',
    roles: [
      { key: 'h2', label: 'Heading', default: '#343499' },
      { key: 'h3', label: 'Tagline', default: '#343499' },
      { key: 'body', label: 'Body', default: '#343499' },
    ],
  },
  {
    key: 'location',
    label: 'Location',
    defaultBgClass: 'bg-texture-sand',
    polaroid: true,
    roles: [
      { key: 'h2', label: 'Heading', default: '#990000' },
      { key: 'h3', label: 'Tagline', default: '#343499' },
      { key: 'body', label: 'Body', default: '#1f2937' },
    ],
  },
  {
    key: 'footer',
    label: 'Footer',
    defaultBgClass: 'bg-texture-yellow',
    roles: [{ key: 'body', label: 'Text', default: '#343499' }],
  },
]

export const SECTION_DEF_BY_KEY = Object.fromEntries(
  SECTION_DEFS.map(d => [d.key, d]),
) as Record<SectionKey, SectionDef>

/** Empty style — the coded defaults apply. */
export const EMPTY_SECTION_STYLE: SectionStyle = { background: null, text_colors: {} }

/**
 * Build the inline style for a section's root element: the custom background
 * (when uploaded) plus the `--sec-*` text-colour variables (when set). Returns an
 * empty object when nothing is customised, so the section keeps its coded look.
 */
export function sectionRootStyle(style: SectionStyle | undefined | null): CSSProperties {
  const css: Record<string, string> = {}

  if (style?.background) {
    const { webp, color } = style.background
    css.backgroundColor = color // instant paint while the texture loads
    css.backgroundImage = `url("${webp}")` // webp is universally supported and tiny
    css.backgroundSize = 'cover'
    css.backgroundPosition = 'center'
  }

  const tc = style?.text_colors
  if (tc?.h2) css['--sec-h2'] = tc.h2
  if (tc?.h3) css['--sec-h3'] = tc.h3
  if (tc?.body) css['--sec-body'] = tc.body

  return css as CSSProperties
}

/** `color: var(--sec-<role>, <fallback>)` — used by section text elements. */
export function roleColor(role: TextRoleKey, fallback: string): string {
  return `var(--sec-${role}, ${fallback})`
}

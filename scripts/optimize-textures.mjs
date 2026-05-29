// One-off: optimize the static CSS-background textures in /public/textures using
// the SAME Sharp settings as the image pipeline (src/lib/images/process.ts:
// AVIF q70, WebP q80). Generates .avif + .webp NEXT TO the originals — the
// original .png files are left untouched (kept as the CSS fallback). Run:
//   node scripts/optimize-textures.mjs
import sharp from 'sharp'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const DIR = 'public/textures'
const AVIF_QUALITY = 70 // matches src/lib/images/process.ts
const WEBP_QUALITY = 80
const FILES = ['bg-sand.png', 'bg-purple.png', 'bg-lavender.png', 'bg-yellow.png']

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const pct = (a, b) => `${(100 - (a / b) * 100).toFixed(0)}% smaller`

for (const file of FILES) {
  const src = path.join(DIR, file)
  let orig
  try { orig = await stat(src) } catch { console.log(`skip (missing): ${file}`); continue }

  const base = file.replace(/\.png$/, '')
  const meta = await sharp(src).metadata()
  const avifPath = path.join(DIR, `${base}.avif`)
  const webpPath = path.join(DIR, `${base}.webp`)

  // Format-only conversion at ORIGINAL dimensions — no resize, so the only
  // possible visual difference is encoding (imperceptible at these qualities).
  await sharp(src).avif({ quality: AVIF_QUALITY, effort: 4 }).toFile(avifPath)
  await sharp(src).webp({ quality: WEBP_QUALITY, effort: 4 }).toFile(webpPath)

  const a = await stat(avifPath)
  const w = await stat(webpPath)
  console.log(
    `${file}  ${meta.width}x${meta.height}\n` +
    `   PNG  ${kb(orig.size)}\n` +
    `   AVIF ${kb(a.size)}  (${pct(a.size, orig.size)})\n` +
    `   WebP ${kb(w.size)}  (${pct(w.size, orig.size)})`
  )
}

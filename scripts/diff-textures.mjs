// Objective visual-equivalence check: decode each optimized AVIF back to raw
// pixels and compare against the original PNG. Reports mean/max per-channel
// difference (0–255). Near-zero mean = visually identical. Run:
//   node scripts/diff-textures.mjs
import sharp from 'sharp'
import path from 'node:path'

const DIR = 'public/textures'
const BASES = ['bg-sand', 'bg-purple', 'bg-lavender', 'bg-yellow']

for (const base of BASES) {
  const png = await sharp(path.join(DIR, `${base}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const avif = await sharp(path.join(DIR, `${base}.avif`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })

  if (png.data.length !== avif.data.length) {
    console.log(`${base}: DIMENSION MISMATCH (${png.info.width}x${png.info.height} vs ${avif.info.width}x${avif.info.height})`)
    continue
  }

  let sum = 0, max = 0, over5 = 0
  for (let i = 0; i < png.data.length; i++) {
    const d = Math.abs(png.data[i] - avif.data[i])
    sum += d
    if (d > max) max = d
    if (d > 5) over5++
  }
  const mean = sum / png.data.length
  const over5pct = (over5 / png.data.length) * 100
  console.log(
    `${base}: mean diff ${mean.toFixed(2)}/255 (${(mean / 255 * 100).toFixed(2)}%) · max ${max}/255 · ${over5pct.toFixed(2)}% of channels differ by >5`
  )
}

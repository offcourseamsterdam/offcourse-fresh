/**
 * Downscale an image in the browser BEFORE uploading.
 *
 * Phone photos are 8–12MB; Vercel rejects any serverless request body over
 * ~4.5MB, so a raw upload silently fails (the spinner just hangs). Resizing to
 * ~2000px and re-encoding as JPEG yields ~100–400KB, which uploads fast and
 * reliably. The server still re-optimizes into its display variants.
 *
 * Returns the original file untouched for non-images (e.g. videos), already-
 * small files, or if the browser can't decode it — so callers can always upload
 * the result safely.
 *
 * Browser-only (uses Image/canvas). Import into client components only.
 */
export async function downscaleImage(file: File, maxDim = 2000, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file // videos etc. pass through unchanged
  if (file.size < 700_000) return file // already small enough
  let url: string | null = null
  try {
    url = URL.createObjectURL(file)
    const objectUrl = url
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('decode failed'))
      i.src = objectUrl
    })
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file // let the server validate / reject
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}

import { createAdminClient } from '@/lib/supabase/admin'
import { processUploadedImage } from './process'
import { generateImageMetadataFromBuffer } from '@/lib/ai/generate-image-metadata'

export interface ProcessAssetResult {
  ok: true
  assetId: string
  variantsUploaded: number
  totalBytes: number
  metadataConfidence: number
  qualityIssues: string[]
  aiWarning?: string
}

export interface ProcessAssetError {
  ok: false
  assetId: string
  error: string
}

/**
 * Run the full pipeline on a single image_assets row that's in 'pending' (or 'failed') state.
 *
 * Flow:
 *   1. Mark status = 'processing'
 *   2. Download original from Supabase Storage
 *   3. Sharp pipeline → variants (AVIF + WebP × 6 widths) + blur + dominant color
 *   4. Gemini → alt text, keywords, quality_issues, SEO filename
 *   5. Claude → translate alt text + caption to 6 locales
 *   6. Upload all 12 variant files to Supabase Storage with SEO filenames
 *   7. Update row with variants[], blur_data_url, dominant_color, alt_text, etc.
 *   8. Mark status = 'complete'
 *
 * Errors leave status = 'failed' with failure_reason.
 */
export async function processAsset(assetId: string): Promise<ProcessAssetResult | ProcessAssetError> {
  const supabase = createAdminClient()

  // 1. Lock the row (mark processing)
  const { data: asset, error: fetchError } = await supabase
    .from('image_assets')
    .update({ status: 'processing', failure_reason: null })
    .eq('id', assetId)
    .select('*')
    .single()

  if (fetchError || !asset) {
    return { ok: false, assetId, error: `Asset not found: ${fetchError?.message}` }
  }

  try {
    // 2. Download original
    const originalRes = await fetch(asset.original_url)
    if (!originalRes.ok) throw new Error(`Failed to download original: ${originalRes.status}`)
    const originalBuffer = Buffer.from(await originalRes.arrayBuffer())

    // 3. Sharp pipeline
    const processed = await processUploadedImage(originalBuffer)

    // 4 + 5. AI metadata (Gemini + Claude). Use the 320px WebP — smallest variant,
    // fastest for Gemini inline data, well within the 60s function timeout.
    let aiMetadata = null
    let aiWarning: string | undefined
    try {
      const ref = processed.variants.find(v => v.width === 320) ?? processed.variants[0]
      aiMetadata = await generateImageMetadataFromBuffer(ref.webp, 'image/webp')
    } catch (err) {
      aiWarning = err instanceof Error ? err.message : String(err)
      console.warn(`[processAsset ${assetId}] AI metadata failed:`, aiWarning)
    }

    const baseFilename = aiMetadata?.seo_filename ?? `image-${assetId.slice(0, 8)}`

    // 6. Upload variants to Supabase Storage in the same bucket
    const CONTEXT_BUCKET: Record<string, string> = {
      cruise: 'cruise-images',
      extras: 'extras-images',
      hero: 'hero-images',
    }
    const bucket = (asset.bucket as string | null) ?? CONTEXT_BUCKET[asset.context] ?? 'cruise-images'
    const subfolder = asset.context_id ? `${asset.context_id}/` : ''
    const cacheControl = 'public, max-age=31536000, immutable'

    console.log(`[processAsset ${assetId}] uploading to bucket="${bucket}" context="${asset.context}"`)

    const uploadedVariants: Array<{
      width: number; height: number; avif_url: string; webp_url: string; avif_size: number; webp_size: number
    }> = []

    for (const v of processed.variants) {
      const avifPath = `${subfolder}${baseFilename}_${v.width}.avif`
      const webpPath = `${subfolder}${baseFilename}_${v.width}.webp`

      const avifUpload = await supabase.storage.from(bucket).upload(avifPath, v.avif, {
        contentType: 'image/avif', upsert: true, cacheControl,
      })
      if (avifUpload.error) {
        console.error(`[processAsset ${assetId}] AVIF upload error bucket="${bucket}" path="${avifPath}":`, JSON.stringify(avifUpload.error))
        throw new Error(`AVIF upload failed (bucket: ${bucket}): ${avifUpload.error.message}`)
      }

      const webpUpload = await supabase.storage.from(bucket).upload(webpPath, v.webp, {
        contentType: 'image/webp', upsert: true, cacheControl,
      })
      if (webpUpload.error) {
        console.error(`[processAsset ${assetId}] WebP upload error bucket="${bucket}" path="${webpPath}":`, JSON.stringify(webpUpload.error))
        throw new Error(`WebP upload failed (bucket: ${bucket}): ${webpUpload.error.message}`)
      }

      const avifUrl = supabase.storage.from(bucket).getPublicUrl(avifPath).data.publicUrl
      const webpUrl = supabase.storage.from(bucket).getPublicUrl(webpPath).data.publicUrl

      uploadedVariants.push({
        width: v.width,
        height: v.height,
        avif_url: avifUrl,
        webp_url: webpUrl,
        avif_size: v.avif.length,
        webp_size: v.webp.length,
      })
    }

    const totalBytes = uploadedVariants.reduce(
      (sum, v) => sum + (v.avif_size ?? 0) + (v.webp_size ?? 0), 0,
    )

    // 7. Update row
    const { error: updateError } = await supabase
      .from('image_assets')
      .update({
        status: 'complete',
        base_filename: baseFilename,
        variants: uploadedVariants,
        blur_data_url: processed.blur,
        dominant_color: processed.dominantColor,
        original_width: processed.originalWidth,
        original_height: processed.originalHeight,
        is_animated: processed.isAnimated,
        alt_text: aiMetadata?.alt_text ?? null,
        caption: aiMetadata?.caption ?? null,
        primary_keywords: aiMetadata?.primary_keywords ?? null,
        confidence: aiMetadata?.confidence ?? null,
        quality_issues: aiMetadata?.quality_issues ?? [],
        processed_at: new Date().toISOString(),
        failure_reason: null,
      })
      .eq('id', assetId)

    if (updateError) throw new Error(`Failed to save processed asset: ${updateError.message}`)

    return {
      ok: true,
      assetId,
      variantsUploaded: uploadedVariants.length,
      totalBytes,
      metadataConfidence: aiMetadata?.confidence ?? 0,
      qualityIssues: aiMetadata?.quality_issues ?? [],
      aiWarning,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown processing error'
    await supabase
      .from('image_assets')
      .update({ status: 'failed', failure_reason: message })
      .eq('id', assetId)
    return { ok: false, assetId, error: message }
  }
}

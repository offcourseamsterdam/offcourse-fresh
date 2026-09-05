import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'finance-attachments'
const SIGNED_URL_TTL_SECONDS = 60 * 5 // short-lived — these link to bank IBANs/VAT numbers

/** Uploads a source document (Viator .xlsx, GetYourGuide PDF, ...) to the private finance-attachments bucket. */
export async function uploadFinanceAttachment(
  supabase: SupabaseClient,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Returns a short-lived signed URL to view/download a stored finance attachment. */
export async function getFinanceAttachmentSignedUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/** Reads a stored finance attachment back as bytes — used to forward the original document to the bookkeeping mailbox. */
export async function downloadFinanceAttachment(supabase: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

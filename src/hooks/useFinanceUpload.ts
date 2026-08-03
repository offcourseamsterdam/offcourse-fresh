'use client'

import { useState } from 'react'

export interface UseFinanceUploadResult {
  busy: boolean
  message: string | null
  isError: boolean
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

/**
 * Shared upload wiring for the finance admin tabs (Viator, GetYourGuide,
 * BoatLocal, Withlocals, Click & Boat, Revolut). Every one of those tabs
 * posts a single file to its own `/api/admin/finance/<source>/upload` route
 * and only differs in: the upload URL, what the success message says (built
 * from that route's own `json.data` shape, which varies per source), and
 * which summary/summaries to re-fetch afterwards.
 *
 * `onUploaded` runs once the upload succeeds. It receives the parsed
 * `json.data` payload, is the place to call any refresh()/refreshX()
 * functions the tab needs, and must return the success message string to
 * show the user (mirrors what each tab used to build inline).
 *
 * Typical usage:
 *   const { busy, message, isError, handleFileSelected } = useFinanceUpload(
 *     '/api/admin/finance/viator/upload',
 *     (data) => {
 *       const { documentNumber, lineCount, newLinesStored } = data
 *       refresh()
 *       refreshBatches()
 *       return `${documentNumber}: ${newLinesStored} van ${lineCount} boekingen opgeslagen${
 *         newLinesStored < lineCount ? ' (rest bestond al)' : ''
 *       }`
 *     },
 *   )
 */
export function useFinanceUpload<T = unknown>(
  uploadUrl: string,
  onUploaded: (data: T) => string,
): UseFinanceUploadResult {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setBusy(true)
    setMessage(null)
    setIsError(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(uploadUrl, { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      const successMessage = onUploaded(json.data)
      setBusy(false)
      setIsError(false)
      setMessage(successMessage)
    } catch (err) {
      setBusy(false)
      setIsError(true)
      setMessage(err instanceof Error ? err.message : 'Upload mislukt')
    }
  }

  return { busy, message, isError, handleFileSelected }
}

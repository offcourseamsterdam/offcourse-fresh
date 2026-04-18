'use client'

import Image, { type ImageProps } from 'next/image'
import { useState } from 'react'

export function SafeImage(props: ImageProps) {
  const [errored, setErrored] = useState(false)
  if (errored) return null
  return <Image {...props} onError={() => setErrored(true)} />
}

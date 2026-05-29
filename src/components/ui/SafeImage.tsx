'use client'

import Image, { type ImageProps } from 'next/image'
import { useState } from 'react'

export function SafeImage(props: ImageProps) {
  const [errored, setErrored] = useState(false)
  if (errored) return null
  const { alt, ...rest } = props
  return <Image alt={alt} {...rest} onError={() => setErrored(true)} />
}

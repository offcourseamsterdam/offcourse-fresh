import type { SyntheticEvent } from 'react'

export const hideOnError = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none'
}

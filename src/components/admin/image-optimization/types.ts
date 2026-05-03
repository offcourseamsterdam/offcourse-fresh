import type { ImageAsset } from '@/lib/images/types'

export interface ImageAssetCounts {
  pending: number
  processing: number
  complete: number
  failed: number
  total: number
}

export interface ImageListResponse {
  assets: ImageAsset[]
  counts: ImageAssetCounts
}

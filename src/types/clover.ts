export interface CloverMetrics {
  leaf_count: number
  leaf_sizes: number[]
  avg_leaf_size: number
  max_leaf_size: number
  min_leaf_size: number
  size_spread: number
  is_balanced: boolean
}

export interface LeafRegion {
  id: string
  area: number
  cx: number
  cy: number
  xPercent: number
  yPercent: number
  radiusPercent: number
}

export interface CloverAnalysis {
  metrics: CloverMetrics
  regions: LeafRegion[]
  imageUrl: string
  imageWidth: number
  imageHeight: number
  analyzer: 'opencv' | 'canvas'
  confidence: number
  message: string
}

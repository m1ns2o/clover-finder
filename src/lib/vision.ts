import type { CloverAnalysis, CloverMetrics, LeafRegion } from '@/types/clover'
import opencvRuntimeUrl from '@techstark/opencv-js/dist/opencv.js?url'

interface RawLeafRegion extends Omit<LeafRegion, 'xPercent' | 'yPercent' | 'radiusPercent'> {
  width?: number
  height?: number
  aspectRatio?: number
  circularity?: number
  extent?: number
}

interface OpenCvWorkerSuccess {
  id: number
  ok: true
  regions: RawLeafRegion[]
}

interface OpenCvWorkerFailure {
  id: number
  ok: false
  error: string
}

type OpenCvWorkerResponse = OpenCvWorkerSuccess | OpenCvWorkerFailure

const opencvSource = opencvRuntimeUrl
const sampleImagePath = '/sample-clover.svg'
const maxAnalysisSide = 420
const maxVisibleSide = 900
let openCvWorker: Worker | null = null
let openCvWorkerUrl: string | null = null
let openCvWorkerRequestId = 0
const openCvPendingRequests = new Map<number, {
  resolve: (regions: RawLeafRegion[]) => void
  reject: (error: Error) => void
  timeout: number
}>()

export async function analyzeImage(input: Blob | string): Promise<CloverAnalysis> {
  const { canvas, displayUrl } = await drawInputToCanvas(input)
  const imageData = readCanvasImageData(canvas)
  const canvasAnalysis = analyzeWithCanvasData(imageData, displayUrl)

  try {
    const regions = await analyzeWithOpenCvWorker(imageData, 2800)
    const openCvAnalysis = makeAnalysis(regions, displayUrl, 'opencv', imageData.width, imageData.height)
    return openCvAnalysis.metrics.leaf_count ? openCvAnalysis : canvasAnalysis
  } catch {
    return canvasAnalysis
  }
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth || 960
  const height = video.videoHeight || 1280

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    throw new Error('카메라 영상이 아직 준비되지 않았습니다.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('캔버스 컨텍스트를 만들 수 없습니다.')
  }

  ctx.drawImage(video, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('촬영 이미지를 만들 수 없습니다.'))
      }
    }, 'image/jpeg', 0.92)
  })
}

export function getSampleImagePath(): string {
  return sampleImagePath
}

export async function preloadOpenCv(): Promise<void> {
  getOpenCvWorker().postMessage({ type: 'warmup' })
}

function analyzeWithOpenCvWorker(imageData: ImageData, timeoutMs: number): Promise<RawLeafRegion[]> {
  const worker = getOpenCvWorker()
  const id = openCvWorkerRequestId + 1
  openCvWorkerRequestId = id

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      openCvPendingRequests.delete(id)
      reject(new Error('OpenCV.js 분석 시간이 초과되었습니다.'))
    }, timeoutMs)

    openCvPendingRequests.set(id, { resolve, reject, timeout })
    const copy = new Uint8ClampedArray(imageData.data)
    worker.postMessage({
      type: 'analyze',
      id,
      width: imageData.width,
      height: imageData.height,
      buffer: copy.buffer
    }, [copy.buffer])
  })
}

function getOpenCvWorker(): Worker {
  if (openCvWorker) {
    return openCvWorker
  }

  const runtimeUrl = new URL(opencvSource, window.location.origin).href
  const workerUrl = URL.createObjectURL(new Blob([makeOpenCvWorkerSource(runtimeUrl)], { type: 'text/javascript' }))
  openCvWorker = new Worker(workerUrl)
  openCvWorkerUrl = workerUrl

  openCvWorker.addEventListener('message', event => {
    const response = event.data as OpenCvWorkerResponse
    if (typeof response?.id !== 'number') {
      return
    }

    const pending = openCvPendingRequests.get(response.id)
    if (!pending) {
      return
    }

    window.clearTimeout(pending.timeout)
    openCvPendingRequests.delete(response.id)

    if (response.ok) {
      pending.resolve(response.regions)
    } else {
      pending.reject(new Error(response.error))
    }
  })

  openCvWorker.addEventListener('error', () => {
    for (const [id, pending] of openCvPendingRequests.entries()) {
      window.clearTimeout(pending.timeout)
      pending.reject(new Error('OpenCV.js worker 오류가 발생했습니다.'))
      openCvPendingRequests.delete(id)
    }
    openCvWorker?.terminate()
    openCvWorker = null
    if (openCvWorkerUrl) {
      URL.revokeObjectURL(openCvWorkerUrl)
      openCvWorkerUrl = null
    }
  })

  return openCvWorker
}

function readCanvasImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('캔버스 컨텍스트를 만들 수 없습니다.')
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function analyzeWithCanvasData(imageData: ImageData, imageUrl: string): CloverAnalysis {
  const mask = new Uint8Array(imageData.width * imageData.height)

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4
    const red = imageData.data[offset] ?? 0
    const green = imageData.data[offset + 1] ?? 0
    const blue = imageData.data[offset + 2] ?? 0
    const alpha = imageData.data[offset + 3] ?? 0

    const greenDominant = green > 54 && green > red * 1.06 && green > blue * 1.05
    const saturated = green - Math.min(red, blue) > 16
    mask[pixel] = alpha > 30 && greenDominant && saturated ? 255 : 0
  }

  suppressStemPixels(mask, imageData.width, imageData.height)

  return makeAnalysis(splitByAngle(mask, imageData.width, imageData.height), imageUrl, 'canvas', imageData.width, imageData.height)
}

async function drawInputToCanvas(input: Blob | string): Promise<{ canvas: HTMLCanvasElement; displayUrl: string }> {
  const imageUrl = typeof input === 'string' ? input : URL.createObjectURL(input)
  const image = await loadImage(imageUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const ratio = Math.min(1, maxAnalysisSide / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * ratio))
  canvas.height = Math.max(1, Math.round(sourceHeight * ratio))

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('캔버스 컨텍스트를 만들 수 없습니다.')
  }

  ctx.fillStyle = '#fbfbf4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    canvas,
    displayUrl: typeof input === 'string' ? imageUrl : makeDisplayImageUrlFromImage(image)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timeout = window.setTimeout(() => {
      image.src = ''
      reject(new Error('이미지를 불러오는 시간이 너무 오래 걸립니다.'))
    }, 6000)

    if (/^https?:\/\//.test(src)) {
      image.crossOrigin = 'anonymous'
    }
    image.onload = () => {
      window.clearTimeout(timeout)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('이미지를 불러오지 못했습니다.'))
    }
    image.src = src
  })
}

function splitByAngle(mask: Uint8Array, width: number, height: number): RawLeafRegion[] {
  suppressStemPixels(mask, width, height)
  const rawCenter = calculateMaskCenter(mask, width, height)

  if (!rawCenter.total) {
    return []
  }

  const refinedCenter = calculateMaskCenter(mask, width, height, (x, y) => {
    return !isLikelyStemPixel(x - rawCenter.cx, y - rawCenter.cy, width, height)
  })
  const cx = refinedCenter.total ? refinedCenter.cx : rawCenter.cx
  const cy = refinedCenter.total ? refinedCenter.cy : rawCenter.cy
  const buckets = Array.from({ length: 4 }, (_, index) => ({
    id: `leaf-${index + 1}`,
    area: 0,
    sx: 0,
    sy: 0
  }))
  const deadZone = Math.max(width, height) * 0.035

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue
    }
    const x = index % width
    const y = Math.floor(index / width)
    const dx = x - cx
    const dy = y - cy
    if (Math.hypot(dx, dy) < deadZone || isLikelyStemPixel(dx, dy, width, height)) {
      continue
    }

    const angle = Math.atan2(dy, dx)
    const bucketIndex = angle < -Math.PI / 2 ? 0 : angle < 0 ? 1 : angle < Math.PI / 2 ? 2 : 3
    const bucket = buckets[bucketIndex]!
    bucket.area += 1
    bucket.sx += x
    bucket.sy += y
  }

  const minBucketArea = Math.max(40, rawCenter.total / 12)
  return buckets
    .filter(bucket => bucket.area >= minBucketArea)
    .map(bucket => ({
      id: bucket.id,
      area: bucket.area,
      cx: bucket.sx / bucket.area,
      cy: bucket.sy / bucket.area
    }))
}

function calculateMaskCenter(
  mask: Uint8Array,
  width: number,
  height: number,
  shouldInclude: (x: number, y: number) => boolean = () => true
): { total: number; cx: number; cy: number } {
  let total = 0
  let sx = 0
  let sy = 0

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue
    }
    const x = index % width
    const y = Math.floor(index / width)
    if (!shouldInclude(x, y)) {
      continue
    }
    total += 1
    sx += x
    sy += y
  }

  return {
    total,
    cx: total ? sx / total : width / 2,
    cy: total ? sy / total : height / 2
  }
}

function isLikelyStemPixel(dx: number, dy: number, width: number, height: number): boolean {
  const maxSide = Math.max(width, height)
  return dy > maxSide * 0.055 && Math.abs(dx) < Math.max(maxSide * 0.055, dy * 0.62)
}

function suppressStemPixels(mask: Uint8Array, width: number, height: number): void {
  const bounds = getMaskBounds(mask, width, height)
  if (!bounds) {
    return
  }

  const boxWidth = bounds.maxX - bounds.minX + 1
  const boxHeight = bounds.maxY - bounds.minY + 1
  if (boxWidth < 8 || boxHeight < 8) {
    return
  }

  const rowCounts = new Uint16Array(height)
  const rowSums = new Float64Array(height)
  let maxRowCount = 0

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue
    }

    const x = index % width
    const y = Math.floor(index / width)
    rowCounts[y] += 1
    rowSums[y] += x
    maxRowCount = Math.max(maxRowCount, rowCounts[y] ?? 0)
  }

  if (!maxRowCount) {
    return
  }

  const crownLimitY = Math.round(bounds.minY + boxHeight * 0.68)
  const crownCenter = calculateMaskCenter(mask, width, height, (_x, y) => y <= crownLimitY)
  const crownX = crownCenter.total ? crownCenter.cx : (bounds.minX + bounds.maxX) / 2
  const crownY = crownCenter.total ? crownCenter.cy : (bounds.minY + bounds.maxY) / 2
  const startY = Math.max(bounds.minY, Math.round(crownY + Math.max(boxHeight * 0.07, Math.max(width, height) * 0.025)))
  const baseNarrowLimit = Math.max(8, Math.min(maxRowCount * 0.46, boxWidth * 0.3))

  for (let y = startY; y <= bounds.maxY; y += 1) {
    const rowCount = rowCounts[y] ?? 0
    if (!rowCount) {
      continue
    }

    const rowCenter = rowSums[y]! / rowCount
    const dy = y - crownY
    const rowIsTail = dy > boxHeight * 0.18 && rowCount < maxRowCount * 0.42 && Math.abs(rowCenter - crownX) < Math.max(boxWidth * 0.28, dy * 0.7)

    let x = bounds.minX
    while (x <= bounds.maxX) {
      const index = y * width + x
      if (!mask[index]) {
        x += 1
        continue
      }

      const runStart = x
      while (x <= bounds.maxX && mask[y * width + x]) {
        x += 1
      }
      const runEnd = x - 1
      const runWidth = runEnd - runStart + 1
      const runCenter = (runStart + runEnd) / 2
      const nearStemAxis = Math.abs(runCenter - crownX) < Math.max(boxWidth * 0.2, dy * 0.58)
      const narrowRun = runWidth <= Math.max(baseNarrowLimit, maxRowCount * 0.32)
      const lowerNarrowRun = dy > boxHeight * 0.28 && runWidth < maxRowCount * 0.58

      if ((nearStemAxis && (narrowRun || lowerNarrowRun)) || rowIsTail) {
        for (let clearX = runStart; clearX <= runEnd; clearX += 1) {
          mask[y * width + clearX] = 0
        }
      }
    }
  }
}

function getMaskBounds(mask: Uint8Array, width: number, height: number): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue
    }

    const x = index % width
    const y = Math.floor(index / width)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  return maxX >= minX && maxY >= minY ? { minX, maxX, minY, maxY } : null
}

function makeAnalysis(
  regions: RawLeafRegion[],
  imageUrl: string,
  analyzer: 'opencv' | 'canvas',
  imageWidth: number,
  imageHeight: number
): CloverAnalysis {
  const minSide = Math.max(1, Math.min(imageWidth, imageHeight))
  const sorted = filterStemRegionCandidates(regions, imageWidth, imageHeight)
    .sort((a, b) => b.area - a.area)
    .slice(0, 6)
    .map(region => ({
      ...region,
      xPercent: clamp((region.cx / imageWidth) * 100, 0, 100),
      yPercent: clamp((region.cy / imageHeight) * 100, 0, 100),
      radiusPercent: clamp((Math.sqrt(region.area / Math.PI) / minSide) * 100, 4, 13)
    }))
  const leafCount = sorted.length
  const maxArea = Math.max(...sorted.map(region => region.area), 1)
  const leafSizes = sorted.map(region => Math.max(1, Math.round((region.area / maxArea) * 100)))
  const metrics = makeMetrics(leafSizes)
  const confidence = calculateConfidence(metrics, analyzer)
  const message = leafCount
    ? `${leafCount}개의 잎 후보를 찾았습니다.`
    : '초록 잎 영역을 찾지 못했습니다. 테스트 이미지를 사용해 보세요.'

  return {
    metrics,
    regions: sorted,
    imageUrl,
    imageWidth,
    imageHeight,
    analyzer,
    confidence,
    message
  }
}

function filterStemRegionCandidates(regions: RawLeafRegion[], imageWidth: number, imageHeight: number): RawLeafRegion[] {
  if (regions.length <= 1) {
    return regions
  }

  const maxArea = Math.max(...regions.map(region => region.area), 1)
  const center = regions.reduce((acc, region) => {
    const weight = Math.min(region.area, maxArea)
    acc.weight += weight
    acc.x += region.cx * weight
    acc.y += region.cy * weight
    return acc
  }, { weight: 0, x: 0, y: 0 })
  const cx = center.weight ? center.x / center.weight : imageWidth / 2
  const cy = center.weight ? center.y / center.weight : imageHeight / 2
  const maxSide = Math.max(imageWidth, imageHeight)

  const stemFiltered = regions.filter(region => {
    const areaRatio = region.area / maxArea
    const dx = Math.abs(region.cx - cx)
    const dy = region.cy - cy
    const belowCenter = dy > maxSide * 0.12
    const nearMiddle = dx < Math.max(maxSide * 0.08, Math.abs(dy) * 0.48)
    const slenderLowerCandidate = Boolean(region.aspectRatio && region.aspectRatio > 1.9 && region.height && region.height > region.width!)
    const weakShape = Boolean(region.circularity && region.circularity < 0.56) || Boolean(region.extent && region.extent < 0.46)
    return !((areaRatio < 0.62 && belowCenter && nearMiddle) || (belowCenter && nearMiddle && slenderLowerCandidate && weakShape))
  })

  return filterSmallInteriorBridgeCandidates(stemFiltered)
}

function filterSmallInteriorBridgeCandidates(regions: RawLeafRegion[]): RawLeafRegion[] {
  if (regions.length <= 3) {
    return regions
  }

  const sorted = [...regions].sort((a, b) => b.area - a.area)
  const maxArea = sorted[0]?.area ?? 1
  const strongRegions = sorted.filter(region => region.area >= maxArea * 0.58)

  if (strongRegions.length < 3) {
    return regions
  }

  const bounds = strongRegions.reduce((acc, region) => ({
    minX: Math.min(acc.minX, region.cx),
    maxX: Math.max(acc.maxX, region.cx),
    minY: Math.min(acc.minY, region.cy),
    maxY: Math.max(acc.maxY, region.cy)
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  })
  const center = strongRegions.reduce((acc, region) => {
    acc.x += region.cx
    acc.y += region.cy
    return acc
  }, { x: 0, y: 0 })
  const centerX = center.x / strongRegions.length
  const centerY = center.y / strongRegions.length
  const averageDistance = strongRegions.reduce((sum, region) => {
    return sum + Math.hypot(region.cx - centerX, region.cy - centerY)
  }, 0) / strongRegions.length
  const margin = Math.max(8, averageDistance * 0.35)

  return regions.filter(region => {
    const areaRatio = region.area / maxArea
    if (areaRatio >= 0.52) {
      return true
    }

    const insideStrongCluster = region.cx >= bounds.minX - margin
      && region.cx <= bounds.maxX + margin
      && region.cy >= bounds.minY - margin
      && region.cy <= bounds.maxY + margin
    const distanceFromCore = Math.hypot(region.cx - centerX, region.cy - centerY)
    const closeToCore = averageDistance > 0 && distanceFromCore < averageDistance * 0.98
    const lowShapeConfidence = !region.circularity || region.circularity < 0.72 || !region.extent || region.extent < 0.58

    return !(insideStrongCluster && closeToCore && lowShapeConfidence)
  })
}

function makeMetrics(leafSizes: number[]): CloverMetrics {
  const leafCount = leafSizes.length
  const avgLeafSize = leafCount ? Math.round(leafSizes.reduce((sum, size) => sum + size, 0) / leafCount) : 0
  const maxLeafSize = leafCount ? Math.max(...leafSizes) : 0
  const minLeafSize = leafCount ? Math.min(...leafSizes) : 0
  const sizeSpread = maxLeafSize - minLeafSize

  return {
    leaf_count: leafCount,
    leaf_sizes: leafSizes,
    avg_leaf_size: avgLeafSize,
    max_leaf_size: maxLeafSize,
    min_leaf_size: minLeafSize,
    size_spread: sizeSpread,
    is_balanced: leafCount > 0 && sizeSpread <= 24
  }
}

function calculateConfidence(metrics: CloverMetrics, analyzer: 'opencv' | 'canvas'): number {
  if (!metrics.leaf_count) {
    return 0.18
  }

  const countScore = metrics.leaf_count === 4 ? 0.34 : Math.max(0.12, 0.28 - Math.abs(4 - metrics.leaf_count) * 0.04)
  const balanceScore = metrics.is_balanced ? 0.28 : Math.max(0.08, 0.28 - metrics.size_spread / 120)
  const analyzerScore = analyzer === 'opencv' ? 0.24 : 0.18
  const densityScore = Math.min(0.14, metrics.avg_leaf_size / 700)

  return Math.min(0.96, Number((countScore + balanceScore + analyzerScore + densityScore).toFixed(2)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function makeDisplayImageUrlFromImage(image: HTMLImageElement): string {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const ratio = Math.min(1, maxVisibleSide / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * ratio))
  canvas.height = Math.max(1, Math.round(sourceHeight * ratio))

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return image.src
  }

  ctx.fillStyle = '#fbfbf4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/jpeg', 0.86)
}

function makeOpenCvWorkerSource(source: string): string {
  return `
    const opencvSource = ${JSON.stringify(source)};
    let cvReadyPromise = null;

    function loadCv() {
      if (self.cv && self.cv.Mat) {
        return Promise.resolve({ cv: self.cv });
      }

      if (cvReadyPromise) {
        return cvReadyPromise;
      }

      cvReadyPromise = new Promise((resolve, reject) => {
        let settled = false;
        let interval = 0;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearInterval(interval);
          reject(new Error('OpenCV.js worker load timeout'));
        }, 15000);

        const finish = () => {
          if (!settled && self.cv && self.cv.Mat) {
            settled = true;
            clearTimeout(timeout);
            clearInterval(interval);
            resolve({ cv: self.cv });
          }
        };

        try {
          importScripts(opencvSource);
          interval = setInterval(finish, 50);
          finish();
        } catch (error) {
          settled = true;
          clearInterval(interval);
          clearTimeout(timeout);
          cvReadyPromise = null;
          reject(error);
        }
      }).catch(error => {
        cvReadyPromise = null;
        throw error;
      });

      return cvReadyPromise;
    }

    function calculateMaskCenter(mask, width, height, shouldInclude = () => true) {
      let total = 0;
      let sx = 0;
      let sy = 0;

      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) {
          continue;
        }
        const x = index % width;
        const y = Math.floor(index / width);
        if (!shouldInclude(x, y)) {
          continue;
        }
        total += 1;
        sx += x;
        sy += y;
      }

      return {
        total,
        cx: total ? sx / total : width / 2,
        cy: total ? sy / total : height / 2
      };
    }

    function isLikelyStemPixel(dx, dy, width, height) {
      const maxSide = Math.max(width, height);
      return dy > maxSide * 0.055 && Math.abs(dx) < Math.max(maxSide * 0.055, dy * 0.62);
    }

    function getMaskBounds(mask, width, height) {
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;

      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) {
          continue;
        }

        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }

      return maxX >= minX && maxY >= minY ? { minX, maxX, minY, maxY } : null;
    }

    function suppressStemPixels(mask, width, height) {
      const bounds = getMaskBounds(mask, width, height);
      if (!bounds) {
        return;
      }

      const boxWidth = bounds.maxX - bounds.minX + 1;
      const boxHeight = bounds.maxY - bounds.minY + 1;
      if (boxWidth < 8 || boxHeight < 8) {
        return;
      }

      const rowCounts = new Uint16Array(height);
      const rowSums = new Float64Array(height);
      let maxRowCount = 0;

      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) {
          continue;
        }

        const x = index % width;
        const y = Math.floor(index / width);
        rowCounts[y] += 1;
        rowSums[y] += x;
        maxRowCount = Math.max(maxRowCount, rowCounts[y]);
      }

      if (!maxRowCount) {
        return;
      }

      const crownLimitY = Math.round(bounds.minY + boxHeight * 0.68);
      const crownCenter = calculateMaskCenter(mask, width, height, (_x, y) => y <= crownLimitY);
      const crownX = crownCenter.total ? crownCenter.cx : (bounds.minX + bounds.maxX) / 2;
      const crownY = crownCenter.total ? crownCenter.cy : (bounds.minY + bounds.maxY) / 2;
      const startY = Math.max(bounds.minY, Math.round(crownY + Math.max(boxHeight * 0.07, Math.max(width, height) * 0.025)));
      const baseNarrowLimit = Math.max(8, Math.min(maxRowCount * 0.46, boxWidth * 0.3));

      for (let y = startY; y <= bounds.maxY; y += 1) {
        const rowCount = rowCounts[y] || 0;
        if (!rowCount) {
          continue;
        }

        const rowCenter = rowSums[y] / rowCount;
        const dy = y - crownY;
        const rowIsTail = dy > boxHeight * 0.18 && rowCount < maxRowCount * 0.42 && Math.abs(rowCenter - crownX) < Math.max(boxWidth * 0.28, dy * 0.7);

        let x = bounds.minX;
        while (x <= bounds.maxX) {
          const index = y * width + x;
          if (!mask[index]) {
            x += 1;
            continue;
          }

          const runStart = x;
          while (x <= bounds.maxX && mask[y * width + x]) {
            x += 1;
          }
          const runEnd = x - 1;
          const runWidth = runEnd - runStart + 1;
          const runCenter = (runStart + runEnd) / 2;
          const nearStemAxis = Math.abs(runCenter - crownX) < Math.max(boxWidth * 0.2, dy * 0.58);
          const narrowRun = runWidth <= Math.max(baseNarrowLimit, maxRowCount * 0.32);
          const lowerNarrowRun = dy > boxHeight * 0.28 && runWidth < maxRowCount * 0.58;

          if ((nearStemAxis && (narrowRun || lowerNarrowRun)) || rowIsTail) {
            for (let clearX = runStart; clearX <= runEnd; clearX += 1) {
              mask[y * width + clearX] = 0;
            }
          }
        }
      }
    }

    function splitByAngle(mask, width, height) {
      suppressStemPixels(mask, width, height);
      const rawCenter = calculateMaskCenter(mask, width, height);

      if (!rawCenter.total) {
        return [];
      }

      const refinedCenter = calculateMaskCenter(mask, width, height, (x, y) => {
        return !isLikelyStemPixel(x - rawCenter.cx, y - rawCenter.cy, width, height);
      });
      const cx = refinedCenter.total ? refinedCenter.cx : rawCenter.cx;
      const cy = refinedCenter.total ? refinedCenter.cy : rawCenter.cy;
      const buckets = Array.from({ length: 4 }, (_, index) => ({
        id: 'leaf-' + (index + 1),
        area: 0,
        sx: 0,
        sy: 0
      }));
      const deadZone = Math.max(width, height) * 0.035;

      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) {
          continue;
        }
        const x = index % width;
        const y = Math.floor(index / width);
        const dx = x - cx;
        const dy = y - cy;
        if (Math.hypot(dx, dy) < deadZone || isLikelyStemPixel(dx, dy, width, height)) {
          continue;
        }

        const angle = Math.atan2(dy, dx);
        const bucketIndex = angle < -Math.PI / 2 ? 0 : angle < 0 ? 1 : angle < Math.PI / 2 ? 2 : 3;
        const bucket = buckets[bucketIndex];
        bucket.area += 1;
        bucket.sx += x;
        bucket.sy += y;
      }

      const minBucketArea = Math.max(40, rawCenter.total / 12);
      return buckets
        .filter(bucket => bucket.area >= minBucketArea)
        .map(bucket => ({
          id: bucket.id,
          area: bucket.area,
          cx: bucket.sx / bucket.area,
          cy: bucket.sy / bucket.area
        }));
    }

    function isLeafContourCandidate(cv, contour, area, width, height) {
      const rect = cv.boundingRect(contour);
      const rectWidth = Math.max(1, rect.width);
      const rectHeight = Math.max(1, rect.height);
      const aspectRatio = Math.max(rectWidth / rectHeight, rectHeight / rectWidth);
      const extent = area / Math.max(1, rectWidth * rectHeight);
      const perimeter = cv.arcLength(contour, true);
      const circularity = perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
      const centerY = rect.y + rectHeight / 2;
      const tooSlender = aspectRatio > 2.65 && (circularity < 0.5 || extent < 0.42);
      const lowerSmallStroke = rectHeight > rectWidth * 1.9 && centerY > height * 0.48 && area < (width * height) / 32;

      return !tooSlender && !lowerSmallStroke;
    }

    function analyzeWithOpenCv(cv, message) {
      const width = message.width;
      const height = message.height;
      const imageData = new ImageData(new Uint8ClampedArray(message.buffer), width, height);
      const src = cv.matFromImageData(imageData);
      const rgb = new cv.Mat();
      const hsv = new cv.Mat();
      const mask = new cv.Mat();
      const leafMask = new cv.Mat();
      let lower = null;
      let upper = null;
      let kernel = null;
      let leafKernel = null;
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();

      try {
        cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
        cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
        lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [32, 34, 28, 0]);
        upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [100, 255, 245, 255]);
        cv.inRange(hsv, lower, upper, mask);
        kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE || 2, new cv.Size(5, 5));
        cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
        suppressStemPixels(mask.data, mask.cols, mask.rows);
        const leafKernelSizeBase = Math.max(7, Math.min(15, Math.round(Math.min(width, height) * 0.035)));
        const leafKernelSize = leafKernelSizeBase % 2 ? leafKernelSizeBase : leafKernelSizeBase + 1;
        leafKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE || 2, new cv.Size(leafKernelSize, leafKernelSize));
        cv.morphologyEx(mask, leafMask, cv.MORPH_OPEN, leafKernel);
        cv.morphologyEx(leafMask, leafMask, cv.MORPH_CLOSE, kernel);
        suppressStemPixels(leafMask.data, leafMask.cols, leafMask.rows);
        const analysisMask = cv.countNonZero(leafMask) > Math.max(40, (width * height) / 1000) ? leafMask : mask;
        cv.findContours(analysisMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const regions = [];
        const minArea = Math.max(28, (width * height) / 700);

        for (let index = 0; index < contours.size(); index += 1) {
          const contour = contours.get(index);
          const area = cv.contourArea(contour);

          if (area >= minArea && isLeafContourCandidate(cv, contour, area, width, height)) {
            const moments = cv.moments(contour);
            const rect = cv.boundingRect(contour);
            const rectWidth = Math.max(1, rect.width);
            const rectHeight = Math.max(1, rect.height);
            const perimeter = cv.arcLength(contour, true);
            regions.push({
              id: 'leaf-' + (regions.length + 1),
              area,
              cx: moments.m00 ? moments.m10 / moments.m00 : width / 2,
              cy: moments.m00 ? moments.m01 / moments.m00 : height / 2,
              width: rectWidth,
              height: rectHeight,
              aspectRatio: Math.max(rectWidth / rectHeight, rectHeight / rectWidth),
              circularity: perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
              extent: area / Math.max(1, rectWidth * rectHeight)
            });
          }

          contour.delete();
        }

        return regions.length >= 2 ? regions : splitByAngle(analysisMask.data, analysisMask.cols, analysisMask.rows);
      } finally {
        src.delete();
        rgb.delete();
        hsv.delete();
        mask.delete();
        leafMask.delete();
        if (lower) lower.delete();
        if (upper) upper.delete();
        if (kernel) kernel.delete();
        if (leafKernel) leafKernel.delete();
        contours.delete();
        hierarchy.delete();
      }
    }

    self.onmessage = async event => {
      const message = event.data;

      if (message && message.type === 'warmup') {
        loadCv().catch(() => {});
        return;
      }

      if (!message || message.type !== 'analyze') {
        return;
      }

      try {
        const ready = await loadCv();
        const cv = ready.cv;
        const regions = analyzeWithOpenCv(cv, message);
        self.postMessage({ id: message.id, ok: true, regions });
      } catch (error) {
        self.postMessage({
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : 'OpenCV.js worker error'
        });
      }
    };
  `
}

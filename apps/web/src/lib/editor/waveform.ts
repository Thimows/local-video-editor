import type { RuntimeAsset } from "./types"

const WAVEFORM_PEAKS_PER_MINUTE = 3_600
const WAVEFORM_BAR_SPACING_PX = 2
const WAVEFORM_ZOOM_REFERENCE = 4
const WAVEFORM_MAX_BAR_SPACING_PX = 2
const WAVEFORM_MIN_BARS = 12
const WAVEFORM_MIN_ITEM_WIDTH = 14
const WAVEFORM_OVERSCAN_PX = 160
const WAVEFORM_CACHE_DB_NAME = "local-video-editor-waveforms"
const WAVEFORM_CACHE_DB_VERSION = 1
const WAVEFORM_CACHE_STORE = "waveforms"

let nextWaveformWorkerRequestId = 0
const inFlightWaveformExtractions = new Map<
  string,
  Promise<TimelineWaveformData | null>
>()

export type TimelineWaveform =
  | { status: "loading"; fingerprint: string }
  | {
      status: "ready"
      fingerprint: string
      peaks: Float32Array
      durationSeconds: number
      peaksPerMinute: number
    }
  | { status: "unavailable"; fingerprint: string }

export type TimelineWaveformMap = Record<string, TimelineWaveform>

export type TimelineItemWaveformBars = {
  totalBars: number
  bars: {
    index: number
    peak: number
  }[]
}

type TimelineWaveformData = {
  peaks: Float32Array
  durationSeconds: number
  peaksPerMinute: number
}

type StoredTimelineWaveformData = TimelineWaveformData & {
  key: string
  updatedAt: number
}

type ExtractTimelineWaveformOptions = {
  onProgress?: (waveform: TimelineWaveformData) => void
  signal?: AbortSignal
}

export function getRuntimeAssetFingerprint(runtimeAsset: RuntimeAsset) {
  return getFileFingerprint(runtimeAsset.file)
}

function getFileFingerprint(file: File) {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

export async function extractTimelineWaveform(
  file: File,
  options: ExtractTimelineWaveformOptions = {}
): Promise<TimelineWaveformData | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null
  }

  const cacheKey = getWaveformCacheKey(file)
  const cached = await getCachedTimelineWaveform(cacheKey)

  if (cached) {
    return cached
  }

  if (options.signal?.aborted) {
    return null
  }

  const existingExtraction = inFlightWaveformExtractions.get(cacheKey)

  if (existingExtraction) {
    return existingExtraction
  }

  const extraction = extractTimelineWaveformInWorker(file, options)
    .then(async (waveform) => {
      if (waveform) {
        await saveCachedTimelineWaveform(cacheKey, waveform)
      }

      return waveform
    })
    .finally(() => {
      inFlightWaveformExtractions.delete(cacheKey)
    })

  inFlightWaveformExtractions.set(cacheKey, extraction)

  return extraction
}

function extractTimelineWaveformInWorker(
  file: File,
  { onProgress, signal }: ExtractTimelineWaveformOptions
): Promise<TimelineWaveformData | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }

    const id = nextWaveformWorkerRequestId
    nextWaveformWorkerRequestId += 1
    const worker = new Worker(new URL("./waveform-worker.ts", import.meta.url), {
      type: "module",
    })

    function cleanup() {
      signal?.removeEventListener("abort", abort)
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      worker.terminate()
    }

    function abort() {
      cleanup()
      resolve(null)
    }

    function onError(event: ErrorEvent) {
      cleanup()
      reject(
        event.error instanceof Error ? event.error : new Error(event.message)
      )
    }

    function onMessage(
      event: MessageEvent<
        | {
            id: number
            type: "progress" | "done"
            peaks: Float32Array
            durationSeconds: number
            peaksPerMinute: number
          }
        | { id: number; type: "done"; peaks: null; durationSeconds: null }
        | { id: number; type: "error"; message: string }
      >
    ) {
      if (event.data.id !== id) {
        return
      }

      if (event.data.type === "progress") {
        onProgress?.({
          peaks: event.data.peaks,
          durationSeconds: event.data.durationSeconds,
          peaksPerMinute: event.data.peaksPerMinute,
        })
        return
      }

      cleanup()

      if (event.data.type === "error") {
        reject(new Error(event.data.message))
        return
      }

      if (!event.data.peaks || !event.data.durationSeconds) {
        resolve(null)
        return
      }

      resolve({
        peaks: event.data.peaks,
        durationSeconds: event.data.durationSeconds,
        peaksPerMinute: event.data.peaksPerMinute,
      })
    }

    signal?.addEventListener("abort", abort, { once: true })
    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    worker.postMessage({
      id,
      file,
      peaksPerMinute: WAVEFORM_PEAKS_PER_MINUTE,
    })
  })
}

export function getTimelineItemWaveformBars({
  peaks,
  durationSeconds,
  sourceStartSeconds,
  sourceEndSeconds,
  width,
  zoom,
  visibleStartPx,
  visibleEndPx,
}: {
  peaks: ArrayLike<number>
  durationSeconds: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  width: number
  zoom: number
  visibleStartPx: number
  visibleEndPx: number
}): TimelineItemWaveformBars {
  if (
    peaks.length === 0 ||
    width < WAVEFORM_MIN_ITEM_WIDTH ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return { totalBars: 0, bars: [] }
  }

  const startRatio = clamp(sourceStartSeconds / durationSeconds, 0, 1)
  const endRatio = clamp(sourceEndSeconds / durationSeconds, startRatio, 1)
  const startPeak = startRatio * peaks.length
  const endPeak = endRatio * peaks.length
  const sourcePeakCount = Math.max(1, Math.ceil(endPeak - startPeak))
  const barSpacing = getWaveformBarSpacing(zoom)
  const barCount = Math.floor(
    clamp(
      Math.floor(width / barSpacing),
      Math.min(WAVEFORM_MIN_BARS, sourcePeakCount),
      sourcePeakCount
    )
  )

  if (endRatio <= startRatio) {
    return { totalBars: barCount, bars: [] }
  }

  const visibleStart = visibleStartPx - WAVEFORM_OVERSCAN_PX
  const visibleEnd = visibleEndPx + WAVEFORM_OVERSCAN_PX

  if (visibleEnd <= 0 || visibleStart >= width) {
    return { totalBars: barCount, bars: [] }
  }

  const clampedVisibleStart = clamp(visibleStart, 0, width)
  const clampedVisibleEnd = clamp(visibleEnd, clampedVisibleStart, width)
  const firstBar = Math.floor((clampedVisibleStart / width) * barCount)
  const lastBar = Math.ceil((clampedVisibleEnd / width) * barCount)

  return {
    totalBars: barCount,
    bars: Array.from({ length: lastBar - firstBar }, (_, offset) => {
      const index = firstBar + offset
      const segmentStart =
        startPeak + ((endPeak - startPeak) * index) / barCount
      const segmentEnd =
        startPeak + ((endPeak - startPeak) * (index + 1)) / barCount

      return {
        index,
        peak: getWaveformPeakRange(peaks, segmentStart, segmentEnd),
      }
    }),
  }
}

function getWaveformBarSpacing(zoom: number) {
  return clamp(
    WAVEFORM_BAR_SPACING_PX * (WAVEFORM_ZOOM_REFERENCE / Math.max(zoom, 0.001)),
    WAVEFORM_BAR_SPACING_PX,
    WAVEFORM_MAX_BAR_SPACING_PX
  )
}

function getWaveformPeakRange(
  peaks: ArrayLike<number>,
  start: number,
  end: number
) {
  const startIndex = Math.max(0, Math.floor(start))
  const endIndex = Math.min(
    peaks.length,
    Math.max(startIndex + 1, Math.ceil(end))
  )
  let peak = 0

  for (let index = startIndex; index < endIndex; index += 1) {
    peak = Math.max(peak, peaks[index] ?? 0)
  }

  return peak
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getWaveformCacheKey(file: File) {
  return `${getFileFingerprint(file)}:density:${WAVEFORM_PEAKS_PER_MINUTE}ppm:mediabunny-v2`
}

async function getCachedTimelineWaveform(key: string) {
  try {
    const cached = await withWaveformStore<StoredTimelineWaveformData | undefined>(
      "readonly",
      (store) => store.get(key)
    )

    return cached
      ? {
          peaks:
            cached.peaks instanceof Float32Array
              ? cached.peaks
              : Float32Array.from(cached.peaks),
          durationSeconds: cached.durationSeconds,
          peaksPerMinute: cached.peaksPerMinute,
        }
      : null
  } catch {
    return null
  }
}

async function saveCachedTimelineWaveform(
  key: string,
  waveform: TimelineWaveformData
) {
  try {
    await withWaveformStore("readwrite", (store) =>
      store.put({
        key,
        peaks: waveform.peaks,
        durationSeconds: waveform.durationSeconds,
        peaksPerMinute: waveform.peaksPerMinute,
        updatedAt: Date.now(),
      } satisfies StoredTimelineWaveformData)
    )
  } catch {
    // Waveform caching is an optimization; extraction still works without it.
  }
}

function openWaveformDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      WAVEFORM_CACHE_DB_NAME,
      WAVEFORM_CACHE_DB_VERSION
    )

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(WAVEFORM_CACHE_STORE)) {
        db.createObjectStore(WAVEFORM_CACHE_STORE, { keyPath: "key" })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withWaveformStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return undefined
  }

  const db = await openWaveformDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WAVEFORM_CACHE_STORE, mode)
    const store = transaction.objectStore(WAVEFORM_CACHE_STORE)
    const request = callback(store)
    let result: T | undefined

    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => reject(request.error)
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

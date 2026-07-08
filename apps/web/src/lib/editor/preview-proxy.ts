import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny"

import type { RuntimeAsset, SourceAsset } from "./types"

export type PreviewProxyScale = 0.5

export type PreviewProxyFile = {
  file: File
  segmentIndex: number
  sourceEndSeconds: number
  sourceStartSeconds: number
}

const PREVIEW_PROXY_DIRECTORY = "preview-proxies"
const PREVIEW_PROXY_VERSION = "v6-segmented-mp4-avc-video-only-high-30fps"
const PREVIEW_PROXY_SEGMENT_DURATION_SECONDS = 30
const PREVIEW_PROXY_CHUNK_SIZE = 8 * 1024 * 1024
const PREVIEW_PROXY_EXTENSION = "mp4"
const PREVIEW_PROXY_MIME_TYPE = "video/mp4"
const PREVIEW_PROXY_FRAME_RATE = 30

type PreviewProxyProgressListener = (
  progress: number,
  processedTimeSeconds: number
) => void

type InFlightPreviewProxy = {
  job: QueuedPreviewProxyJob | null
  listeners: Set<PreviewProxyProgressListener>
  latestProgress: PreviewProxyProgress | null
  promise: Promise<PreviewProxyFile | null>
  priority: number
}

type PreviewProxyProgress = {
  progress: number
  processedTimeSeconds: number
}

type PreviewProxySegment = {
  index: number
  sourceEndSeconds: number
  sourceStartSeconds: number
}

type PreviewProxyDebugEntry = {
  assetId: string
  assetName: string
  cacheKey?: string
  durationSeconds?: number
  elapsedMs?: number
  errorMessage?: string
  errorName?: string
  outputSizeBytes?: number
  phase: string
  progress?: number
  processedTimeSeconds?: number
  scale: PreviewProxyScale
  segmentIndex?: number
  sourceEndSeconds?: number
  sourceSizeBytes: number
  sourceStartSeconds?: number
  timestamp: string
}

type QueuedPreviewProxyJob = {
  key: string
  priority: number
  reject: (reason: unknown) => void
  resolve: (file: PreviewProxyFile | null) => void
  run: () => Promise<PreviewProxyFile | null>
  sequence: number
}

const inFlightPreviewProxies = new Map<string, InFlightPreviewProxy>()
const queuedPreviewProxyJobs: QueuedPreviewProxyJob[] = []
let isPreviewProxyQueueRunning = false
let previewProxyJobSequence = 0

type EnsurePreviewProxyOptions = {
  asset: SourceAsset
  runtimeAsset: RuntimeAsset
  scale: PreviewProxyScale
  signal?: AbortSignal
  sourceTimeSeconds: number
  priority?: number
  onProgress?: PreviewProxyProgressListener
}

export function getSourceFileFingerprint(file: File) {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

export function getSourceAssetPreviewFingerprint(asset: SourceAsset) {
  return asset.fingerprint ?? getSourceAssetFallbackFingerprint(asset)
}

export function canCreatePreviewProxy(asset: SourceAsset) {
  return (
    asset.type === "video" &&
    typeof asset.width === "number" &&
    asset.width > 0 &&
    typeof asset.height === "number" &&
    asset.height > 0
  )
}

export function getPreviewProxySegmentIndex(sourceTimeSeconds: number) {
  return Math.max(
    0,
    Math.floor(sourceTimeSeconds / PREVIEW_PROXY_SEGMENT_DURATION_SECONDS)
  )
}

export function getPreviewProxySegmentBounds(
  asset: SourceAsset,
  segmentIndex: number
): PreviewProxySegment {
  const durationSeconds = Math.max(
    0,
    asset.durationSeconds ?? PREVIEW_PROXY_SEGMENT_DURATION_SECONDS
  )
  const sourceStartSeconds = Math.min(
    durationSeconds,
    segmentIndex * PREVIEW_PROXY_SEGMENT_DURATION_SECONDS
  )
  const sourceEndSeconds = Math.min(
    durationSeconds,
    sourceStartSeconds + PREVIEW_PROXY_SEGMENT_DURATION_SECONDS
  )

  return {
    index: segmentIndex,
    sourceEndSeconds,
    sourceStartSeconds,
  }
}

export function getPreviewProxySegmentCount(asset: SourceAsset) {
  return Math.max(
    1,
    Math.ceil(
      Math.max(0, asset.durationSeconds ?? PREVIEW_PROXY_SEGMENT_DURATION_SECONDS) /
        PREVIEW_PROXY_SEGMENT_DURATION_SECONDS
    )
  )
}

export function isSourceTimeInPreviewProxySegment(
  sourceTimeSeconds: number,
  entry: Pick<PreviewProxyFile, "sourceEndSeconds" | "sourceStartSeconds">
) {
  return (
    sourceTimeSeconds >= entry.sourceStartSeconds &&
    sourceTimeSeconds < entry.sourceEndSeconds
  )
}

export async function ensurePreviewProxy({
  asset,
  runtimeAsset,
  scale,
  signal,
  sourceTimeSeconds,
  priority = 100,
  onProgress,
}: EnsurePreviewProxyOptions) {
  if (!canCreatePreviewProxy(asset)) {
    return null
  }

  const segment = getPreviewProxySegmentBounds(
    asset,
    getPreviewProxySegmentIndex(sourceTimeSeconds)
  )

  if (segment.sourceEndSeconds <= segment.sourceStartSeconds) {
    return null
  }

  const cacheKey = await getPreviewProxyBaseCacheKey(asset, scale)
  const jobKey = getPreviewProxyJobKey(cacheKey, segment.index)
  const cached = await getCachedPreviewProxySegmentByKey(cacheKey, segment)
  publishPreviewProxyDebug(
    "request",
    { asset, cacheKey, scale, segment },
    { progress: 0 }
  )

  if (cached || signal?.aborted) {
    if (cached) {
      publishPreviewProxyDebug(
        "cache-hit",
        { asset, cacheKey, scale, segment },
        { outputSizeBytes: cached.file.size, progress: 1 }
      )
    }
    return cached
  }

  const existing = inFlightPreviewProxies.get(jobKey)

  if (existing) {
    promotePreviewProxyJob(existing, priority)
    return subscribeToInFlightPreviewProxy(existing, onProgress)
  }

  const listeners = new Set<PreviewProxyProgressListener>()
  const startedAt = performance.now()
  const inFlight: InFlightPreviewProxy = {
    job: null,
    listeners,
    latestProgress: null,
    promise: Promise.resolve(null),
    priority,
  }

  if (onProgress) {
    listeners.add(onProgress)
  }

  publishPreviewProxyDebug(
    "queued",
    { asset, cacheKey, scale, segment },
    { elapsedMs: 0, progress: 0 }
  )

  const creation = enqueuePreviewProxyJob(jobKey, inFlight, async () => {
    publishPreviewProxyDebug(
      "start",
      { asset, cacheKey, scale, segment },
      { elapsedMs: performance.now() - startedAt, progress: 0 }
    )

    return createPreviewProxySegment({
      asset,
      cacheKey,
      runtimeAsset,
      scale,
      segment,
      signal,
      onProgress: (progress, processedTimeSeconds) => {
        inFlight.latestProgress = { progress, processedTimeSeconds }

        for (const listener of inFlight.listeners) {
          listener(progress, processedTimeSeconds)
        }

        publishPreviewProxyDebug(
          "progress",
          { asset, cacheKey, scale, segment },
          {
            elapsedMs: performance.now() - startedAt,
            processedTimeSeconds,
            progress,
          },
          false
        )
      },
    })
  })
    .then((file) => {
      publishPreviewProxyDebug(
        file ? "complete" : "cancelled",
        { asset, cacheKey, scale, segment },
        {
          elapsedMs: performance.now() - startedAt,
          outputSizeBytes: file?.file.size,
          progress: file ? 1 : inFlight.latestProgress?.progress,
          processedTimeSeconds: inFlight.latestProgress?.processedTimeSeconds,
        }
      )

      return file
    })
    .catch((reason) => {
      publishPreviewProxyDebug(
        "error",
        { asset, cacheKey, scale, segment },
        {
          elapsedMs: performance.now() - startedAt,
          errorMessage: getErrorMessage(reason),
          errorName: getErrorName(reason),
          progress: inFlight.latestProgress?.progress,
          processedTimeSeconds: inFlight.latestProgress?.processedTimeSeconds,
        }
      )

      throw reason
    })
    .finally(() => {
      inFlight.job = null
      inFlightPreviewProxies.delete(jobKey)
      listeners.clear()
    })

  inFlight.promise = creation

  inFlightPreviewProxies.set(jobKey, inFlight)

  return subscribeToInFlightPreviewProxy(inFlight, onProgress)
}

export async function deletePreviewProxiesForAssets(assets: SourceAsset[]) {
  const directory = await getPreviewProxyDirectory(false).catch(() => null)

  if (!directory) {
    return
  }

  await Promise.all(
    assets.map(async (asset) => {
      const cacheKey = await getPreviewProxyBaseCacheKey(asset, 0.5)

      await directory.removeEntry(cacheKey, { recursive: true }).catch(() => undefined)
    })
  )
}

async function createPreviewProxySegment({
  asset,
  cacheKey,
  runtimeAsset,
  scale,
  segment,
  signal,
  onProgress,
}: Omit<EnsurePreviewProxyOptions, "sourceTimeSeconds"> & {
  cacheKey: string
  segment: PreviewProxySegment
}) {
  const directory = await getPreviewProxyCacheDirectory(cacheKey, true)
  const fileName = getProxySegmentFileName(segment.index)
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable?.()

  if (!writable) {
    return null
  }

  const input = new Input({
    source: new BlobSource(runtimeAsset.file),
    formats: ALL_FORMATS,
  })
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: "fragmented",
      minimumFragmentDuration: 1,
    }),
    target: new StreamTarget(writable as WritableStream<StreamTargetChunk>, {
      chunkSize: PREVIEW_PROXY_CHUNK_SIZE,
      chunked: true,
    }),
  })
  const dimensions = getPreviewProxyDimensions(asset, scale)
  let conversion: Conversion | null = null

  function abortConversion() {
    conversion?.cancel().catch(() => undefined)
  }

  signal?.addEventListener("abort", abortConversion, { once: true })

  try {
    if (signal?.aborted) {
      return null
    }

    publishPreviewProxyDebug("init", { asset, cacheKey, scale, segment }, { progress: 0 })

    conversion = await Conversion.init({
      input,
      output,
      audio: { discard: true },
      trim: {
        end: segment.sourceEndSeconds,
        start: segment.sourceStartSeconds,
      },
      video: {
        ...dimensions,
        bitrate: QUALITY_HIGH,
        codec: "avc",
        fit: "contain",
        forceTranscode: true,
        frameRate: PREVIEW_PROXY_FRAME_RATE,
        hardwareAcceleration: "prefer-hardware",
        keyFrameInterval: 1,
      },
    })

    if (!conversion.isValid) {
      throw new Error("This browser could not create a preview proxy.")
    }

    publishPreviewProxyDebug("execute", { asset, cacheKey, scale, segment }, { progress: 0 })

    conversion.onProgress = (progress, processedTimeSeconds) =>
      onProgress?.(progress, processedTimeSeconds)
    await conversion.execute()

    if (signal?.aborted) {
      return null
    }

    const file = await fileHandle.getFile()

    if (file.size === 0) {
      throw new Error("Preview proxy generation produced an empty file.")
    }

    await writeProxySegmentMarker(directory, segment)

    return withProxyFileMetadata(file, segment)
  } catch (reason) {
    await Promise.all([
      directory.removeEntry(fileName).catch(() => undefined),
      directory
        .removeEntry(getProxySegmentMarkerFileName(segment.index))
        .catch(() => undefined),
    ])

    if (
      reason instanceof ConversionCanceledError ||
      signal?.aborted ||
      isAbortError(reason)
    ) {
      return null
    }

    throw reason
  } finally {
    signal?.removeEventListener("abort", abortConversion)
    input.dispose()
  }
}

function subscribeToInFlightPreviewProxy(
  inFlight: InFlightPreviewProxy,
  onProgress?: PreviewProxyProgressListener
) {
  if (!onProgress) {
    return inFlight.promise
  }

  inFlight.listeners.add(onProgress)

  if (inFlight.latestProgress) {
    onProgress(
      inFlight.latestProgress.progress,
      inFlight.latestProgress.processedTimeSeconds
    )
  }

  return inFlight.promise.finally(() => {
    inFlight.listeners.delete(onProgress)
  })
}

function enqueuePreviewProxyJob(
  key: string,
  inFlight: InFlightPreviewProxy,
  run: () => Promise<PreviewProxyFile | null>
) {
  return new Promise<PreviewProxyFile | null>((resolve, reject) => {
    const job: QueuedPreviewProxyJob = {
      key,
      priority: inFlight.priority,
      reject,
      resolve,
      run,
      sequence: previewProxyJobSequence++,
    }

    inFlight.job = job
    queuedPreviewProxyJobs.push(job)
    sortPreviewProxyQueue()
    drainPreviewProxyQueue()
  })
}

function promotePreviewProxyJob(
  inFlight: InFlightPreviewProxy,
  priority: number
) {
  if (priority <= inFlight.priority) {
    return
  }

  inFlight.priority = priority

  if (inFlight.job) {
    inFlight.job.priority = priority
    sortPreviewProxyQueue()
  }
}

function sortPreviewProxyQueue() {
  queuedPreviewProxyJobs.sort(
    (a, b) => b.priority - a.priority || a.sequence - b.sequence
  )
}

function drainPreviewProxyQueue() {
  if (isPreviewProxyQueueRunning) {
    return
  }

  const job = queuedPreviewProxyJobs.shift()

  if (!job) {
    return
  }

  isPreviewProxyQueueRunning = true
  job
    .run()
    .then(job.resolve, job.reject)
    .finally(() => {
      isPreviewProxyQueueRunning = false
      drainPreviewProxyQueue()
    })
}

async function getCachedPreviewProxySegmentByKey(
  cacheKey: string,
  segment: PreviewProxySegment
) {
  const directory = await getPreviewProxyCacheDirectory(cacheKey, false).catch(
    () => null
  )

  if (!directory) {
    return null
  }

  const markerHandle = await directory
    .getFileHandle(getProxySegmentMarkerFileName(segment.index))
    .catch(() => null)

  if (!markerHandle) {
    await directory
      .removeEntry(getProxySegmentFileName(segment.index))
      .catch(() => undefined)
    return null
  }

  const fileHandle = await directory
    .getFileHandle(getProxySegmentFileName(segment.index))
    .catch(() => null)

  if (!fileHandle) {
    await directory
      .removeEntry(getProxySegmentMarkerFileName(segment.index))
      .catch(() => undefined)
    return null
  }

  const file = await fileHandle.getFile()

  if (file.size === 0) {
    await Promise.all([
      directory
        .removeEntry(getProxySegmentFileName(segment.index))
        .catch(() => undefined),
      directory
        .removeEntry(getProxySegmentMarkerFileName(segment.index))
        .catch(() => undefined),
    ])
    return null
  }

  return withProxyFileMetadata(file, segment)
}

async function getPreviewProxyDirectory(create: boolean) {
  const root = await navigator.storage?.getDirectory?.()

  if (!root) {
    throw new Error("OPFS is not available in this browser.")
  }

  return root.getDirectoryHandle(PREVIEW_PROXY_DIRECTORY, { create })
}

async function getPreviewProxyCacheDirectory(cacheKey: string, create: boolean) {
  const directory = await getPreviewProxyDirectory(create)

  return directory.getDirectoryHandle(cacheKey, { create })
}

async function writeProxySegmentMarker(
  directory: FileSystemDirectoryHandle,
  segment: PreviewProxySegment
) {
  const markerHandle = await directory.getFileHandle(
    getProxySegmentMarkerFileName(segment.index),
    { create: true }
  )
  const writable = await markerHandle.createWritable?.()

  if (!writable) {
    return
  }

  await new Blob([
    JSON.stringify({
      completedAt: Date.now(),
      segment,
      version: PREVIEW_PROXY_VERSION,
    }),
  ])
    .stream()
    .pipeTo(writable as unknown as WritableStream<Uint8Array>)
}

async function getPreviewProxyBaseCacheKey(
  asset: SourceAsset,
  scale: PreviewProxyScale
) {
  const fingerprint = getSourceAssetPreviewFingerprint(asset)
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${PREVIEW_PROXY_VERSION}:${scale}:${fingerprint}`)
  )

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function getSourceAssetFallbackFingerprint(asset: SourceAsset) {
  return [
    asset.type,
    asset.name,
    asset.sizeBytes,
    Math.round((asset.durationSeconds ?? 0) * 1000),
    asset.width ?? "",
    asset.height ?? "",
  ].join(":")
}

function getPreviewProxyDimensions(asset: SourceAsset, scale: PreviewProxyScale) {
  return {
    height: getEvenDimension(Math.max(2, Math.round((asset.height ?? 2) * scale))),
    width: getEvenDimension(Math.max(2, Math.round((asset.width ?? 2) * scale))),
  }
}

function getEvenDimension(value: number) {
  return Math.max(2, value - (value % 2))
}

function getPreviewProxyJobKey(cacheKey: string, segmentIndex: number) {
  return `${cacheKey}:${segmentIndex}`
}

function getProxySegmentFileName(segmentIndex: number) {
  return `${segmentIndex}.${PREVIEW_PROXY_EXTENSION}`
}

function getProxySegmentMarkerFileName(segmentIndex: number) {
  return `${segmentIndex}.complete`
}

function withProxyFileMetadata(
  file: File,
  segment: PreviewProxySegment
): PreviewProxyFile {
  const proxyFile =
    file.type === PREVIEW_PROXY_MIME_TYPE
      ? file
      : new File([file], file.name, { type: PREVIEW_PROXY_MIME_TYPE })

  return {
    file: proxyFile,
    segmentIndex: segment.index,
    sourceEndSeconds: segment.sourceEndSeconds,
    sourceStartSeconds: segment.sourceStartSeconds,
  }
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError"
}

function publishPreviewProxyDebug(
  phase: string,
  context: {
    asset: SourceAsset
    cacheKey?: string
    scale: PreviewProxyScale
    segment?: PreviewProxySegment
  },
  patch: Partial<
    Pick<
      PreviewProxyDebugEntry,
      | "elapsedMs"
      | "errorMessage"
      | "errorName"
      | "outputSizeBytes"
      | "processedTimeSeconds"
      | "progress"
    >
  > = {},
  shouldLog = true
) {
  if (typeof window === "undefined") {
    return
  }

  const entry: PreviewProxyDebugEntry = {
    assetId: context.asset.id,
    assetName: context.asset.name,
    cacheKey: context.cacheKey,
    durationSeconds: context.asset.durationSeconds,
    phase,
    scale: context.scale,
    segmentIndex: context.segment?.index,
    sourceEndSeconds: context.segment?.sourceEndSeconds,
    sourceSizeBytes: context.asset.sizeBytes,
    sourceStartSeconds: context.segment?.sourceStartSeconds,
    timestamp: new Date().toISOString(),
    ...patch,
  }
  const debugState = (window.__LOCAL_VIDEO_EDITOR_PROXY_DEBUG__ ??= {
    active: {},
    history: [],
  })
  const activeKey =
    context.cacheKey && context.segment
      ? getPreviewProxyJobKey(context.cacheKey, context.segment.index)
      : context.cacheKey ?? `${context.asset.id}:${String(context.scale)}`

  debugState.active[activeKey] = entry
  debugState.history = [...debugState.history.slice(-99), entry]

  if (shouldLog) {
    console.debug("[preview-proxy]", entry)
  }
}

function getErrorName(reason: unknown) {
  return reason instanceof Error ? reason.name : undefined
}

function getErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

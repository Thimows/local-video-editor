import {
  ALL_FORMATS,
  BlobSource,
  Input,
  type VideoSample,
  VideoSampleSink,
} from "mediabunny"

import { getClipDuration } from "../project"
import type { RuntimeAssetMap, TimelineClip } from "../types"
import {
  clamp,
  EXPORT_EDGE_SAMPLE_SECONDS,
  getTrackIndex,
  throwIfAborted,
} from "./shared"

type ExportVideoSource = {
  input: Input
  readSample: (
    timestampSeconds: number,
    signal: AbortSignal,
    mode?: VideoSampleReadMode
  ) => Promise<VideoSample | null>
  close: () => void
}

export type VideoSampleReadMode = "sequential" | "sparse"

export type ClipNode = {
  clip: TimelineClip
  sample: VideoSample | null
  sourcePromise: Promise<ExportVideoSource | null>
  ready: boolean
}

const EXPORT_MEDIA_PRELOAD_SECONDS = 1.5
const EXPORT_MEDIA_POSTROLL_SECONDS = 0.35
const SEQUENTIAL_SAMPLE_RESET_SECONDS = 0.75

export async function prepareExportVideoWindow({
  clipNodes,
  clips,
  runtimeAssets,
  sampleReadMode = "sequential",
  signal,
  sourceSignal = signal,
  timelineSeconds,
}: {
  clipNodes: Map<string, ClipNode>
  clips: TimelineClip[]
  runtimeAssets: RuntimeAssetMap
  sampleReadMode?: VideoSampleReadMode
  signal: AbortSignal
  sourceSignal?: AbortSignal
  timelineSeconds: number
}) {
  const neededClipIds = new Set<string>()

  for (const clip of clips) {
    if (!isWithinExportMediaWindow(clip, timelineSeconds)) {
      continue
    }

    const runtimeAsset = runtimeAssets[clip.sourceAssetId]

    if (!runtimeAsset) {
      throw new Error("Reconnect all source video files before exporting.")
    }

    neededClipIds.add(clip.id)

    const node =
      clipNodes.get(clip.id) ??
      createClipNode({
        clip,
        file: runtimeAsset.file,
        signal: sourceSignal,
      })

    clipNodes.set(clip.id, node)
    node.clip = clip

    if (isActiveAt(clip, timelineSeconds)) {
      await syncClipNode({
        node,
        sampleReadMode,
        signal,
        timelineSeconds,
      })
    }
  }

  for (const [id, node] of clipNodes) {
    if (!neededClipIds.has(id)) {
      disposeClipNode(node)
      clipNodes.delete(id)
    }
  }
}

export function drawTimelineFrame({
  background = "#000",
  canvas,
  clipNodes,
  context,
  timelineSeconds,
}: {
  background?: string | null
  canvas: HTMLCanvasElement
  clipNodes: ClipNode[]
  context: CanvasRenderingContext2D
  timelineSeconds: number
}) {
  if (background === null) {
    context.clearRect(0, 0, canvas.width, canvas.height)
  } else {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  const activeClips = clipNodes
    .filter(({ clip }) => isActiveAt(clip, timelineSeconds))
    .sort((a, b) => getTrackIndex(b.clip) - getTrackIndex(a.clip))

  for (const { clip, sample } of activeClips) {
    if (sample) {
      drawTransformedSource(context, sample, canvas.width, canvas.height, clip)
    }
  }
}

export function closeCurrentVideoSamples(nodes: Map<string, ClipNode>) {
  for (const node of nodes.values()) {
    node.sample?.close()
    node.sample = null
  }
}

export function disposeClipNodes(nodes: Map<string, ClipNode>) {
  for (const node of nodes.values()) {
    disposeClipNode(node)
  }

  nodes.clear()
}

function createClipNode({
  clip,
  file,
  signal,
}: {
  clip: TimelineClip
  file: File
  signal: AbortSignal
}) {
  const node: ClipNode = {
    clip,
    ready: false,
    sample: null,
    sourcePromise: Promise.resolve(null),
  }

  node.sourcePromise = createExportVideoSource(file, signal).then((source) => {
    node.ready = Boolean(source)

    return source
  })
  node.sourcePromise.catch(() => undefined)

  return node
}

async function syncClipNode({
  node,
  sampleReadMode,
  signal,
  timelineSeconds,
}: {
  node: ClipNode
  sampleReadMode: VideoSampleReadMode
  signal: AbortSignal
  timelineSeconds: number
}) {
  const source = await node.sourcePromise

  if (!node.ready || !source || signal.aborted) {
    return
  }

  node.sample?.close()
  node.sample = await source.readSample(
    getSourceTimeForTimelineItem(node.clip, timelineSeconds),
    signal,
    sampleReadMode
  )
}

async function createExportVideoSource(
  file: File,
  signal: AbortSignal
): Promise<ExportVideoSource | null> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })

  try {
    throwIfAborted(signal)
    const videoTrack = await input.getPrimaryVideoTrack()

    if (!videoTrack || !(await videoTrack.canDecode())) {
      input.dispose()
      return null
    }

    const sink = new VideoSampleSink(videoTrack, {
      optimizeForLatency: true,
    })
    const reader = createExportVideoSampleReader(sink)

    return {
      input,
      readSample: reader.readSample,
      close: () => {
        reader.close()
        input.dispose()
      },
    }
  } catch (reason) {
    input.dispose()
    throw reason
  }
}

function createExportVideoSampleReader(sink: VideoSampleSink) {
  let iterator: AsyncIterator<VideoSample> | null = null
  let sparseIterator: AsyncIterator<VideoSample | null> | null = null
  let currentSample: VideoSample | null = null
  let nextSample: VideoSample | null = null
  let lastTimestamp = -Infinity
  let closed = false
  let readQueue = Promise.resolve()

  function resetIterator() {
    currentSample?.close()
    nextSample?.close()
    currentSample = null
    nextSample = null
    iterator?.return?.().catch(() => undefined)
    iterator = null
  }

  function resetSparseIterator() {
    sparseIterator?.return?.().catch(() => undefined)
    sparseIterator = null
  }

  async function readNextSample() {
    if (!iterator) {
      return null
    }

    const result = await iterator.next()

    return result.done ? null : result.value
  }

  async function readSparseSample(timestampSeconds: number, signal: AbortSignal) {
    if (closed) {
      return null
    }

    resetIterator()
    resetSparseIterator()
    throwIfAborted(signal)

    const activeIterator = sink
      .samplesAtTimestamps([timestampSeconds], {
        skipLiveWait: true,
      })
      [Symbol.asyncIterator]()
    sparseIterator = activeIterator
    let sample: VideoSample | null = null
    let sampleClone: VideoSample | null = null

    function onAbort() {
      activeIterator.return?.().catch(() => undefined)
    }

    signal.addEventListener("abort", onAbort, { once: true })

    try {
      const result = await activeIterator.next()
      sample = result.done ? null : result.value
      sampleClone = sample?.clone() ?? null
      sample?.close()
      sample = null
      throwIfAborted(signal)

      return sampleClone
    } catch (reason) {
      sample?.close()
      sampleClone?.close()
      throw reason
    } finally {
      signal.removeEventListener("abort", onAbort)
      activeIterator.return?.().catch(() => undefined)

      if (sparseIterator === activeIterator) {
        sparseIterator = null
      }
    }
  }

  function readSequentialSample(timestampSeconds: number, signal: AbortSignal) {
    const read = readQueue.then(async () => {
      if (closed) {
        return null
      }

      function onAbort() {
        resetIterator()
      }

      signal.addEventListener("abort", onAbort, { once: true })

      try {
        throwIfAborted(signal)

        if (
          !iterator ||
          timestampSeconds + EXPORT_EDGE_SAMPLE_SECONDS < lastTimestamp ||
          timestampSeconds - lastTimestamp > SEQUENTIAL_SAMPLE_RESET_SECONDS
        ) {
          resetIterator()
          iterator = sink
            .samples(
              Math.max(0, timestampSeconds - EXPORT_EDGE_SAMPLE_SECONDS),
              undefined,
              {
                skipLiveWait: true,
              }
            )
            [Symbol.asyncIterator]()
          currentSample = await readNextSample()
          throwIfAborted(signal)
          nextSample = await readNextSample()
          throwIfAborted(signal)
        }

        lastTimestamp = timestampSeconds

        while (
          nextSample &&
          nextSample.timestamp <= timestampSeconds + EXPORT_EDGE_SAMPLE_SECONDS
        ) {
          currentSample?.close()
          currentSample = nextSample
          nextSample = await readNextSample()
          throwIfAborted(signal)
        }

        throwIfAborted(signal)

        return currentSample?.clone() ?? null
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    })

    readQueue = read.then(
      () => undefined,
      () => undefined
    )

    return read
  }

  function readSample(
    timestampSeconds: number,
    signal: AbortSignal,
    mode: VideoSampleReadMode = "sequential"
  ) {
    return mode === "sparse"
      ? readSparseSample(timestampSeconds, signal)
      : readSequentialSample(timestampSeconds, signal)
  }

  return {
    readSample,
    close: () => {
      closed = true
      resetIterator()
      resetSparseIterator()
    },
  }
}

function drawTransformedSource(
  context: CanvasRenderingContext2D,
  sample: VideoSample,
  width: number,
  height: number,
  clip: TimelineClip
) {
  const videoRatio = sample.displayWidth / sample.displayHeight || width / height
  const frameRatio = width / height
  const baseWidth = videoRatio >= frameRatio ? width : height * videoRatio
  const baseHeight = videoRatio >= frameRatio ? width / videoRatio : height
  const scale = getClipScale(clip)
  const drawWidth = baseWidth * scale
  const drawHeight = baseHeight * scale
  const x =
    (width - drawWidth) / 2 + (getClipPositionX(clip) / 100) * width
  const y =
    (height - drawHeight) / 2 + (getClipPositionY(clip) / 100) * height

  sample.draw(context, x, y, drawWidth, drawHeight)
}

function disposeClipNode(node: ClipNode) {
  node.sample?.close()
  node.sample = null
  node.sourcePromise
    .then((source) => source?.close())
    .catch(() => undefined)
}

function isActiveAt(
  item: {
    sourceStartSeconds: number
    sourceEndSeconds: number
    timelineStartSeconds: number
  },
  seconds: number
) {
  const start = item.timelineStartSeconds
  const end = item.timelineStartSeconds + getClipDuration(item)

  return seconds >= start && seconds < end
}

function isWithinExportMediaWindow(
  item: {
    sourceStartSeconds: number
    sourceEndSeconds: number
    timelineStartSeconds: number
  },
  seconds: number
) {
  const start = item.timelineStartSeconds
  const end = item.timelineStartSeconds + getClipDuration(item)

  return (
    seconds + EXPORT_MEDIA_PRELOAD_SECONDS >= start &&
    seconds <= end + EXPORT_MEDIA_POSTROLL_SECONDS
  )
}

function getSourceTimeForTimelineItem(
  item: {
    sourceStartSeconds: number
    sourceEndSeconds: number
    timelineStartSeconds: number
  },
  timelineSeconds: number
) {
  const itemOffset = clamp(
    timelineSeconds - item.timelineStartSeconds,
    0,
    getClipDuration(item)
  )
  const sourceTime = item.sourceStartSeconds + itemOffset
  const maxPreviewSourceTime = Math.max(
    item.sourceStartSeconds,
    item.sourceEndSeconds - EXPORT_EDGE_SAMPLE_SECONDS
  )

  return clamp(sourceTime, item.sourceStartSeconds, maxPreviewSourceTime)
}

function getClipScale(clip: { scale?: number }) {
  return Math.min(2, Math.max(0, clip.scale ?? 1))
}

function getClipPositionX(clip: { positionX?: number }) {
  return Math.min(100, Math.max(-100, clip.positionX ?? 0))
}

function getClipPositionY(clip: { positionY?: number }) {
  return Math.min(100, Math.max(-100, clip.positionY ?? 0))
}

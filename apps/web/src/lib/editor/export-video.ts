import {
  ALL_FORMATS,
  AudioBufferSource,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  type AudioCodec,
  type AudioSample,
  type StreamTargetChunk,
  type VideoSample,
  VideoSampleSink,
  type VideoCodec,
} from "mediabunny"

import { getClipDuration, getProjectDuration } from "./project"
import type {
  ExportFormat,
  MusicTrack,
  Project,
  RuntimeAssetMap,
  TimelineClip,
} from "./types"

type ExportProgress = {
  progress: number
  message: string
}

type ExportOptions = {
  project: Project
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}

type ExportResult = {
  blob: Blob
  cleanup: () => Promise<void>
  extension: ExportFormat
  mimeType: string
}

type ClipNode = {
  clip: TimelineClip
  sample: VideoSample | null
  sourcePromise: Promise<ExportVideoSource | null>
  ready: boolean
}

type ExportAudioItem = TimelineClip | MusicTrack

type ExportAudioSource = {
  input: Input
  sink: AudioSampleSink
}

type ExportVideoSource = {
  input: Input
  readSample: (
    timestampSeconds: number,
    signal: AbortSignal
  ) => Promise<VideoSample | null>
  close: () => void
}

type ExportOutputTarget = {
  target: StreamTarget | BufferTarget
  getBlob: (mimeType: string) => Promise<Blob>
  cleanup: () => Promise<void>
}

type ExportFormatConfig = {
  audioCodec: AudioCodec
  extension: ExportFormat
  mimeType: string
  outputFormat: Mp4OutputFormat | WebMOutputFormat
  videoCodec: VideoCodec
}

const EXPORT_MEDIA_PRELOAD_SECONDS = 1.5
const EXPORT_MEDIA_POSTROLL_SECONDS = 0.35
const EXPORT_EDGE_SAMPLE_SECONDS = 1 / 60
const EXPORT_AUDIO_SAMPLE_RATE = 48_000
const EXPORT_AUDIO_CHANNELS = 2
const EXPORT_AUDIO_CHUNK_SECONDS = 0.5
const EXPORT_AUDIO_LOOKAHEAD_SECONDS = 1
const EXPORT_OPFS_CHUNK_SIZE = 8 * 1024 * 1024

export async function exportProjectToVideo({
  project,
  runtimeAssets,
  signal,
  onProgress,
}: ExportOptions): Promise<ExportResult> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs video export is not supported in this browser.")
  }

  const clips = [...project.clips].sort(
    (a, b) =>
      a.timelineStartSeconds - b.timelineStartSeconds ||
      getTrackIndex(b) - getTrackIndex(a)
  )
  const totalDuration = getProjectDuration(project)
  const timelineItems = [...project.clips, ...project.musicTracks]
  const hasAudioTrack = timelineItems.some(isAudibleTimelineItem)

  if (hasAudioTrack && typeof AudioEncoder === "undefined") {
    throw new Error("WebCodecs audio export is not supported in this browser.")
  }

  if (timelineItems.length === 0 || totalDuration <= 0) {
    throw new Error("Add at least one timeline item before exporting.")
  }

  for (const item of timelineItems) {
    if (!runtimeAssets[item.sourceAssetId]) {
      throw new Error("Reconnect all source files before exporting.")
    }
  }

  const config = getExportFormatConfig(project.exportSettings.format)
  const canvas = document.createElement("canvas")
  canvas.width = project.exportSettings.width
  canvas.height = project.exportSettings.height
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Canvas export is not available in this browser.")
  }

  const outputTarget = await createExportOutputTarget(config.extension)
  const output = new Output({
    format: config.outputFormat,
    target: outputTarget.target,
  })
  const videoSource = new CanvasSource(canvas, {
    codec: config.videoCodec,
    bitrate: project.exportSettings.videoBitsPerSecond || QUALITY_HIGH,
    keyFrameInterval: 2,
  })
  const audioSource = hasAudioTrack
    ? new AudioBufferSource({
        codec: config.audioCodec,
        bitrate: project.exportSettings.audioBitsPerSecond || QUALITY_HIGH,
        transform: {
          numberOfChannels: EXPORT_AUDIO_CHANNELS,
          sampleFormat: "f32",
          sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        },
      })
    : null
  const clipNodes = new Map<string, ClipNode>()
  const audioSources = new Map<string, Promise<ExportAudioSource | null>>()
  let outputStarted = false
  let outputFinalized = false
  let exportCompleted = false

  output.addVideoTrack(videoSource, {
    frameRate: project.exportSettings.fps,
  })

  if (audioSource) {
    output.addAudioTrack(audioSource)
  }

  try {
    onProgress({ progress: 0, message: "Preparing local encoder" })
    await output.start()
    outputStarted = true
    const mimeTypePromise = output.getMimeType()
    const frameDuration = 1 / project.exportSettings.fps
    const frameCount = Math.ceil(totalDuration * project.exportSettings.fps)
    const keyFrameInterval = Math.max(
      1,
      Math.round(project.exportSettings.fps * 2)
    )
    let nextAudioTime = 0

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(signal)
      const timelineSeconds = Math.min(frameIndex * frameDuration, totalDuration)

      if (audioSource) {
        if (frameIndex === 0) {
          onProgress({ progress: 0.01, message: "Preparing export audio" })
        }

        const audioUntilSeconds = getNextAudioChunkEndSeconds(
          timelineSeconds,
          totalDuration
        )

        nextAudioTime = await addAudioChunksUntil({
          audioSource,
          audioSources,
          project,
          runtimeAssets,
          signal,
          startSeconds: nextAudioTime,
          untilSeconds: audioUntilSeconds,
        })
      }

      if (frameIndex === 0) {
        onProgress({ progress: 0.02, message: "Preparing first video frame" })
      }

      await prepareExportVideoWindow({
        clipNodes,
        clips,
        runtimeAssets,
        signal,
        timelineSeconds,
      })
      drawTimelineFrame({
        canvas,
        clipNodes: Array.from(clipNodes.values()),
        context,
        timelineSeconds,
      })
      closeCurrentVideoSamples(clipNodes)
      await videoSource.add(timelineSeconds, frameDuration, {
        keyFrame: frameIndex % keyFrameInterval === 0,
      })

      if (frameIndex % 5 === 0) {
        onProgress({
          progress: Math.min(0.98, timelineSeconds / totalDuration),
          message: `Encoding ${Math.round(timelineSeconds)}s of ${Math.round(
            totalDuration
          )}s`,
        })
      }

      if (frameIndex % 8 === 0) {
        await yieldToBrowser(signal)
      }
    }

    if (audioSource) {
      await addAudioChunksUntil({
        audioSource,
        audioSources,
        project,
        runtimeAssets,
        signal,
        startSeconds: nextAudioTime,
        untilSeconds: totalDuration,
      })
      audioSource.close()
    }

    videoSource.close()
    onProgress({ progress: 0.99, message: "Finalizing local file" })
    await output.finalize()
    outputFinalized = true
    const mimeType = await mimeTypePromise.catch(() => config.mimeType)
    const blob = await outputTarget.getBlob(mimeType)

    exportCompleted = true
    onProgress({ progress: 1, message: "Export ready" })

    return {
      blob,
      cleanup: outputTarget.cleanup,
      extension: config.extension,
      mimeType,
    }
  } catch (reason) {
    if (outputStarted && !outputFinalized) {
      await output.cancel().catch(() => undefined)
    }

    throw reason
  } finally {
    disposeClipNodes(clipNodes)
    await disposeExportAudioSources(audioSources)

    if (!exportCompleted) {
      await outputTarget.cleanup()
    }
  }
}

async function prepareExportVideoWindow({
  clipNodes,
  clips,
  runtimeAssets,
  signal,
  timelineSeconds,
}: {
  clipNodes: Map<string, ClipNode>
  clips: TimelineClip[]
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
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
        signal,
      })

    clipNodes.set(clip.id, node)
    node.clip = clip

    if (isActiveAt(clip, timelineSeconds)) {
      await syncClipNode({
        node,
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
  signal,
  timelineSeconds,
}: {
  node: ClipNode
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
    signal
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

  async function readNextSample() {
    if (!iterator) {
      return null
    }

    const result = await iterator.next()

    return result.done ? null : result.value
  }

  function readSample(timestampSeconds: number, signal: AbortSignal) {
    const read = readQueue.then(async () => {
      if (closed) {
        return null
      }

      throwIfAborted(signal)

      if (!iterator || timestampSeconds + EXPORT_EDGE_SAMPLE_SECONDS < lastTimestamp) {
        resetIterator()
        iterator = sink
          .samples(Math.max(0, timestampSeconds - EXPORT_EDGE_SAMPLE_SECONDS), undefined, {
            skipLiveWait: true,
          })
          [Symbol.asyncIterator]()
        currentSample = await readNextSample()
        nextSample = await readNextSample()
      }

      lastTimestamp = timestampSeconds

      while (
        nextSample &&
        nextSample.timestamp <= timestampSeconds + EXPORT_EDGE_SAMPLE_SECONDS
      ) {
        currentSample?.close()
        currentSample = nextSample
        nextSample = await readNextSample()
      }

      throwIfAborted(signal)

      return currentSample?.clone() ?? null
    })

    readQueue = read.then(
      () => undefined,
      () => undefined
    )

    return read
  }

  return {
    readSample,
    close: () => {
      closed = true
      resetIterator()
    },
  }
}

async function addAudioChunksUntil({
  audioSource,
  audioSources,
  project,
  runtimeAssets,
  signal,
  startSeconds,
  untilSeconds,
}: {
  audioSource: AudioBufferSource
  audioSources: Map<string, Promise<ExportAudioSource | null>>
  project: Project
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
  startSeconds: number
  untilSeconds: number
}) {
  let nextStart = startSeconds

  while (nextStart < untilSeconds - 0.000_001) {
    throwIfAborted(signal)
    const durationSeconds = Math.min(
      EXPORT_AUDIO_CHUNK_SECONDS,
      untilSeconds - nextStart
    )
    const buffer = await renderAudioChunk({
      audioSources,
      durationSeconds,
      project,
      runtimeAssets,
      signal,
      startSeconds: nextStart,
    })

    await audioSource.add(buffer)
    nextStart += durationSeconds
  }

  return nextStart
}

function getNextAudioChunkEndSeconds(
  timelineSeconds: number,
  totalDuration: number
) {
  const rawUntilSeconds = Math.min(
    totalDuration,
    timelineSeconds + EXPORT_AUDIO_LOOKAHEAD_SECONDS
  )
  const chunkedUntilSeconds =
    Math.ceil(rawUntilSeconds / EXPORT_AUDIO_CHUNK_SECONDS) *
    EXPORT_AUDIO_CHUNK_SECONDS

  return Math.min(totalDuration, chunkedUntilSeconds)
}

async function renderAudioChunk({
  audioSources,
  durationSeconds,
  project,
  runtimeAssets,
  signal,
  startSeconds,
}: {
  audioSources: Map<string, Promise<ExportAudioSource | null>>
  durationSeconds: number
  project: Project
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
  startSeconds: number
}) {
  const buffer = new AudioBuffer({
    length: Math.max(1, Math.round(durationSeconds * EXPORT_AUDIO_SAMPLE_RATE)),
    numberOfChannels: EXPORT_AUDIO_CHANNELS,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
  })
  const endSeconds = startSeconds + durationSeconds
  const audioItems: ExportAudioItem[] = [
    ...project.clips.filter(isAudibleTimelineItem),
    ...project.musicTracks.filter(isAudibleTimelineItem),
  ]

  for (const item of audioItems) {
    if (!rangesOverlap(startSeconds, endSeconds, getItemStart(item), getItemEnd(item))) {
      continue
    }

    const runtimeAsset = runtimeAssets[item.sourceAssetId]

    if (!runtimeAsset) {
      throw new Error("Reconnect all source files before exporting.")
    }

    const source = await getExportAudioSource({
      audioSources,
      assetId: item.sourceAssetId,
      file: runtimeAsset.file,
    })

    if (!source) {
      continue
    }

    const overlapStart = Math.max(startSeconds, getItemStart(item))
    const overlapEnd = Math.min(endSeconds, getItemEnd(item))
    const sourceStart =
      item.sourceStartSeconds + overlapStart - item.timelineStartSeconds
    const sourceEnd =
      item.sourceStartSeconds + overlapEnd - item.timelineStartSeconds

    await mixAudioRangeIntoBuffer({
      buffer,
      destinationOffsetSeconds: overlapStart - startSeconds,
      signal,
      source,
      sourceEndSeconds: sourceEnd,
      sourceStartSeconds: sourceStart,
      volume: getExportVolume(item.volume),
    })
  }

  return buffer
}

async function getExportAudioSource({
  assetId,
  audioSources,
  file,
}: {
  assetId: string
  audioSources: Map<string, Promise<ExportAudioSource | null>>
  file: File
}) {
  let sourcePromise = audioSources.get(assetId)

  if (!sourcePromise) {
    sourcePromise = createExportAudioSource(file)
    audioSources.set(assetId, sourcePromise)
  }

  return sourcePromise
}

async function createExportAudioSource(
  file: File
): Promise<ExportAudioSource | null> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()

    if (!audioTrack || !(await audioTrack.canDecode())) {
      input.dispose()
      return null
    }

    return {
      input,
      sink: new AudioSampleSink(audioTrack),
    }
  } catch (reason) {
    input.dispose()
    throw reason
  }
}

async function mixAudioRangeIntoBuffer({
  buffer,
  destinationOffsetSeconds,
  signal,
  source,
  sourceEndSeconds,
  sourceStartSeconds,
  volume,
}: {
  buffer: AudioBuffer
  destinationOffsetSeconds: number
  signal: AbortSignal
  source: ExportAudioSource
  sourceEndSeconds: number
  sourceStartSeconds: number
  volume: number
}) {
  if (volume <= 0 || sourceEndSeconds <= sourceStartSeconds) {
    return
  }

  for await (const sample of source.sink.samples(
    sourceStartSeconds,
    sourceEndSeconds
  )) {
    throwIfAborted(signal)

    try {
      mixAudioSampleIntoBuffer({
        buffer,
        destinationOffsetSeconds,
        sample,
        sourceEndSeconds,
        sourceStartSeconds,
        volume,
      })
    } finally {
      sample.close()
    }
  }
}

function mixAudioSampleIntoBuffer({
  buffer,
  destinationOffsetSeconds,
  sample,
  sourceEndSeconds,
  sourceStartSeconds,
  volume,
}: {
  buffer: AudioBuffer
  destinationOffsetSeconds: number
  sample: AudioSample
  sourceEndSeconds: number
  sourceStartSeconds: number
  volume: number
}) {
  const frameCount = sample.numberOfFrames

  if (frameCount <= 0 || sample.numberOfChannels <= 0) {
    return
  }

  const sampleStart = sample.timestamp
  const sampleEnd = sampleStart + frameCount / sample.sampleRate
  const overlapStart = Math.max(sourceStartSeconds, sampleStart)
  const overlapEnd = Math.min(sourceEndSeconds, sampleEnd)

  if (overlapEnd <= overlapStart) {
    return
  }

  const sourceChannels = Array.from(
    { length: sample.numberOfChannels },
    (_, channel) => {
      const data = new Float32Array(frameCount)
      sample.copyTo(data, {
        format: "f32-planar",
        planeIndex: channel,
      })
      return data
    }
  )
  const outputChannels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel)
  )
  const destinationStartFrame = clamp(
    Math.floor(
      (destinationOffsetSeconds + overlapStart - sourceStartSeconds) *
        buffer.sampleRate
    ),
    0,
    buffer.length
  )
  const destinationEndFrame = clamp(
    Math.ceil(
      (destinationOffsetSeconds + overlapEnd - sourceStartSeconds) *
        buffer.sampleRate
    ),
    destinationStartFrame,
    buffer.length
  )

  for (
    let destinationFrame = destinationStartFrame;
    destinationFrame < destinationEndFrame;
    destinationFrame += 1
  ) {
    const sourceTime =
      sourceStartSeconds +
      destinationFrame / buffer.sampleRate -
      destinationOffsetSeconds
    const sampleFrame = clamp(
      Math.floor((sourceTime - sampleStart) * sample.sampleRate),
      0,
      frameCount - 1
    )

    for (let channel = 0; channel < outputChannels.length; channel += 1) {
      const outputChannel = outputChannels[channel]
      const sourceChannel =
        sourceChannels[Math.min(channel, sourceChannels.length - 1)]

      if (!outputChannel) {
        continue
      }

      outputChannel[destinationFrame] = clamp(
        (outputChannel[destinationFrame] ?? 0) +
          (sourceChannel?.[sampleFrame] ?? 0) * volume,
        -1,
        1
      )
    }
  }
}

async function createExportOutputTarget(
  format: ExportFormat
): Promise<ExportOutputTarget> {
  const opfsTarget = await createOpfsExportOutputTarget(format).catch(
    () => null
  )

  if (opfsTarget) {
    return opfsTarget
  }

  const target = new BufferTarget()

  return {
    target,
    cleanup: async () => undefined,
    getBlob: async (mimeType) => {
      if (!target.buffer) {
        throw new Error("Export did not produce a video file.")
      }

      return new Blob([target.buffer], { type: mimeType })
    },
  }
}

async function createOpfsExportOutputTarget(
  format: ExportFormat
): Promise<ExportOutputTarget | null> {
  const root = await navigator.storage?.getDirectory?.()

  if (!root) {
    return null
  }

  const directory = await root.getDirectoryHandle("exports", { create: true })
  const fileName = `${crypto.randomUUID()}.${format}`
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable?.()

  if (!writable) {
    return null
  }

  return {
    target: new StreamTarget(writable as WritableStream<StreamTargetChunk>, {
      chunkSize: EXPORT_OPFS_CHUNK_SIZE,
      chunked: true,
    }),
    cleanup: async () => {
      await directory.removeEntry(fileName).catch(() => undefined)
    },
    getBlob: async (mimeType) => {
      const file = await fileHandle.getFile()

      return file.type === mimeType
        ? file
        : new File([file], file.name, { type: mimeType })
    },
  }
}

function getExportFormatConfig(format: ExportFormat): ExportFormatConfig {
  if (format === "mp4") {
    return {
      audioCodec: "aac",
      extension: "mp4",
      mimeType: "video/mp4",
      outputFormat: new Mp4OutputFormat({
        fastStart: "fragmented",
        minimumFragmentDuration: 1,
      }),
      videoCodec: "avc",
    }
  }

  return {
    audioCodec: "opus",
    extension: "webm",
    mimeType: "video/webm",
    outputFormat: new WebMOutputFormat({
      minimumClusterDuration: 1,
    }),
    videoCodec: "vp9",
  }
}

function drawTimelineFrame({
  canvas,
  clipNodes,
  context,
  timelineSeconds,
}: {
  canvas: HTMLCanvasElement
  clipNodes: ClipNode[]
  context: CanvasRenderingContext2D
  timelineSeconds: number
}) {
  context.fillStyle = "#000"
  context.fillRect(0, 0, canvas.width, canvas.height)

  const activeClips = clipNodes
    .filter(({ clip }) => isActiveAt(clip, timelineSeconds))
    .sort((a, b) => getTrackIndex(b.clip) - getTrackIndex(a.clip))

  for (const { clip, sample } of activeClips) {
    if (sample) {
      drawTransformedSource(context, sample, canvas.width, canvas.height, clip)
    }
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

function closeCurrentVideoSamples(nodes: Map<string, ClipNode>) {
  for (const node of nodes.values()) {
    node.sample?.close()
    node.sample = null
  }
}

function disposeClipNodes(nodes: Map<string, ClipNode>) {
  for (const node of nodes.values()) {
    disposeClipNode(node)
  }

  nodes.clear()
}

function disposeClipNode(node: ClipNode) {
  node.sample?.close()
  node.sample = null
  node.sourcePromise
    .then((source) => source?.close())
    .catch(() => undefined)
}

async function disposeExportAudioSources(
  audioSources: Map<string, Promise<ExportAudioSource | null>>
) {
  const sources = await Promise.allSettled(audioSources.values())

  for (const source of sources) {
    if (source.status === "fulfilled") {
      source.value?.input.dispose()
    }
  }

  audioSources.clear()
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

function isAudibleTimelineItem(item: ExportAudioItem) {
  return !("muted" in item && item.muted) && getExportVolume(item.volume) > 0
}

function getItemStart(item: ExportAudioItem) {
  return item.timelineStartSeconds
}

function getItemEnd(item: ExportAudioItem) {
  return item.timelineStartSeconds + getClipDuration(item)
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  return startA < endB && endA > startB
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getExportVolume(volume: number) {
  return Math.min(2, Math.max(0, volume))
}

function getTrackIndex(item: { trackIndex?: number }) {
  return item.trackIndex ?? 0
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

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Export cancelled", "AbortError")
  }
}

function yieldToBrowser(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, 0)

    function onAbort() {
      window.clearTimeout(timeout)
      reject(
        signal.reason ?? new DOMException("Export cancelled", "AbortError")
      )
    }

    signal.addEventListener("abort", onAbort, { once: true })
  })
}

import {
  ALL_FORMATS,
  AudioBufferSource,
  AudioSampleSink,
  BlobSource,
  Input,
  type AudioSample,
} from "mediabunny"

import { getClipDuration } from "../project"
import type {
  MusicTrack,
  Project,
  RuntimeAssetMap,
  TimelineClip,
} from "../types"
import { clamp, throwIfAborted } from "./shared"

export type ExportAudioItem = TimelineClip | MusicTrack

export type ExportAudioSource = {
  input: Input
  sink: AudioSampleSink
}

export type ExportAudioReader = {
  close: () => void
  readSamples: (
    sourceStartSeconds: number,
    sourceEndSeconds: number,
    signal: AbortSignal
  ) => Promise<ExportDecodedAudioSample[]>
}

type ExportDecodedAudioSample = {
  channels: Float32Array[]
  numberOfChannels: number
  numberOfFrames: number
  sampleRate: number
  timestamp: number
}

export const EXPORT_AUDIO_SAMPLE_RATE = 48_000
export const EXPORT_AUDIO_CHANNELS = 2

const EXPORT_AUDIO_CHUNK_SECONDS = 0.5
const EXPORT_AUDIO_LOOKAHEAD_SECONDS = 1

export async function addAudioChunksUntil({
  audioSource,
  audioReaders,
  audioSources,
  project,
  runtimeAssets,
  signal,
  startSeconds,
  untilSeconds,
}: {
  audioSource: AudioBufferSource
  audioReaders: Map<string, ExportAudioReader>
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
      audioReaders,
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

export function createExportAudioReaderMap() {
  return new Map<string, ExportAudioReader>()
}

export function createExportAudioSourceMap() {
  return new Map<string, Promise<ExportAudioSource | null>>()
}

export function disposeExportAudioReaders(
  audioReaders: Map<string, ExportAudioReader>
) {
  for (const reader of audioReaders.values()) {
    reader.close()
  }

  audioReaders.clear()
}

export async function disposeExportAudioSources(
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

export function getNextAudioChunkEndSeconds(
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

export function isAudibleTimelineItem(item: ExportAudioItem) {
  return !("muted" in item && item.muted) && getExportVolume(item.volume) > 0
}

async function renderAudioChunk({
  audioReaders,
  audioSources,
  durationSeconds,
  project,
  runtimeAssets,
  signal,
  startSeconds,
}: {
  audioReaders: Map<string, ExportAudioReader>
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

    const reader = getExportAudioReader({
      audioReaders,
      item,
      source,
    })

    await mixAudioRangeIntoBuffer({
      buffer,
      destinationOffsetSeconds: overlapStart - startSeconds,
      reader,
      signal,
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

function getExportAudioReader({
  audioReaders,
  item,
  source,
}: {
  audioReaders: Map<string, ExportAudioReader>
  item: ExportAudioItem
  source: ExportAudioSource
}) {
  const key = getAudioItemKey(item)
  let reader = audioReaders.get(key)

  if (!reader) {
    reader = createExportAudioReader({
      sink: source.sink,
      sourceEndSeconds: item.sourceEndSeconds,
      sourceStartSeconds: item.sourceStartSeconds,
    })
    audioReaders.set(key, reader)
  }

  return reader
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

function createExportAudioReader({
  sink,
  sourceEndSeconds,
  sourceStartSeconds,
}: {
  sink: AudioSampleSink
  sourceEndSeconds: number
  sourceStartSeconds: number
}): ExportAudioReader {
  const iterator = sink
    .samples(sourceStartSeconds, sourceEndSeconds, { skipLiveWait: true })
    [Symbol.asyncIterator]()
  let pendingSample: ExportDecodedAudioSample | null = null
  let closed = false
  let readQueue = Promise.resolve<ExportDecodedAudioSample[]>([])

  async function readNextSample() {
    const result = await iterator.next()

    if (result.done) {
      return null
    }

    try {
      return copyAudioSample(result.value)
    } finally {
      result.value.close()
    }
  }

  function readSamples(
    sourceStartSeconds: number,
    sourceEndSeconds: number,
    signal: AbortSignal
  ) {
    const read = readQueue.then(async () => {
      if (closed) {
        return []
      }

      throwIfAborted(signal)

      while (
        pendingSample &&
        getDecodedAudioSampleEnd(pendingSample) <= sourceStartSeconds
      ) {
        pendingSample = null
      }

      pendingSample ??= await readNextSample()

      const samples: ExportDecodedAudioSample[] = []

      while (pendingSample && pendingSample.timestamp < sourceEndSeconds) {
        throwIfAborted(signal)

        const sample = pendingSample
        const sampleEnd = getDecodedAudioSampleEnd(sample)

        if (sampleEnd > sourceStartSeconds) {
          samples.push(sample)
        }

        if (sampleEnd >= sourceEndSeconds) {
          break
        }

        pendingSample = await readNextSample()
      }

      return samples
    })

    readQueue = read.then(
      () => [],
      () => []
    )

    return read
  }

  return {
    close: () => {
      closed = true
      pendingSample = null
      iterator.return?.().catch(() => undefined)
    },
    readSamples,
  }
}

function copyAudioSample(sample: AudioSample): ExportDecodedAudioSample {
  const frameCount = sample.numberOfFrames
  const channels = Array.from(
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

  return {
    channels,
    numberOfChannels: sample.numberOfChannels,
    numberOfFrames: frameCount,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  }
}

async function mixAudioRangeIntoBuffer({
  buffer,
  destinationOffsetSeconds,
  reader,
  signal,
  sourceEndSeconds,
  sourceStartSeconds,
  volume,
}: {
  buffer: AudioBuffer
  destinationOffsetSeconds: number
  reader: ExportAudioReader
  signal: AbortSignal
  sourceEndSeconds: number
  sourceStartSeconds: number
  volume: number
}) {
  if (volume <= 0 || sourceEndSeconds <= sourceStartSeconds) {
    return
  }

  const samples = await reader.readSamples(
    sourceStartSeconds,
    sourceEndSeconds,
    signal
  )

  for (const sample of samples) {
    mixAudioSampleIntoBuffer({
      buffer,
      destinationOffsetSeconds,
      sample,
      sourceEndSeconds,
      sourceStartSeconds,
      volume,
    })
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
  sample: ExportDecodedAudioSample
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

  const sourceChannels = sample.channels
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
      (sourceTime - sampleStart) * sample.sampleRate,
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

      outputChannel[destinationFrame] =
        (outputChannel[destinationFrame] ?? 0) +
        getInterpolatedAudioSample(sourceChannel, sampleFrame) * volume
    }
  }
}

function getInterpolatedAudioSample(
  channel: Float32Array | undefined,
  frame: number
) {
  if (!channel || channel.length === 0) {
    return 0
  }

  const lowerFrame = Math.floor(frame)
  const upperFrame = Math.min(lowerFrame + 1, channel.length - 1)
  const fraction = frame - lowerFrame
  const lowerValue = channel[lowerFrame] ?? 0
  const upperValue = channel[upperFrame] ?? lowerValue

  return lowerValue + (upperValue - lowerValue) * fraction
}

function getDecodedAudioSampleEnd(sample: ExportDecodedAudioSample) {
  return sample.timestamp + sample.numberOfFrames / sample.sampleRate
}

function getAudioItemKey(item: ExportAudioItem) {
  return `${"muted" in item ? "clip" : "music"}:${item.id}`
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

function getExportVolume(volume: number) {
  return Math.min(2, Math.max(0, volume))
}

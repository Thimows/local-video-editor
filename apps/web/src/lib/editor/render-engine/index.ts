import {
  AudioBufferSource,
  CanvasSource,
  Output,
} from "mediabunny"

import { getExportBitrates } from "../export-settings"
import { getProjectDuration } from "../project"
import type { ExportFormat, Project, RuntimeAssetMap } from "../types"
import {
  addAudioChunksUntil,
  createExportAudioReaderMap,
  createExportAudioSourceMap,
  disposeExportAudioReaders,
  disposeExportAudioSources,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  getNextAudioChunkEndSeconds,
  isAudibleTimelineItem,
} from "./audio-mixer"
import { getExportFormatConfig } from "./encoder-config"
import { createExportOutputTarget } from "./output-target"
import { getTrackIndex, throwIfAborted, yieldToBrowser } from "./shared"
import {
  closeCurrentVideoSamples,
  disposeClipNodes,
  drawTimelineFrame,
  prepareExportVideoWindow,
  type ClipNode,
} from "./video-compositor"

export type ExportProgress = {
  progress: number
  message: string
}

export type ExportOptions = {
  project: Project
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}

export type ExportResult = {
  blob: Blob
  cleanup: () => Promise<void>
  extension: ExportFormat
  mimeType: string
}

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
  const exportBitrates = getExportBitrates(project.exportSettings)
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
    bitrate: exportBitrates.videoBitsPerSecond,
    hardwareAcceleration: "prefer-hardware",
    keyFrameInterval: 2,
  })
  const audioSource = hasAudioTrack
    ? new AudioBufferSource({
        codec: config.audioCodec,
        bitrate: exportBitrates.audioBitsPerSecond,
        transform: {
          numberOfChannels: EXPORT_AUDIO_CHANNELS,
          sampleFormat: "f32",
          sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        },
      })
    : null
  const clipNodes = new Map<string, ClipNode>()
  const audioSources = createExportAudioSourceMap()
  const audioReaders = createExportAudioReaderMap()
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
          audioReaders,
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
        audioReaders,
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
    disposeExportAudioReaders(audioReaders)
    await disposeExportAudioSources(audioSources)

    if (!exportCompleted) {
      await outputTarget.cleanup()
    }
  }
}

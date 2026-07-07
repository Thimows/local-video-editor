import { getClipDuration, getProjectDuration } from "./project"
import type { ExportFormat, Project, RuntimeAssetMap } from "./types"

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
  extension: ExportFormat
  mimeType: string
}

type ClipNode = {
  clip: Project["clips"][number]
  video: HTMLVideoElement
  audio: HTMLAudioElement
  gain: GainNode
}

type MusicNode = {
  track: Project["musicTracks"][number]
  audio: HTMLAudioElement
  gain: GainNode
}

function supportsMimeType(type: string) {
  return (
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
  )
}

function getExportMimeType(format: ExportFormat) {
  if (format === "mp4") {
    const mp4Types = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=h264,aac",
      "video/mp4",
    ]
    const supportedMp4 = mp4Types.find(supportsMimeType)

    if (!supportedMp4) {
      throw new Error("MP4 export is not supported by this browser.")
    }

    return supportedMp4
  }

  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find(supportsMimeType) ??
    (() => {
      throw new Error("WebM export is not supported by this browser.")
    })()
  )
}

function waitForEvent(
  target: EventTarget,
  eventName: string,
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      target.removeEventListener(eventName, onEvent)
      target.removeEventListener("error", onError)
      signal.removeEventListener("abort", onAbort)
    }

    function onEvent() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error(`Could not load media during export.`))
    }

    function onAbort() {
      cleanup()
      reject(
        signal.reason ?? new DOMException("Export cancelled", "AbortError")
      )
    }

    target.addEventListener(eventName, onEvent, { once: true })
    target.addEventListener("error", onError, { once: true })
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function nextFrame(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const frame = requestAnimationFrame(() => resolve())
    signal.addEventListener(
      "abort",
      () => {
        cancelAnimationFrame(frame)
        reject(
          signal.reason ?? new DOMException("Export cancelled", "AbortError")
        )
      },
      { once: true }
    )
  })
}

export async function exportProjectToVideo({
  project,
  runtimeAssets,
  signal,
  onProgress,
}: ExportOptions): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder export is not supported in this browser.")
  }

  const mimeType = getExportMimeType(project.exportSettings.format)
  const clips = [...project.clips].sort(
    (a, b) =>
      a.timelineStartSeconds - b.timelineStartSeconds ||
      getTrackIndex(b) - getTrackIndex(a)
  )
  const totalDuration = getProjectDuration(project)
  const timelineItems = [...project.clips, ...project.musicTracks]

  if (timelineItems.length === 0 || totalDuration <= 0) {
    throw new Error("Add at least one timeline item before exporting.")
  }

  for (const item of timelineItems) {
    if (!runtimeAssets[item.sourceAssetId]) {
      throw new Error("Reconnect all source files before exporting.")
    }
  }

  const canvas = document.createElement("canvas")
  canvas.width = project.exportSettings.width
  canvas.height = project.exportSettings.height
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Canvas export is not available in this browser.")
  }

  const audioContext = new AudioContext()
  const audioDestination = audioContext.createMediaStreamDestination()
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let recordingComplete: Promise<void> | null = null
  let clipNodes: ClipNode[] = []
  let musicNodes: MusicNode[] = []
  const timers: number[] = []
  const chunks: BlobPart[] = []

  try {
    clipNodes = await createClipNodes({
      audioContext,
      audioDestination,
      clips,
      runtimeAssets,
      signal,
    })
    musicNodes = await createMusicNodes({
      audioContext,
      audioDestination,
      project,
      runtimeAssets,
      signal,
    })

    const canvasStream = canvas.captureStream(project.exportSettings.fps)
    stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ])
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: project.exportSettings.videoBitsPerSecond,
      audioBitsPerSecond: project.exportSettings.audioBitsPerSecond,
    })

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    recordingComplete = waitForEvent(recorder, "stop", signal)

    await audioContext.resume()
    recorder.start(1000)

    const exportStartedAt = performance.now()

    timers.push(...scheduleClipPlayback(clipNodes, signal))
    timers.push(...scheduleMusicPlayback(musicNodes, signal))

    while (!signal.aborted) {
      const elapsed = (performance.now() - exportStartedAt) / 1000
      const timelineSeconds = Math.min(elapsed, totalDuration)

      drawTimelineFrame({
        canvas,
        clipNodes,
        context,
        timelineSeconds,
      })
      onProgress({
        progress: Math.min(0.98, timelineSeconds / totalDuration),
        message: `Rendering ${Math.round(timelineSeconds)}s of ${Math.round(
          totalDuration
        )}s`,
      })

      if (timelineSeconds >= totalDuration) {
        break
      }

      await nextFrame(signal)
    }
    recorder.stop()
    await recordingComplete
  } finally {
    timers.forEach((timer) => window.clearTimeout(timer))
    stopMedia(clipNodes, musicNodes)
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop()
      } catch {
        // Recorder may already be closing after a cancellation.
      }
    }
    await recordingComplete?.catch(() => undefined)
    stream?.getTracks().forEach((track) => track.stop())
    await audioContext.close().catch(() => undefined)
  }

  onProgress({ progress: 1, message: "Export ready" })

  return {
    blob: new Blob(chunks, { type: mimeType }),
    extension: project.exportSettings.format,
    mimeType,
  }
}

async function createClipNodes({
  audioContext,
  audioDestination,
  clips,
  runtimeAssets,
  signal,
}: {
  audioContext: AudioContext
  audioDestination: MediaStreamAudioDestinationNode
  clips: Project["clips"]
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
}) {
  return Promise.all(
    clips.map(async (clip) => {
      const runtimeAsset = runtimeAssets[clip.sourceAssetId]

      if (!runtimeAsset) {
        throw new Error("Reconnect all source video files before exporting.")
      }

      const video = document.createElement("video")
      const audio = document.createElement("audio")
      const source = audioContext.createMediaElementSource(audio)
      const gain = audioContext.createGain()

      video.src = runtimeAsset.objectUrl
      video.muted = true
      video.playsInline = true
      video.preload = "auto"
      audio.src = runtimeAsset.objectUrl
      audio.preload = "auto"
      gain.gain.value = clip.muted ? 0 : getExportVolume(clip.volume)
      source.connect(gain).connect(audioDestination)

      await waitForMediaMetadata(video, signal)
      await seekMedia(video, clip.sourceStartSeconds, signal)
      await waitForMediaMetadata(audio, signal)
      await seekMedia(audio, clip.sourceStartSeconds, signal)

      return { clip, video, audio, gain }
    })
  )
}

async function createMusicNodes({
  audioContext,
  audioDestination,
  project,
  runtimeAssets,
  signal,
}: {
  audioContext: AudioContext
  audioDestination: MediaStreamAudioDestinationNode
  project: Project
  runtimeAssets: RuntimeAssetMap
  signal: AbortSignal
}) {
  const nodes = project.musicTracks.flatMap((track) => {
    const runtimeAsset = runtimeAssets[track.sourceAssetId]

    if (!runtimeAsset) {
      return []
    }

    const audio = document.createElement("audio")
    const source = audioContext.createMediaElementSource(audio)
    const gain = audioContext.createGain()

    audio.src = runtimeAsset.objectUrl
    audio.preload = "auto"
    gain.gain.value = getExportVolume(track.volume)
    source.connect(gain).connect(audioDestination)

    return [{ audio, gain, track }]
  })

  await Promise.all(
    nodes.map(async ({ audio, track }) => {
      await waitForMediaMetadata(audio, signal)
      await seekMedia(audio, track.sourceStartSeconds, signal)
    })
  )

  return nodes
}

function waitForMediaMetadata(media: HTMLMediaElement, signal: AbortSignal) {
  return media.readyState >= HTMLMediaElement.HAVE_METADATA
    ? Promise.resolve()
    : waitForEvent(media, "loadedmetadata", signal)
}

async function seekMedia(
  media: HTMLMediaElement,
  seconds: number,
  signal: AbortSignal
) {
  media.currentTime = seconds

  if (!media.seeking) {
    return
  }

  await waitForEvent(media, "seeked", signal)
}

function scheduleClipPlayback(nodes: ClipNode[], signal: AbortSignal) {
  return nodes.flatMap(({ audio, clip, video }) => {
    const startTimer = window.setTimeout(() => {
      if (signal.aborted) {
        return
      }

      video.currentTime = clip.sourceStartSeconds
      audio.currentTime = clip.sourceStartSeconds
      video.play().catch(() => undefined)
      audio.play().catch(() => undefined)
    }, Math.max(0, clip.timelineStartSeconds * 1000))
    const stopTimer = window.setTimeout(() => {
      video.pause()
      audio.pause()
    }, Math.max(0, (clip.timelineStartSeconds + getClipDuration(clip)) * 1000))

    return [startTimer, stopTimer]
  })
}

function scheduleMusicPlayback(nodes: MusicNode[], signal: AbortSignal) {
  return nodes.flatMap(({ audio, track }) => {
    const startTimer = window.setTimeout(() => {
      if (signal.aborted) {
        return
      }

      audio.currentTime = track.sourceStartSeconds
      audio.play().catch(() => undefined)
    }, Math.max(0, track.timelineStartSeconds * 1000))
    const stopTimer = window.setTimeout(() => {
      audio.pause()
    }, Math.max(0, (track.timelineStartSeconds + getClipDuration(track)) * 1000))

    return [startTimer, stopTimer]
  })
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

  for (const { clip, video } of activeClips) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawTransformedSource(context, video, canvas.width, canvas.height, clip)
    }
  }
}

function drawTransformedSource(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  clip: Project["clips"][number]
) {
  const videoRatio = video.videoWidth / video.videoHeight || width / height
  const baseWidth = video.videoWidth || width
  const baseHeight = video.videoHeight || baseWidth / videoRatio
  const scale = getClipScale(clip)
  const drawWidth = baseWidth * scale
  const drawHeight = baseHeight * scale
  const x =
    (width - drawWidth) / 2 + (getClipPositionX(clip) / 100) * width
  const y =
    (height - drawHeight) / 2 + (getClipPositionY(clip) / 100) * height

  context.drawImage(video, x, y, drawWidth, drawHeight)
}

function stopMedia(clipNodes: ClipNode[], musicNodes: MusicNode[]) {
  for (const { audio, video } of clipNodes) {
    audio.pause()
    video.pause()
    audio.src = ""
    video.src = ""
  }

  for (const { audio } of musicNodes) {
    audio.pause()
    audio.src = ""
  }
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

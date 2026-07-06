import { getClipDuration, getProjectDuration } from "./project"
import type { Project, RuntimeAssetMap } from "./types"

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

function supportsMimeType(type: string) {
  return (
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
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
      signal.removeEventListener("abort", onAbort)
    }

    function onEvent() {
      cleanup()
      resolve()
    }

    function onAbort() {
      cleanup()
      reject(
        signal.reason ?? new DOMException("Export cancelled", "AbortError")
      )
    }

    target.addEventListener(eventName, onEvent, { once: true })
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

export async function exportProjectToWebM({
  project,
  runtimeAssets,
  signal,
  onProgress,
}: ExportOptions) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder export is not supported in this browser.")
  }

  const mimeType = supportsMimeType("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : supportsMimeType("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm"

  const clips = [...project.clips].sort(
    (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
  )
  const totalDuration = getProjectDuration(project)

  if (clips.length === 0 || totalDuration <= 0) {
    throw new Error("Add at least one video clip before exporting.")
  }

  for (const clip of clips) {
    if (!runtimeAssets[clip.sourceAssetId]) {
      throw new Error("Reconnect all source video files before exporting.")
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
  const video = document.createElement("video")
  video.playsInline = true
  video.crossOrigin = "anonymous"

  const sourceNode = audioContext.createMediaElementSource(video)
  const clipGain = audioContext.createGain()
  sourceNode.connect(clipGain).connect(audioDestination)

  const musicNodes = project.musicTracks
    .map((track) => {
      const runtimeAsset = runtimeAssets[track.sourceAssetId]

      if (!runtimeAsset) {
        return null
      }

      const audio = document.createElement("audio")
      const source = audioContext.createMediaElementSource(audio)
      const gain = audioContext.createGain()

      audio.src = runtimeAsset.objectUrl
      audio.preload = "auto"
      gain.gain.value = track.volume
      source.connect(gain).connect(audioDestination)

      return { audio, track }
    })
    .filter(Boolean) as Array<{
    audio: HTMLAudioElement
    track: Project["musicTracks"][number]
  }>

  const canvasStream = canvas.captureStream(project.exportSettings.fps)
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ])
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: project.exportSettings.videoBitsPerSecond,
    audioBitsPerSecond: project.exportSettings.audioBitsPerSecond,
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const recordingComplete = waitForEvent(recorder, "stop", signal)
  await audioContext.resume()
  recorder.start(1000)

  const exportStartedAt = performance.now()
  const musicTimers = scheduleMusicTracks(musicNodes, signal)

  try {
    for (const clip of clips) {
      const runtimeAsset = runtimeAssets[clip.sourceAssetId]
      const clipDuration = getClipDuration(clip)

      if (!runtimeAsset || clipDuration <= 0) {
        continue
      }

      video.src = runtimeAsset.objectUrl
      video.muted = clip.muted
      clipGain.gain.value = clip.muted ? 0 : clip.volume

      await waitForEvent(video, "loadedmetadata", signal)
      video.currentTime = clip.sourceStartSeconds
      await waitForEvent(video, "seeked", signal)
      await video.play()

      while (!signal.aborted && video.currentTime < clip.sourceEndSeconds) {
        context.fillStyle = "#000"
        context.fillRect(0, 0, canvas.width, canvas.height)
        drawContain(context, video, canvas.width, canvas.height)

        const elapsed = (performance.now() - exportStartedAt) / 1000
        onProgress({
          progress: Math.min(0.98, elapsed / totalDuration),
          message: `Rendering ${Math.round(Math.min(elapsed, totalDuration))}s of ${Math.round(
            totalDuration
          )}s`,
        })

        await nextFrame(signal)
      }

      video.pause()
    }
  } finally {
    musicTimers.forEach((timer) => clearTimeout(timer))
    musicNodes.forEach(({ audio }) => {
      audio.pause()
      audio.src = ""
    })
    video.pause()
  }

  recorder.stop()
  await recordingComplete
  stream.getTracks().forEach((track) => track.stop())
  await audioContext.close()

  onProgress({ progress: 1, message: "Export ready" })

  return new Blob(chunks, { type: mimeType })
}

function drawContain(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number
) {
  const videoRatio = video.videoWidth / video.videoHeight || width / height
  const canvasRatio = width / height
  const drawWidth = videoRatio > canvasRatio ? width : height * videoRatio
  const drawHeight = videoRatio > canvasRatio ? width / videoRatio : height
  const x = (width - drawWidth) / 2
  const y = (height - drawHeight) / 2

  context.drawImage(video, x, y, drawWidth, drawHeight)
}

function scheduleMusicTracks(
  nodes: Array<{
    audio: HTMLAudioElement
    track: Project["musicTracks"][number]
  }>,
  signal: AbortSignal
) {
  return nodes.flatMap(({ audio, track }) => {
    const startTimer = window.setTimeout(
      () => {
        if (signal.aborted) {
          return
        }

        audio.currentTime = track.sourceStartSeconds
        audio.play().catch(() => undefined)
      },
      Math.max(0, track.timelineStartSeconds * 1000)
    )

    const stopTimer = window.setTimeout(
      () => audio.pause(),
      Math.max(
        0,
        (track.timelineStartSeconds +
          track.sourceEndSeconds -
          track.sourceStartSeconds) *
          1000
      )
    )

    return [startTimer, stopTimer]
  })
}

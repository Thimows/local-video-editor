export type PreviewAudioController = {
  source: MediaElementAudioSourceNode
  gain: GainNode
}

export type PreviewAudioStatus = {
  engine: "web-audio" | "native"
  requestedGain: number
  appliedGain: number
  contextState?: AudioContextState
  error?: string
}

type PreviewAudioDebugEntry = PreviewAudioStatus & {
  id: string
  kind: "clip" | "music"
  name?: string
}

declare global {
  interface Window {
    __LOCAL_VIDEO_EDITOR_AUDIO_DEBUG__?: Record<string, PreviewAudioDebugEntry>
  }
}

export function setPreviewMediaVolume({
  player,
  audioContext,
  getAudioContext,
  audioControllerRef,
  volume,
  muted,
  maxVolume,
}: {
  player: HTMLMediaElement
  audioContext: AudioContext | null
  getAudioContext: () => AudioContext | null
  audioControllerRef: { current: PreviewAudioController | null }
  volume: number
  muted: boolean
  maxVolume: number
}): PreviewAudioStatus {
  const gainValue = muted ? 0 : clamp(volume, 0, maxVolume)
  const needsAudioGraph =
    audioControllerRef.current !== null || (!muted && gainValue > 1)

  if (!needsAudioGraph) {
    const appliedGain = Math.min(1, gainValue)

    player.muted = muted
    player.volume = appliedGain

    return {
      engine: "native",
      requestedGain: gainValue,
      appliedGain,
    }
  }

  const activeAudioContext = audioContext ?? getAudioContext()

  if (!activeAudioContext || !player.currentSrc) {
    const appliedGain = Math.min(1, gainValue)

    player.muted = muted
    player.volume = appliedGain

    return {
      engine: "native",
      requestedGain: gainValue,
      appliedGain,
      contextState: activeAudioContext?.state,
      error: activeAudioContext
        ? "Media source is not loaded yet."
        : "AudioContext is not available yet.",
    }
  }

  try {
    audioControllerRef.current ??= createPreviewAudioController(
      activeAudioContext,
      player
    )
    player.muted = false
    player.volume = 1
    if (!muted && activeAudioContext.state === "suspended") {
      activeAudioContext.resume().catch(() => undefined)
    }
    setPreviewGain(
      audioControllerRef.current.gain,
      activeAudioContext,
      gainValue
    )

    return {
      engine: "web-audio",
      requestedGain: gainValue,
      appliedGain: gainValue,
      contextState: activeAudioContext.state,
    }
  } catch {
    const appliedGain = Math.min(1, gainValue)

    player.muted = muted
    player.volume = appliedGain

    return {
      engine: "native",
      requestedGain: gainValue,
      appliedGain,
      contextState: activeAudioContext.state,
      error: "MediaElementAudioSourceNode could not be created.",
    }
  }
}

export function disconnectPreviewAudio(controllerRef: {
  current: PreviewAudioController | null
}) {
  const controller = controllerRef.current

  controllerRef.current = null
  controller?.source.disconnect()
  controller?.gain.disconnect()
}

export function publishPreviewAudioDebug(
  key: string,
  status: PreviewAudioDebugEntry
) {
  if (typeof window === "undefined") {
    return
  }

  window.__LOCAL_VIDEO_EDITOR_AUDIO_DEBUG__ ??= {}
  window.__LOCAL_VIDEO_EDITOR_AUDIO_DEBUG__[key] = status
}

export function clearPreviewAudioDebug(key: string) {
  if (typeof window === "undefined") {
    return
  }

  delete window.__LOCAL_VIDEO_EDITOR_AUDIO_DEBUG__?.[key]
}

export function createPreviewAudioContext() {
  if (typeof window === "undefined") {
    return null
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext
      }
    ).webkitAudioContext

  return AudioContextConstructor ? new AudioContextConstructor() : null
}

function createPreviewAudioController(
  audioContext: AudioContext,
  player: HTMLMediaElement
) {
  const source = audioContext.createMediaElementSource(player)
  const gain = audioContext.createGain()

  source.connect(gain).connect(audioContext.destination)

  return { source, gain }
}

function setPreviewGain(
  gainNode: GainNode,
  audioContext: AudioContext,
  value: number
) {
  const now = audioContext.currentTime

  gainNode.gain.cancelScheduledValues(now)
  gainNode.gain.setValueAtTime(value, now)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

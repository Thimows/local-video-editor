import type { ExportSettings, Project } from "./types"

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  compression: "balanced",
  format: "mp4",
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitsPerSecond: 5_000_000,
  audioBitsPerSecond: 160_000,
}

export function createEmptyProject(name = "Untitled project"): Project {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    sourceAssets: [],
    clips: [],
    musicTracks: [],
    exportSettings: DEFAULT_EXPORT_SETTINGS,
  }
}

export function getProjectDuration(project: Project) {
  const clipEnd = project.clips.reduce(
    (duration, clip) =>
      Math.max(
        duration,
        clip.timelineStartSeconds +
          clip.sourceEndSeconds -
          clip.sourceStartSeconds
      ),
    0
  )
  const musicEnd = project.musicTracks.reduce(
    (duration, track) =>
      Math.max(
        duration,
        track.timelineStartSeconds +
          track.sourceEndSeconds -
          track.sourceStartSeconds
      ),
    0
  )

  return Math.max(clipEnd, musicEnd)
}

export function getClipDuration(clip: {
  sourceStartSeconds: number
  sourceEndSeconds: number
}) {
  return Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00"
  }

  const rounded = Math.floor(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = String(rounded % 60).padStart(2, "0")

  return `${minutes}:${remainingSeconds}`
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** exponent

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

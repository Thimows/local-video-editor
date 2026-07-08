export type SourceAssetType = "video" | "audio"

export type ExportFormat = "webm" | "mp4"

export type SourceAsset = {
  id: string
  name: string
  type: SourceAssetType
  sizeBytes: number
  durationSeconds?: number
  width?: number
  height?: number
  createdAt: number
  fingerprint?: string
  fileHandle?: FileSystemFileHandle
  fileBlob?: File
}

export type TimelineClip = {
  id: string
  sourceAssetId: string
  sourceStartSeconds: number
  sourceEndSeconds: number
  timelineStartSeconds: number
  trackIndex?: number
  scale?: number
  positionX?: number
  positionY?: number
  muted: boolean
  volume: number
}

export type MusicTrack = {
  id: string
  sourceAssetId: string
  timelineStartSeconds: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  trackIndex?: number
  volume: number
}

export type ExportSettings = {
  format: ExportFormat
  width: number
  height: number
  fps: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
}

export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  sourceAssets: SourceAsset[]
  clips: TimelineClip[]
  musicTracks: MusicTrack[]
  exportSettings: ExportSettings
}

export type RuntimeAsset = {
  file: File
  objectUrl: string
}

export type RuntimeAssetMap = Record<string, RuntimeAsset>

export type Selection =
  | { type: "project" }
  | { type: "clip"; id: string }
  | { type: "music"; id: string }

export type ProjectSummary = {
  id: string
  name: string
  updatedAt: number
  createdAt: number
  sourceAssetCount: number
  clipCount: number
  musicTrackCount: number
}

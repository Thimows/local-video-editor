"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  IconChevronDown as ChevronDown,
  IconChevronLeft as ChevronLeft,
  IconCircleXFilled as VolumeX,
  IconExclamationCircleFilled as CircleExclamation,
  IconFileDownloadFilled as Download,
  IconHandStop as HandStop,
  IconLoader2 as Loader,
  IconMagnet as Magnet,
  IconMagnetOff as MagnetOff,
  IconScissors as Scissors,
  IconTrash as Trash,
  IconFileUploadFilled as Upload,
  IconFolderOpenFilled as FolderOpen,
  IconInfoCircleFilled as Info,
  IconLink as LinkIcon,
  IconPlayerPauseFilled as Pause,
  IconPlayerPlayFilled as Play,
  IconPointer as Cursor,
  IconPointerFilled as MousePointer2,
  IconVideoFilled as Film,
} from "@tabler/icons-react"
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  ComponentType,
  CSSProperties,
  DragEvent,
  PointerEvent,
  UIEvent,
} from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { AppSettingsMenu } from "@/components/app-settings-menu"
import {
  EXPORT_COMPRESSION_OPTIONS,
  getEstimatedExportSizeBytes,
  getExportBitrates,
  getExportCompression,
} from "@/lib/editor/export-settings"
import { exportProjectToVideo } from "@/lib/editor/export-video"
import {
  clearPreviewAudioDebug,
  createPreviewAudioContext,
  disconnectPreviewAudio,
  publishPreviewAudioDebug,
  setPreviewMediaVolume,
  type PreviewAudioController,
} from "@/components/editor/preview-engine/audio-preview-engine"
import {
  chooseLocalFiles,
  createRuntimeAsset,
  type FileRestoreDiagnostic,
  getDroppedLocalFiles,
  getFileKind,
  type MediaMetadata,
  readMediaMetadata,
  requestPersistentStorage,
  restoreProjectFileHandles,
} from "@/lib/editor/media"
import {
  formatBytes,
  formatDuration,
  getClipDuration,
  getProjectDuration,
} from "@/lib/editor/project"
import {
  canCreatePreviewProxy,
  deletePreviewProxiesForAssets,
  ensurePreviewProxy,
  getPreviewProxySegmentBounds,
  getPreviewProxySegmentCount,
  getPreviewProxySegmentIndex,
  getSourceAssetPreviewFingerprint,
  getSourceFileFingerprint,
  isSourceTimeInPreviewProxySegment,
  type PreviewProxyScale,
} from "@/lib/editor/preview-proxy"
import {
  extractTimelineWaveform,
  getRuntimeAssetFingerprint,
  getTimelineItemWaveformBars,
  type TimelineItemWaveformBars,
  type TimelineWaveform,
  type TimelineWaveformMap,
} from "@/lib/editor/waveform"
import { getProject, saveProject } from "@/lib/editor/db"
import type {
  MusicTrack,
  Project,
  RuntimeAsset,
  RuntimeAssetMap,
  Selection,
  SourceAsset,
  TimelineClip,
  ExportCompression,
  ExportFormat,
} from "@/lib/editor/types"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"
import { Slider } from "@workspace/ui/components/slider"
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownTrigger,
} from "@workspace/ui/components/ui/dropdown"
import { MenuItem } from "@workspace/ui/components/ui/menu-item"
import { SliderComfortable } from "@workspace/ui/components/ui/slider"
import {
  TabsSubtle,
  TabsSubtleItem,
} from "@workspace/ui/components/ui/tabs-subtle"
import { Tooltip } from "@workspace/ui/components/ui/tooltip"

const RULER_HEIGHT = 28
const TIMELINE_VIEWPORT_HEIGHT = 178
const TIMELINE_PLAYHEAD_LINE_OFFSET_PX = 0.5
const TIMELINE_PLAYHEAD_CAP_OFFSET_PX = 1
const TRACK_HEIGHT = 34
const TRACK_GAP = 5
const TIMELINE_TRACK_TOP = RULER_HEIGHT + 10
const SNAP_THRESHOLD_SECONDS = 1
const SNAP_THRESHOLD_TARGET_PIXELS = 24
const SNAP_THRESHOLD_MAX_SECONDS = 30
const MIN_ITEM_DURATION_SECONDS = 0.2
const PREVIEW_PRELOAD_SECONDS = 0.75
const PREVIEW_EDGE_SAMPLE_SECONDS = 1 / 60
const PREVIEW_SCRUB_SETTLE_MS = 220
const PREVIEW_IDLE_FULL_RESOLUTION_FRAME_DELAY_MS = 220
const PREVIEW_PROXY_PROGRESS_UI_INTERVAL_MS = 250
const PREVIEW_PROXY_LOADING_RETRY_MS = 2000
const PREVIEW_PROXY_VISIBLE_PRIORITY = 100
const PREVIEW_PROXY_BACKGROUND_PRIORITY = 0
const SNAP_OVERLAP_SECONDS = 0.001
const TIMELINE_EPSILON_SECONDS = 1 / 120
const TIMELINE_PRECISION_SECONDS = 1_000
const TIMELINE_HANDLE_MIN_WIDTH = 34
const TIMELINE_DRAG_START_THRESHOLD_PX = 3
const TIMELINE_CONTENT_INSET_X = 36
const TIMELINE_DROP_FALLBACK_DURATION_SECONDS = 12
const TIMELINE_DROP_FALLBACK_MIN_WIDTH = 120
const SUPPORTED_MEDIA_EXTENSIONS = "MP4, MOV, M4V, WebM, MP3, M4A, WAV, OGG"
const PREVIEW_RESOLUTION_OPTIONS = [
  { label: "Full resolution", value: "full", scale: 1 },
  { label: "Low resolution", value: "half", scale: 0.5 },
] as const
type PreviewResolutionScale =
  (typeof PREVIEW_RESOLUTION_OPTIONS)[number]["scale"]
const DEFAULT_PREVIEW_RESOLUTION_SCALE: PreviewResolutionScale = 0.5
type PreviewProxyEntry =
  | {
      status: "loading"
      assetId: string
      fingerprint: string
      processedTimeSeconds: number
      progress: number
      requestedAt: number
      scale: PreviewProxyScale
      segmentIndex: number
    }
  | {
      status: "ready"
      assetId: string
      fingerprint: string
      runtimeAsset: RuntimeAsset
      scale: PreviewProxyScale
      segmentIndex: number
      sourceEndSeconds: number
      sourceStartSeconds: number
    }
  | {
      status: "error"
      assetId: string
      fingerprint: string
      scale: PreviewProxyScale
      segmentIndex: number
    }
type PreviewProxyMap = Record<string, PreviewProxyEntry>
type PreviewProxyAssetProgress = {
  completed: number
  failed: number
  total: number
}
type PreviewProxyAssetProgressMap = Record<string, PreviewProxyAssetProgress>
const TIMELINE_MIN_ZOOM = 0.4
const TIMELINE_MAX_ZOOM = 80
const MAX_MEDIA_VOLUME = 2
const WAVEFORM_MIN_VISIBLE_VOLUME = 0.001
const MAX_PERSISTED_FILE_BLOB_BYTES = 1024 * 1024 * 1024
const CARD_CLASS = "rounded-xl bg-card"
const EDITOR_LAYOUT_STORAGE_KEY = "local-video-editor:editor-layout"
const DEFAULT_INSPECTOR_WIDTH = 320
const MIN_INSPECTOR_WIDTH = 240
const MAX_INSPECTOR_WIDTH = 520
const DEFAULT_TIMELINE_PANEL_HEIGHT = 40 + TIMELINE_VIEWPORT_HEIGHT
const MIN_TIMELINE_PANEL_HEIGHT = 160
const MAX_TIMELINE_PANEL_HEIGHT = 420
const RESIZE_GAP_SIZE = 12

const ASPECT_RATIO_OPTIONS = [
  {
    label: "16:9",
    value: "16:9",
    width: 16,
    height: 9,
    resolutions: [
      { label: "1920 x 1080", width: 1920, height: 1080 },
      { label: "1280 x 720", width: 1280, height: 720 },
      { label: "3840 x 2160", width: 3840, height: 2160 },
    ],
  },
  {
    label: "9:16",
    value: "9:16",
    width: 9,
    height: 16,
    resolutions: [
      { label: "1080 x 1920", width: 1080, height: 1920 },
      { label: "720 x 1280", width: 720, height: 1280 },
      { label: "2160 x 3840", width: 2160, height: 3840 },
    ],
  },
  {
    label: "1:1",
    value: "1:1",
    width: 1,
    height: 1,
    resolutions: [
      { label: "1080 x 1080", width: 1080, height: 1080 },
      { label: "2048 x 2048", width: 2048, height: 2048 },
    ],
  },
  {
    label: "4:5",
    value: "4:5",
    width: 4,
    height: 5,
    resolutions: [
      { label: "1080 x 1350", width: 1080, height: 1350 },
      { label: "1440 x 1800", width: 1440, height: 1800 },
    ],
  },
  {
    label: "4:3",
    value: "4:3",
    width: 4,
    height: 3,
    resolutions: [
      { label: "1440 x 1080", width: 1440, height: 1080 },
      { label: "1024 x 768", width: 1024, height: 768 },
    ],
  },
  {
    label: "21:9",
    value: "21:9",
    width: 21,
    height: 9,
    resolutions: [
      { label: "2560 x 1080", width: 2560, height: 1080 },
      { label: "3440 x 1440", width: 3440, height: 1440 },
    ],
  },
] as const

const FRAME_RATE_OPTIONS = [
  { label: "30 fps", value: "30", fps: 30 },
  { label: "60 fps", value: "60", fps: 60 },
] as const

type InspectorView = "project" | "selection" | "files"

type SourceAssetGroup = {
  key: string
  primaryAsset: SourceAsset
  assets: SourceAsset[]
}

type TimelineItemPreviewPatch =
  | {
      type: "clip"
      id: string
      patch: Partial<TimelineClip>
      insertTrackAtTop?: boolean
    }
  | {
      type: "music"
      id: string
      patch: Partial<MusicTrack>
      insertTrackAtTop?: boolean
    }

type TimelineItemCommitOptions = {
  insertTrackAtTop?: boolean
}

type ExportUiState = {
  progress: number
  message: string
  url?: string
  extension?: ExportFormat
  controller?: AbortController
  cleanup?: () => Promise<void>
}

type PendingReconnect = {
  assetIds: string[]
  assetName: string
  file: File
  fileHandle?: FileSystemFileHandle
  metadata: MediaMetadata
  warnings: string[]
}

type LocalFileDebugRestore = {
  restoredCount: number
  permissionNeededCount: number
  unavailableCount: number
  diagnostics: FileRestoreDiagnostic[]
}

function applyTimelineItemPreviewPatch(
  project: Project | null,
  preview: TimelineItemPreviewPatch | null
) {
  if (!project || !preview) {
    return project
  }

  if (preview.type === "clip") {
    let matched = false
    const clips = project.clips.map((clip) => {
      if (clip.id !== preview.id) {
        return preview.insertTrackAtTop
          ? { ...clip, trackIndex: getTrackIndex(clip) + 1 }
          : clip
      }

      matched = true
      return { ...clip, ...preview.patch }
    })
    const musicTracks = preview.insertTrackAtTop
      ? project.musicTracks.map((track) => ({
          ...track,
          trackIndex: getTrackIndex(track) + 1,
        }))
      : project.musicTracks

    return matched ? { ...project, clips, musicTracks } : project
  }

  let matched = false
  const musicTracks = project.musicTracks.map((track) => {
    if (track.id !== preview.id) {
      return preview.insertTrackAtTop
        ? { ...track, trackIndex: getTrackIndex(track) + 1 }
        : track
    }

    matched = true
    return { ...track, ...preview.patch }
  })
  const clips = preview.insertTrackAtTop
    ? project.clips.map((clip) => ({
        ...clip,
        trackIndex: getTrackIndex(clip) + 1,
      }))
    : project.clips

  return matched ? { ...project, clips, musicTracks } : project
}

export function EditorClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id
  const [project, setProject] = useState<Project | null>(null)
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetMap>({})
  const [selection, setSelection] = useState<Selection>({ type: "project" })
  const [inspectorView, setInspectorView] = useState<InspectorView>("project")
  const [playheadSeconds, setPlayheadSeconds] = useState(0)
  const [timelineZoom, setTimelineZoom] = useState(4)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [previewResolutionScale, setPreviewResolutionScale] =
    useState<PreviewResolutionScale>(DEFAULT_PREVIEW_RESOLUTION_SCALE)
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false)
  const [isTimelineScrubSettling, setIsTimelineScrubSettling] = useState(false)
  const [timelineItemPreview, setTimelineItemPreview] =
    useState<TimelineItemPreviewPatch | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [exportState, setExportState] = useState<ExportUiState>({
    progress: 0,
    message: "Idle",
  })
  const exportStateRef = useRef(exportState)
  const [pendingReconnect, setPendingReconnect] =
    useState<PendingReconnect | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    getStoredEditorLayoutValue(
      "inspectorWidth",
      DEFAULT_INSPECTOR_WIDTH,
      MIN_INSPECTOR_WIDTH,
      MAX_INSPECTOR_WIDTH
    )
  )
  const [timelinePanelHeight, setTimelinePanelHeight] = useState(() =>
    getStoredEditorLayoutValue(
      "timelinePanelHeight",
      DEFAULT_TIMELINE_PANEL_HEIGHT,
      MIN_TIMELINE_PANEL_HEIGHT,
      MAX_TIMELINE_PANEL_HEIGHT
    )
  )
  const [activeResizeHandle, setActiveResizeHandle] = useState<
    "columns" | "timeline" | null
  >(null)
  const resizeDragRef = useRef<{
    handle: "columns" | "timeline"
    pointerX: number
    pointerY: number
    inspectorWidth: number
    timelinePanelHeight: number
  } | null>(null)
  const contentGridRef = useRef<HTMLDivElement>(null)
  const topPanelRef = useRef<HTMLDivElement>(null)
  const runtimeAssetsRef = useRef<RuntimeAssetMap>({})
  const timelineScrubSettleTimeoutRef = useRef<number | null>(null)
  const cleanedPreviewProxyAssetIdsRef = useRef<Set<string>>(new Set())

  const selectEditorSelection = useCallback((nextSelection: Selection) => {
    setSelection(nextSelection)

    if (nextSelection.type === "clip" || nextSelection.type === "music") {
      setInspectorView("selection")
      return
    }

    if (nextSelection.type === "project") {
      setInspectorView("project")
    }
  }, [])

  const deleteSelectedTimelineItem = useCallback(() => {
    if (!project) {
      return
    }

    if (selection.type === "clip") {
      if (!project.clips.some((clip) => clip.id === selection.id)) {
        return
      }

      setProject({
        ...project,
        clips: project.clips.filter((clip) => clip.id !== selection.id),
        updatedAt: Date.now(),
      })
      selectEditorSelection({ type: "project" })
      return
    }

    if (selection.type === "music") {
      if (!project.musicTracks.some((track) => track.id === selection.id)) {
        return
      }

      setProject({
        ...project,
        musicTracks: project.musicTracks.filter(
          (track) => track.id !== selection.id
        ),
        updatedAt: Date.now(),
      })
      selectEditorSelection({ type: "project" })
    }
  }, [project, selectEditorSelection, selection])

  const handleTimelineSeekingChange = useCallback((isSeeking: boolean) => {
    if (timelineScrubSettleTimeoutRef.current !== null) {
      window.clearTimeout(timelineScrubSettleTimeoutRef.current)
      timelineScrubSettleTimeoutRef.current = null
    }

    if (isSeeking) {
      setIsTimelineScrubbing(true)
      setIsTimelineScrubSettling(true)
      return
    }

    setIsTimelineScrubbing(false)
    setIsTimelineScrubSettling(true)
    timelineScrubSettleTimeoutRef.current = window.setTimeout(() => {
      setIsTimelineScrubSettling(false)
      timelineScrubSettleTimeoutRef.current = null
    }, PREVIEW_SCRUB_SETTLE_MS)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isArrowKey = event.key === "ArrowLeft" || event.key === "ArrowRight"
      const isEscapeKey = event.key === "Escape"

      if (
        (event.repeat && !isArrowKey) ||
        (event.code !== "Space" &&
          event.key !== " " &&
          event.key !== "Backspace" &&
          event.key !== "Delete" &&
          !isEscapeKey &&
          !isArrowKey) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTextEditingTarget(event.target)
      ) {
        return
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault()
        setIsPlaying((current) => !current)
        return
      }

      if (isArrowKey) {
        event.preventDefault()
        const direction = event.key === "ArrowRight" ? 1 : -1
        const stepSeconds = event.shiftKey ? 10 : 1
        const maxSeconds = project ? getProjectDuration(project) : Infinity

        setPlayheadSeconds((current) =>
          clamp(current + direction * stepSeconds, 0, maxSeconds)
        )
        return
      }

      if (isEscapeKey) {
        if (selection.type === "clip" || selection.type === "music") {
          event.preventDefault()
          selectEditorSelection({ type: "project" })
        }

        return
      }

      event.preventDefault()
      deleteSelectedTimelineItem()
    }

    window.addEventListener("keydown", onKeyDown)

    return () => window.removeEventListener("keydown", onKeyDown)
  }, [deleteSelectedTimelineItem, project, selectEditorSelection, selection.type])

  useEffect(
    () => () => {
      if (timelineScrubSettleTimeoutRef.current !== null) {
        window.clearTimeout(timelineScrubSettleTimeoutRef.current)
      }
    },
    []
  )

  useEffect(() => {
    saveEditorLayout({
      inspectorWidth,
      timelinePanelHeight,
    })
  }, [inspectorWidth, timelinePanelHeight])

  useEffect(() => {
    function clampLayoutToViewport() {
      const contentRect = contentGridRef.current?.getBoundingClientRect()
      const topPanelRect = topPanelRef.current?.getBoundingClientRect()

      if (contentRect) {
        const maxHeight = Math.max(
          MIN_TIMELINE_PANEL_HEIGHT,
          Math.min(MAX_TIMELINE_PANEL_HEIGHT, contentRect.height - 360)
        )

        setTimelinePanelHeight((current) =>
          clamp(current, MIN_TIMELINE_PANEL_HEIGHT, maxHeight)
        )
      }

      if (topPanelRect) {
        const maxWidth = Math.max(
          MIN_INSPECTOR_WIDTH,
          Math.min(MAX_INSPECTOR_WIDTH, topPanelRect.width - 360)
        )

        setInspectorWidth((current) =>
          clamp(current, MIN_INSPECTOR_WIDTH, maxWidth)
        )
      }
    }

    clampLayoutToViewport()
    window.addEventListener("resize", clampLayoutToViewport)

    return () => window.removeEventListener("resize", clampLayoutToViewport)
  }, [])

  useEffect(() => {
    function preventPageZoomWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
      }
    }

    function preventPageZoomKeys(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      if (
        event.code === "Equal" ||
        event.code === "Minus" ||
        event.code === "Digit0" ||
        event.code === "NumpadAdd" ||
        event.code === "NumpadSubtract" ||
        event.key === "+" ||
        event.key === "-" ||
        event.key === "=" ||
        event.key === "0"
      ) {
        event.preventDefault()
      }
    }

    function preventGestureZoom(event: Event) {
      event.preventDefault()
    }

    window.addEventListener("wheel", preventPageZoomWheel, {
      capture: true,
      passive: false,
    })
    window.addEventListener("keydown", preventPageZoomKeys, { capture: true })
    window.addEventListener("gesturestart", preventGestureZoom, {
      passive: false,
    })
    window.addEventListener("gesturechange", preventGestureZoom, {
      passive: false,
    })

    return () => {
      window.removeEventListener("wheel", preventPageZoomWheel, {
        capture: true,
      })
      window.removeEventListener("keydown", preventPageZoomKeys, {
        capture: true,
      })
      window.removeEventListener("gesturestart", preventGestureZoom)
      window.removeEventListener("gesturechange", preventGestureZoom)
    }
  }, [])

  useEffect(() => {
    let active = true

    getProject(projectId).then((loadedProject) => {
      if (!active) {
        return
      }

      if (!loadedProject) {
        router.replace("/projects")
        return
      }

      publishLocalFileDebug("project-loaded", loadedProject)
      requestPersistentStorage().catch(() => false)

      restoreSavedFileHandles(loadedProject, false)
    })

    async function restoreSavedFileHandles(
      targetProject: Project,
      requestPermission: boolean
    ) {
      const result = await restoreProjectFileHandles(
        targetProject,
        requestPermission
      )

      if (!active) {
        if (result.runtimeAssets) {
          Object.values(result.runtimeAssets).forEach((asset) =>
            URL.revokeObjectURL(asset.objectUrl)
          )
        }
        return
      }

      publishLocalFileDebug("restore-complete", targetProject, result)

      setProject(targetProject)

      if (result.restoredCount > 0) {
        setRuntimeAssets(result.runtimeAssets)
      }

    }

    return () => {
      active = false
    }
  }, [projectId, router])

  useEffect(() => {
    runtimeAssetsRef.current = runtimeAssets
  }, [runtimeAssets])

  useEffect(() => {
    if (!project) {
      return
    }

    const referencedAssetIds = new Set(
      [...project.clips, ...project.musicTracks].map(
        (item) => item.sourceAssetId
      )
    )
    const referencedVideoFingerprints = new Set(
      project.sourceAssets
        .filter(
          (asset) =>
            asset.type === "video" && referencedAssetIds.has(asset.id)
        )
        .map((asset) => getSourceAssetPreviewFingerprint(asset))
    )
    const unreferencedVideoAssets = project.sourceAssets.filter(
      (asset) =>
        asset.type === "video" &&
        !referencedAssetIds.has(asset.id) &&
        !referencedVideoFingerprints.has(
          getSourceAssetPreviewFingerprint(asset)
        ) &&
        !cleanedPreviewProxyAssetIdsRef.current.has(asset.id)
    )

    referencedAssetIds.forEach((assetId) =>
      cleanedPreviewProxyAssetIdsRef.current.delete(assetId)
    )

    if (unreferencedVideoAssets.length === 0) {
      return
    }

    unreferencedVideoAssets.forEach((asset) =>
      cleanedPreviewProxyAssetIdsRef.current.add(asset.id)
    )
    deletePreviewProxiesForAssets(unreferencedVideoAssets).catch(() => undefined)
  }, [project])

  useEffect(() => {
    exportStateRef.current = exportState
  }, [exportState])

  useEffect(() => {
    return () => {
      Object.values(runtimeAssetsRef.current).forEach((asset) =>
        URL.revokeObjectURL(asset.objectUrl)
      )
      cleanupExportResult(exportStateRef.current)
    }
  }, [])

  useEffect(() => {
    if (!project) {
      return
    }

    const timeout = window.setTimeout(() => {
      saveProject(project).catch(() => undefined)
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [project])

  const selectedClip =
    selection.type === "clip"
      ? (project?.clips.find((clip) => clip.id === selection.id) ?? null)
      : null
  const selectedMusic =
    selection.type === "music"
      ? (project?.musicTracks.find((track) => track.id === selection.id) ??
        null)
      : null
  const selectedAsset = selectedClip
    ? (project?.sourceAssets.find(
        (asset) => asset.id === selectedClip.sourceAssetId
      ) ?? null)
    : selectedMusic
      ? (project?.sourceAssets.find(
          (asset) => asset.id === selectedMusic.sourceAssetId
        ) ?? null)
      : null
  const missingAssets = project
    ? project.sourceAssets.filter((asset) => !runtimeAssets[asset.id])
    : []

  async function importFiles(
    files: File[],
    handles: Record<string, FileSystemFileHandle | undefined> = {},
    placement?: TimelineDropPlacement
  ) {
    if (!project) {
      return
    }

    const supportedFiles = files
      .map((file) => ({ file, type: getFileKind(file) }))
      .filter((item): item is { file: File; type: "video" | "audio" } =>
        Boolean(item.type)
      )
    const unsupportedFiles = files.filter((file) => !getFileKind(file))

    if (unsupportedFiles.length > 0) {
      showUnsupportedMediaToast(unsupportedFiles)
    }

    if (supportedFiles.length === 0) {
      return
    }

    const baseClips = placement?.insertTrackAtTop
      ? project.clips.map((clip) => ({
          ...clip,
          trackIndex: getTrackIndex(clip) + 1,
        }))
      : project.clips
    const baseMusicTracks = placement?.insertTrackAtTop
      ? project.musicTracks.map((track) => ({
          ...track,
          trackIndex: getTrackIndex(track) + 1,
        }))
      : project.musicTracks
    const importedAssets: SourceAsset[] = []
    const importedClips: TimelineClip[] = []
    const importedTracks: MusicTrack[] = []
    const nextRuntimeAssets: Record<string, RuntimeAsset> = {}
    let nextTimelineStart =
      placement?.timelineStartSeconds ?? getProjectDuration(project)
    let placedTimelineOffset = 0

    for (const { file, type } of supportedFiles) {
      const metadata = await readMediaMetadata(file, type)
      const fileHandle = handles[file.name]
      const fileBlob = getPersistedFileBlob(file)
      const asset: SourceAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        type,
        sizeBytes: file.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        createdAt: Date.now(),
        fingerprint: getSourceFileFingerprint(file),
        fileHandle,
        fileBlob,
      }
      const sourceEndSeconds = metadata.durationSeconds ?? 5

      importedAssets.push(asset)
      nextRuntimeAssets[asset.id] = createRuntimeAsset(file)

      const timelineItems = [
        ...baseClips,
        ...baseMusicTracks,
        ...importedClips,
        ...importedTracks,
      ]
      const desiredStart = placement
        ? placement.timelineStartSeconds + placedTimelineOffset
        : nextTimelineStart
      const desiredTrackIndex = placement
        ? findNearestAvailableTrackIndex(
            timelineItems,
            placement.insertTrackAtTop ? 0 : placement.trackIndex,
            desiredStart,
            sourceEndSeconds
          )
        : findAvailableTrackIndex(timelineItems, desiredStart, sourceEndSeconds)
      const desiredTimelineStart = snapEnabled
        ? snapTimelineStart(
            desiredStart,
            sourceEndSeconds,
            timelineItems,
            getSnapThresholdSeconds(timelineZoom)
          )
        : desiredStart
      const timelineStartSeconds = findNearestNonOverlappingStart(
        desiredTimelineStart,
        sourceEndSeconds,
        timelineItems.filter(
          (item) => getTrackIndex(item) === desiredTrackIndex
        )
      )

      if (type === "video") {
        importedClips.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          timelineStartSeconds,
          trackIndex: desiredTrackIndex,
          scale: 1,
          positionX: 0,
          positionY: 0,
          muted: false,
          volume: 1,
        })
      } else {
        importedTracks.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          timelineStartSeconds,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          trackIndex: desiredTrackIndex,
          volume: 0.75,
        })
      }

      nextTimelineStart = timelineStartSeconds + sourceEndSeconds
      placedTimelineOffset += sourceEndSeconds
    }

    if (importedAssets.length === 0) {
      return
    }

    const nextProject = {
      ...project,
      sourceAssets: [...project.sourceAssets, ...importedAssets],
      clips: [...baseClips, ...importedClips],
      musicTracks: [...baseMusicTracks, ...importedTracks],
      updatedAt: Date.now(),
    }

    setRuntimeAssets((current) =>
      mergeRuntimeAssets(current, nextRuntimeAssets)
    )
    setProject(nextProject)
    await saveProject(nextProject)
    const savedProject = await getProject(nextProject.id)
    publishLocalFileDebug("import-complete", savedProject ?? nextProject)
  }

  async function importWithPicker() {
    if (!("showOpenFilePicker" in window)) {
      document.getElementById("media-import")?.click()
      return
    }

    const selected = await chooseLocalFiles("video,audio").catch(() => [])

    if (selected.length > 0) {
      await importFiles(
        selected.map((item) => item.file),
        Object.fromEntries(
          selected.map((item) => [item.file.name, item.fileHandle])
        )
      )
    } else {
      document.getElementById("media-import")?.click()
    }
  }

  async function importFromDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const dropped = await getDroppedLocalFiles(event.dataTransfer)

    await importFiles(
      dropped.map((item) => item.file),
      Object.fromEntries(
        dropped.map((item) => [item.file.name, item.fileHandle])
      )
    )
  }

  async function importTimelineDrop(
    dropped: TimelineDroppedFile[],
    placement: TimelineDropPlacement
  ) {
    await importFiles(
      dropped.map((item) => item.file),
      Object.fromEntries(
        dropped.map((item) => [item.file.name, item.fileHandle])
      ),
      placement
    )
  }

  function allowDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
  }

  function getMaxInspectorWidth() {
    const rect = topPanelRef.current?.getBoundingClientRect()

    if (!rect) {
      return MAX_INSPECTOR_WIDTH
    }

    return Math.max(
      MIN_INSPECTOR_WIDTH,
      Math.min(MAX_INSPECTOR_WIDTH, rect.width - 360 - RESIZE_GAP_SIZE)
    )
  }

  function getMaxTimelinePanelHeight() {
    const rect = contentGridRef.current?.getBoundingClientRect()

    if (!rect) {
      return MAX_TIMELINE_PANEL_HEIGHT
    }

    return Math.max(
      MIN_TIMELINE_PANEL_HEIGHT,
      Math.min(MAX_TIMELINE_PANEL_HEIGHT, rect.height - 360)
    )
  }

  function resizeInspector(event: PointerEvent<HTMLButtonElement>) {
    const drag = resizeDragRef.current

    if (!drag || drag.handle !== "columns") {
      return
    }

    setInspectorWidth(
      clamp(
        drag.inspectorWidth + event.clientX - drag.pointerX,
        MIN_INSPECTOR_WIDTH,
        getMaxInspectorWidth()
      )
    )
  }

  function resizeTimeline(event: PointerEvent<HTMLButtonElement>) {
    const drag = resizeDragRef.current

    if (!drag || drag.handle !== "timeline") {
      return
    }

    setTimelinePanelHeight(
      clamp(
        drag.timelinePanelHeight + drag.pointerY - event.clientY,
        MIN_TIMELINE_PANEL_HEIGHT,
        getMaxTimelinePanelHeight()
      )
    )
  }

  function startInspectorResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeDragRef.current = {
      handle: "columns",
      pointerX: event.clientX,
      pointerY: event.clientY,
      inspectorWidth,
      timelinePanelHeight,
    }
    setActiveResizeHandle("columns")
  }

  function startTimelineResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeDragRef.current = {
      handle: "timeline",
      pointerX: event.clientX,
      pointerY: event.clientY,
      inspectorWidth,
      timelinePanelHeight,
    }
    setActiveResizeHandle("timeline")
  }

  function moveResizeHandle(event: PointerEvent<HTMLButtonElement>) {
    if (activeResizeHandle === "columns") {
      resizeInspector(event)
      return
    }

    if (activeResizeHandle === "timeline") {
      resizeTimeline(event)
    }
  }

  function stopResizeHandle() {
    resizeDragRef.current = null
    setActiveResizeHandle(null)
  }

  function resetInspectorWidth() {
    setInspectorWidth(DEFAULT_INSPECTOR_WIDTH)
  }

  function resetTimelinePanelHeight() {
    setTimelinePanelHeight(DEFAULT_TIMELINE_PANEL_HEIGHT)
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    importFiles(files)
  }

  function updateClip(
    id: string,
    patch: Partial<TimelineClip>,
    options: TimelineItemCommitOptions = {}
  ) {
    if (!project) {
      return
    }

    const clips = options.insertTrackAtTop
      ? project.clips.map((clip) =>
          clip.id === id
            ? clip
            : { ...clip, trackIndex: getTrackIndex(clip) + 1 }
        )
      : project.clips
    const musicTracks = options.insertTrackAtTop
      ? project.musicTracks.map((track) => ({
          ...track,
          trackIndex: getTrackIndex(track) + 1,
        }))
      : project.musicTracks
    const timelineItems = [...clips, ...musicTracks]
    const commitPatch = options.insertTrackAtTop
      ? { ...patch, trackIndex: 0 }
      : patch

    setProject({
      ...project,
      clips: clips.map((clip) =>
        clip.id === id
          ? constrainTimelineItemPatch(
              clip,
              timelineItems,
              commitPatch,
              snapEnabled ? timelineItems : null,
              getSnapThresholdSeconds(timelineZoom),
              getTimelineItemSourceDuration(clip, project.sourceAssets)
            )
          : clip
      ),
      musicTracks,
      updatedAt: Date.now(),
    })
  }

  function updateMusic(
    id: string,
    patch: Partial<MusicTrack>,
    options: TimelineItemCommitOptions = {}
  ) {
    if (!project) {
      return
    }

    const clips = options.insertTrackAtTop
      ? project.clips.map((clip) => ({
          ...clip,
          trackIndex: getTrackIndex(clip) + 1,
        }))
      : project.clips
    const musicTracks = options.insertTrackAtTop
      ? project.musicTracks.map((track) =>
          track.id === id
            ? track
            : { ...track, trackIndex: getTrackIndex(track) + 1 }
        )
      : project.musicTracks
    const timelineItems = [...clips, ...musicTracks]
    const commitPatch = options.insertTrackAtTop
      ? { ...patch, trackIndex: 0 }
      : patch

    setProject({
      ...project,
      clips,
      musicTracks: musicTracks.map((track) =>
        track.id === id
          ? constrainTimelineItemPatch(
              track,
              timelineItems,
              commitPatch,
              snapEnabled ? timelineItems : null,
              getSnapThresholdSeconds(timelineZoom),
              getTimelineItemSourceDuration(track, project.sourceAssets)
            )
          : track
      ),
      updatedAt: Date.now(),
    })
  }

  function splitSelectedClip() {
    if (!project || !selectedClip) {
      return
    }

    const clipDuration = getClipDuration(selectedClip)
    const localSplit = playheadSeconds - selectedClip.timelineStartSeconds

    if (localSplit <= 0.2 || localSplit >= clipDuration - 0.2) {
      return
    }

    const splitSourceTime = selectedClip.sourceStartSeconds + localSplit
    const nextClip: TimelineClip = {
      ...selectedClip,
      id: crypto.randomUUID(),
      sourceStartSeconds: splitSourceTime,
      timelineStartSeconds: playheadSeconds,
    }

    setProject({
      ...project,
      clips: project.clips.flatMap((clip) =>
        clip.id === selectedClip.id
          ? [{ ...clip, sourceEndSeconds: splitSourceTime }, nextClip]
          : [clip]
      ),
      updatedAt: Date.now(),
    })
    selectEditorSelection({ type: "clip", id: nextClip.id })
  }

  async function reconnectAsset(
    assetId: string | string[],
    file: File,
    fileHandle?: FileSystemFileHandle
  ) {
    if (!project) {
      return
    }

    const assetIds = Array.isArray(assetId) ? assetId : [assetId]
    const assetIdSet = new Set(assetIds)
    const assets = project.sourceAssets.filter((item) => assetIdSet.has(item.id))
    const asset = assets[0]

    if (!asset) {
      return
    }

    const fileKind = getFileKind(file)

    if (fileKind && fileKind !== asset.type) {
      return
    }

    const metadata = await readMediaMetadata(file, asset.type)
    const warnings = getReconnectWarnings(asset, file, metadata)

    if (warnings.length > 0) {
      setPendingReconnect({
        assetIds,
        assetName: asset.name,
        file,
        fileHandle,
        metadata,
        warnings,
      })
      return
    }

    await commitReconnectAsset({
      assetIds,
      assetName: asset.name,
      file,
      fileHandle,
      metadata,
      warnings,
    })
  }

  async function commitReconnectAsset({
    assetIds,
    file,
    fileHandle,
    metadata,
  }: PendingReconnect) {
    if (!project) {
      return
    }

    const assetIdSet = new Set(assetIds)
    const assets = project.sourceAssets.filter((item) => assetIdSet.has(item.id))
    const asset = assets[0]

    if (!asset) {
      return
    }

    const nextRuntimeAssets = Object.fromEntries(
      assets.map((item) => [item.id, createRuntimeAsset(file)])
    )
    setRuntimeAssets((current) => mergeRuntimeAssets(current, nextRuntimeAssets))
    const nextProject = {
      ...project,
      sourceAssets: project.sourceAssets.map((item) =>
        assetIdSet.has(item.id)
          ? {
              ...item,
              durationSeconds: metadata.durationSeconds ?? item.durationSeconds,
              fingerprint: getSourceFileFingerprint(file),
              fileHandle: fileHandle ?? item.fileHandle,
              fileBlob: getPersistedFileBlob(file),
              height: metadata.height ?? item.height,
              name: file.name,
              sizeBytes: file.size,
              width: metadata.width ?? item.width,
            }
          : item
      ),
      updatedAt: Date.now(),
    }

    setProject(nextProject)
    await saveProject(nextProject)
    const savedProject = await getProject(nextProject.id)
    publishLocalFileDebug("reconnect-complete", savedProject ?? nextProject)
  }

  async function runExport() {
    if (!project) {
      return
    }

    if (exportStateRef.current.controller) {
      return
    }

    cleanupExportResult(exportStateRef.current)

    const controller = new AbortController()
    setExportState({
      progress: 0,
      message: "Preparing local export",
      controller,
    })

    try {
      const result = await exportProjectToVideo({
        project,
        runtimeAssets,
        signal: controller.signal,
        onProgress: ({ progress, message }) =>
          setExportState((current) => ({ ...current, progress, message })),
      })
      const url = URL.createObjectURL(result.blob)
      triggerExportDownload({
        extension: result.extension,
        projectName: project.name,
        url,
      })
      setExportState({
        progress: 1,
        message: `${result.extension.toUpperCase()} export ready`,
        cleanup: result.cleanup,
        extension: result.extension,
        url,
      })
    } catch (reason) {
      setExportState({
        progress: 0,
        message: reason instanceof Error ? reason.message : "Export failed",
      })
    }
  }

  const previewProject = useMemo(
    () => applyTimelineItemPreviewPatch(project, timelineItemPreview),
    [project, timelineItemPreview]
  )

  if (!project) {
    return (
      <main className="grid min-h-svh place-items-center bg-background text-sm text-muted-foreground">
        Loading local project...
      </main>
    )
  }

  return (
    <main className="flex h-svh min-h-[720px] w-full max-w-[100vw] min-w-0 flex-col overflow-hidden bg-background text-foreground select-none">
      <header className="flex h-11 min-w-0 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/projects" />}
            aria-label="Back to projects"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <Input
              className="h-7 w-auto min-w-[50px] max-w-[38vw] border-transparent bg-transparent px-2.5 text-sm font-medium shadow-none select-text [field-sizing:content] hover:bg-input focus:bg-input focus-visible:bg-input"
              value={project.name}
              onChange={(event) =>
                setProject({
                  ...project,
                  name: event.target.value,
                  updatedAt: Date.now(),
                })
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            className="hidden"
            id="media-import"
            type="file"
            accept="video/*,audio/*"
            multiple
            onChange={onFileInput}
          />
          <AppSettingsMenu />
          <Button variant="outline" size="sm" onClick={importWithPicker}>
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <ExportDialog
            project={project}
            exportState={exportState}
            onExport={runExport}
            onCancelExport={() => exportState.controller?.abort()}
            onFormatChange={(format) =>
              setProject({
                ...project,
                exportSettings: { ...project.exportSettings, format },
                updatedAt: Date.now(),
              })
            }
            onCompressionChange={(compression) =>
              setProject({
                ...project,
                exportSettings: { ...project.exportSettings, compression },
                updatedAt: Date.now(),
              })
            }
          />
        </div>
      </header>

      <section
        ref={contentGridRef}
        className="grid min-h-0 min-w-0 flex-1 p-3 pt-0"
        style={{
          gridTemplateRows: `minmax(360px, 1fr) ${RESIZE_GAP_SIZE}px ${timelinePanelHeight}px`,
        }}
        onDragOver={allowDrop}
        onDrop={importFromDrop}
      >
        <div
          ref={topPanelRef}
          className="grid min-h-[360px] min-w-0 overflow-visible"
          style={{
            gridTemplateColumns: `${inspectorWidth}px ${RESIZE_GAP_SIZE}px minmax(0, 1fr)`,
          }}
        >
          <InspectorPanel
            view={inspectorView}
            onViewChange={setInspectorView}
            project={project}
            selectedAsset={selectedAsset}
            selectedClip={selectedClip}
            selectedMusic={selectedMusic}
            missingAssets={missingAssets}
            onClipChange={updateClip}
            onMusicChange={updateMusic}
            onProjectChange={(patch) =>
              setProject({
                ...project,
                exportSettings: { ...project.exportSettings, ...patch },
                updatedAt: Date.now(),
              })
            }
            onReconnect={reconnectAsset}
          />
          <div className="grid min-h-0 place-items-center">
            <ResizeGapHandle
              aria-label="Resize inspector"
              orientation="vertical"
              active={activeResizeHandle === "columns"}
              onPointerDown={startInspectorResize}
              onPointerMove={moveResizeHandle}
              onPointerUp={stopResizeHandle}
              onPointerCancel={stopResizeHandle}
              onLostPointerCapture={stopResizeHandle}
              onDoubleClick={resetInspectorWidth}
            />
          </div>
          <PreviewStage
            project={previewProject ?? project}
            runtimeAssets={runtimeAssets}
            playheadSeconds={playheadSeconds}
            isPlaying={isPlaying}
            isScrubbing={isTimelineScrubbing || isTimelineScrubSettling}
            previewResolutionScale={previewResolutionScale}
            onPlayChange={setIsPlaying}
            onPlayheadChange={setPlayheadSeconds}
            onPreviewResolutionScaleChange={setPreviewResolutionScale}
            onOpenFileList={() => setInspectorView("files")}
          />
        </div>

        <div className="grid min-w-0 place-items-center">
          <ResizeGapHandle
            aria-label="Resize timeline"
            orientation="horizontal"
            active={activeResizeHandle === "timeline"}
            onPointerDown={startTimelineResize}
            onPointerMove={moveResizeHandle}
            onPointerUp={stopResizeHandle}
            onPointerCancel={stopResizeHandle}
            onLostPointerCapture={stopResizeHandle}
            onDoubleClick={resetTimelinePanelHeight}
          />
        </div>

        <Timeline
          project={project}
          runtimeAssets={runtimeAssets}
          selection={selection}
          playheadSeconds={playheadSeconds}
          zoom={timelineZoom}
          viewportHeight={Math.max(96, timelinePanelHeight - 40)}
          onSelect={selectEditorSelection}
          onPlayheadChange={setPlayheadSeconds}
          onSeekingChange={handleTimelineSeekingChange}
          onClipChange={updateClip}
          onMusicChange={updateMusic}
          onZoomChange={setTimelineZoom}
          onSplit={splitSelectedClip}
          canSplit={Boolean(selectedClip)}
          onDelete={deleteSelectedTimelineItem}
          canDelete={selection.type === "clip" || selection.type === "music"}
          snapEnabled={snapEnabled}
          onSnapEnabledChange={setSnapEnabled}
          onClipPreviewChange={(id, preview) =>
            setTimelineItemPreview(
              preview
                ? {
                    type: "clip",
                    id,
                    patch: preview.patch as Partial<TimelineClip>,
                    insertTrackAtTop: preview.insertTrackAtTop,
                  }
                : null
            )
          }
          onMusicPreviewChange={(id, preview) =>
            setTimelineItemPreview(
              preview
                ? {
                    type: "music",
                    id,
                    patch: preview.patch as Partial<MusicTrack>,
                    insertTrackAtTop: preview.insertTrackAtTop,
                  }
                : null
            )
          }
          onDropFiles={importTimelineDrop}
        />
      </section>
      <ReconnectWarningDialog
        pendingReconnect={pendingReconnect}
        onCancel={() => setPendingReconnect(null)}
        onConfirm={() => {
          const reconnect = pendingReconnect

          if (!reconnect) {
            return
          }

          setPendingReconnect(null)
          void commitReconnectAsset(reconnect)
        }}
      />
    </main>
  )
}

function InspectorPanel({
  view,
  onViewChange,
  project,
  selectedAsset,
  selectedClip,
  selectedMusic,
  missingAssets,
  onClipChange,
  onMusicChange,
  onProjectChange,
  onReconnect,
}: {
  view: InspectorView
  onViewChange: (view: InspectorView) => void
  project: Project
  selectedAsset: SourceAsset | null
  selectedClip: TimelineClip | null
  selectedMusic: MusicTrack | null
  missingAssets: SourceAsset[]
  onClipChange: (id: string, patch: Partial<TimelineClip>) => void
  onMusicChange: (id: string, patch: Partial<MusicTrack>) => void
  onProjectChange: (patch: Partial<Project["exportSettings"]>) => void
  onReconnect: (
    assetId: string | string[],
    file: File,
    fileHandle?: FileSystemFileHandle
  ) => void
}) {
  const timelineAssetIds = new Set(
    [...project.clips, ...project.musicTracks].map((item) => item.sourceAssetId)
  )
  const timelineAssets = project.sourceAssets.filter((asset) =>
    timelineAssetIds.has(asset.id)
  )
  const missingTimelineAssets = missingAssets.filter((asset) =>
    timelineAssetIds.has(asset.id)
  )
  const missingAssetIds = new Set(
    missingTimelineAssets.map((asset) => asset.id)
  )
  const selectedAssetMissing = selectedAsset
    ? missingAssetIds.has(selectedAsset.id)
    : false
  const heading =
    view === "files"
      ? "Files"
      : view === "selection"
        ? (selectedAsset?.name ?? "Selected item")
        : "Project details"
  const description =
    view === "files"
      ? "Imported media files stay local and can be reconnected here."
      : view === "selection"
        ? selectedAsset
          ? null
          : "Timeline item properties."
        : "Edit decisions are stored locally. Media files are referenced from disk."
  const fileGroups = groupSourceAssets([
    ...timelineAssets,
    ...missingTimelineAssets.filter(
      (asset) =>
        !timelineAssets.some((timelineAsset) => timelineAsset.id === asset.id)
    ),
  ])
  const body =
    view === "selection" && selectedClip ? (
      <div className="space-y-4">
        <RangeField
          label="Clip volume"
          value={selectedClip.muted ? 0 : selectedClip.volume}
          max={MAX_MEDIA_VOLUME}
          step={0.01}
          onChange={(value) =>
            onClipChange(selectedClip.id, { volume: value, muted: false })
          }
        />
        <RangeField
          label="Clip zoom"
          value={getClipScale(selectedClip)}
          max={2}
          step={0.01}
          onChange={(value) =>
            onClipChange(selectedClip.id, { scale: value })
          }
        />
        <RangeField
          label="Position X"
          value={getClipPositionX(selectedClip)}
          min={-100}
          max={100}
          step={1}
          formatValue={(nextValue) => `${Math.round(nextValue)}%`}
          onChange={(value) =>
            onClipChange(selectedClip.id, { positionX: value })
          }
        />
        <RangeField
          label="Position Y"
          value={getClipPositionY(selectedClip)}
          min={-100}
          max={100}
          step={1}
          formatValue={(nextValue) => `${Math.round(nextValue)}%`}
          onChange={(value) =>
            onClipChange(selectedClip.id, { positionY: value })
          }
        />
        <NumberField
          label="Source start"
          unit="sec"
          value={selectedClip.sourceStartSeconds}
          onChange={(value) =>
            onClipChange(selectedClip.id, {
              sourceStartSeconds: Math.min(
                value,
                selectedClip.sourceEndSeconds - 0.1
              ),
            })
          }
        />
        <NumberField
          label="Source end"
          unit="sec"
          value={selectedClip.sourceEndSeconds}
          onChange={(value) =>
            onClipChange(selectedClip.id, {
              sourceEndSeconds: Math.max(
                value,
                selectedClip.sourceStartSeconds + 0.1
              ),
            })
          }
        />
      </div>
    ) : view === "selection" && selectedMusic ? (
      <div className="space-y-4">
        <RangeField
          label="Music volume"
          value={selectedMusic.volume}
          max={MAX_MEDIA_VOLUME}
          step={0.01}
          onChange={(value) =>
            onMusicChange(selectedMusic.id, { volume: value })
          }
        />
        <NumberField
          label="Timeline start"
          unit="sec"
          value={selectedMusic.timelineStartSeconds}
          onChange={(value) =>
            onMusicChange(selectedMusic.id, {
              timelineStartSeconds: Math.max(0, value),
            })
          }
        />
      </div>
    ) : view === "selection" ? (
      <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
        Select a clip or audio item on the timeline to edit its properties.
      </p>
    ) : view === "files" ? (
      <div className="space-y-4">
        {fileGroups.length === 0 ? (
          <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            Add media to the timeline to see referenced files here.
          </p>
        ) : (
          <div className="space-y-2">
            {fileGroups.map((group) => {
              const connectedCount = group.assets.filter(
                (asset) => !missingAssetIds.has(asset.id)
              ).length

              return (
                <ReconnectButton
                  key={group.key}
                  group={group}
                  connectedCount={connectedCount}
                  onReconnect={onReconnect}
                />
              )
            })}
          </div>
        )}

      </div>
    ) : (
      <ProjectSettingsFields
        project={project}
        onProjectChange={onProjectChange}
      />
    )

  return (
    <aside className={`flex min-h-0 flex-col overflow-visible ${CARD_CLASS}`}>
      <InspectorViewNav
        view={view}
        missingFileCount={missingTimelineAssets.length}
        onViewChange={onViewChange}
      />
      <div className="min-h-0 overflow-y-auto p-3">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h2 className="truncate text-base leading-5 font-semibold">
              {heading}
            </h2>
            {view === "selection" && selectedAsset ? (
              <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                <span className="truncate">
                  {selectedAsset.type} · {formatBytes(selectedAsset.sizeBytes)}
                </span>
                {selectedAssetMissing ? (
                  <Tooltip content="Missing file. Open file list.">
                    <button
                      type="button"
                      className="inline-flex size-4 shrink-0 items-center justify-center text-destructive"
                      onClick={() => onViewChange("files")}
                      aria-label="Open file list for missing file"
                    >
                      <CircleExclamation className="size-3.5" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            ) : (
              <p className="text-xs leading-5 text-pretty text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          {body}
        </div>
      </div>
    </aside>
  )
}

function InspectorViewNav({
  view,
  missingFileCount,
  onViewChange,
}: {
  view: InspectorView
  missingFileCount: number
  onViewChange: (view: InspectorView) => void
}) {
  const FilesIcon: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }> = ({ size = 14, strokeWidth = 1.5, className }) => (
    <span className={`relative inline-flex size-3.5 ${className ?? ""}`}>
      <FolderOpen className="size-full" size={size} strokeWidth={strokeWidth} />
      {missingFileCount > 0 ? (
        <span
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive"
          aria-hidden="true"
        />
      ) : null}
    </span>
  )
  const tabs: Array<{
    view: InspectorView
    label: string
    icon: ComponentType<{
      size?: number
      strokeWidth?: number
      className?: string
    }>
  }> = [
    { view: "project", label: "Project details", icon: Info },
    { view: "selection", label: "Selected item", icon: MousePointer2 },
    { view: "files", label: "Files", icon: FilesIcon },
  ]
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.view === view)
  )

  return (
    <div className="p-2">
      <TabsSubtle
        selectedIndex={selectedIndex}
        onSelect={(index) => onViewChange(tabs[index]?.view ?? "project")}
        idPrefix="editor-inspector"
        activeLabel
      >
        {tabs.map((tab, index) => (
          <TabsSubtleItem
            key={tab.view}
            index={index}
            icon={tab.icon}
            label={tab.label}
          />
        ))}
      </TabsSubtle>
    </div>
  )
}

function ProjectSettingsFields({
  project,
  onProjectChange,
}: {
  project: Project
  onProjectChange: (patch: Partial<Project["exportSettings"]>) => void
}) {
  const aspectOption = getExportAspectOption(project.exportSettings)
  const resolutionOptions = getResolutionOptions(project.exportSettings)
  const resolutionValue = getResolutionValue(
    project.exportSettings.width,
    project.exportSettings.height
  )

  return (
    <div className="space-y-4">
      <FluidSelectField
        label="Aspect ratio"
        value={aspectOption.value}
        options={ASPECT_RATIO_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        onValueChange={(value) => {
          const nextAspect =
            ASPECT_RATIO_OPTIONS.find((option) => option.value === value) ??
            ASPECT_RATIO_OPTIONS[0]
          const nextResolution = nextAspect.resolutions[0]

          onProjectChange({
            width: nextResolution.width,
            height: nextResolution.height,
          })
        }}
      />
      <FluidSelectField
        label="Resolution"
        value={resolutionValue}
        options={resolutionOptions}
        onValueChange={(value) => {
          const [width, height] = value.split("x").map(Number)

          if (Number.isFinite(width) && Number.isFinite(height)) {
            onProjectChange({ width, height })
          }
        }}
      />
      <FluidSelectField
        label="Frame rate"
        value={String(project.exportSettings.fps)}
        options={FRAME_RATE_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        onValueChange={(value) => {
          const nextFrameRate = FRAME_RATE_OPTIONS.find(
            (option) => option.value === value
          )

          if (nextFrameRate) {
            onProjectChange({ fps: nextFrameRate.fps })
          }
        }}
      />
    </div>
  )
}

function FluidSelectField({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onValueChange: (value: string) => void
}) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const selectedLabel = options[selectedIndex]?.label ?? options[0]?.label ?? label

  return (
    <div className="space-y-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <DropdownMenu>
        <DropdownTrigger className="flex h-8 w-full items-center justify-between rounded-lg border-0 bg-background px-4 text-[13px] text-muted-foreground outline-none hover:text-foreground">
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownTrigger>
        <DropdownContent checkedIndex={selectedIndex} className="z-[5010]">
          {options.map((option, index) => (
            <MenuItem
              key={option.value}
              index={index}
              label={option.label}
              checked={option.value === value}
              onSelect={() => onValueChange(option.value)}
            />
          ))}
        </DropdownContent>
      </DropdownMenu>
    </div>
  )
}

function ExportDialog({
  project,
  exportState,
  onExport,
  onCancelExport,
  onFormatChange,
  onCompressionChange,
}: {
  project: Project
  exportState: ExportUiState
  onExport: () => void
  onCancelExport: () => void
  onFormatChange: (format: ExportFormat) => void
  onCompressionChange: (compression: ExportCompression) => void
}) {
  const compression = getExportCompression(project.exportSettings)
  const formatLabel = getExportFormatLabel(project.exportSettings.format)
  const downloadExtension = exportState.extension ?? project.exportSettings.format
  const estimatedSizeBytes = getEstimatedExportSizeBytes(
    project.exportSettings,
    getProjectDuration(project)
  )
  const isExporting = Boolean(exportState.controller)
  const [open, setOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const formatOptions: Array<{ label: string; value: ExportFormat }> = [
    { label: "MP4", value: "mp4" },
    { label: "WebM", value: "webm" },
  ]
  const selectedFormatIndex = Math.max(
    0,
    formatOptions.findIndex(
      (option) => option.value === project.exportSettings.format
    )
  )
  const selectedCompressionIndex = Math.max(
    0,
    EXPORT_COMPRESSION_OPTIONS.findIndex(
      (option) => option.value === compression
    )
  )
  const compressionLabel =
    EXPORT_COMPRESSION_OPTIONS[selectedCompressionIndex]?.label ??
    "Balanced"

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCancelConfirmOpen(false)
      setOpen(true)
      return
    }

    if (isExporting) {
      setCancelConfirmOpen(true)
      return
    }

    setOpen(false)
  }

  function confirmCancelExport() {
    onCancelExport()
    setCancelConfirmOpen(false)
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={isExporting}
    >
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Download data-icon="inline-start" />
            Export
          </Button>
        }
      />
      <DialogContent className="overflow-hidden">
        <div className="grid gap-4">
          <div className="space-y-1">
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>
              Render this project locally using browser-native export. Files
              never leave this device.
            </DialogDescription>
          </div>

          <div className="text-sm">
            <Label className="mb-1 block text-xs font-normal text-muted-foreground">
              Format
            </Label>
            <DropdownMenu disabled={isExporting}>
              <DropdownTrigger
                disabled={isExporting}
                className="flex h-8 w-full items-center justify-between rounded-lg border-0 bg-background px-4 text-[13px] text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {formatLabel}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownTrigger>
              <DropdownContent
                checkedIndex={selectedFormatIndex}
                className="z-[5010]"
              >
                {formatOptions.map((option, index) => (
                  <MenuItem
                    key={option.value}
                    index={index}
                    label={option.label}
                    checked={project.exportSettings.format === option.value}
                    disabled={isExporting}
                    onSelect={() => {
                      if (!isExporting) {
                        onFormatChange(option.value)
                      }
                    }}
                  />
                ))}
              </DropdownContent>
            </DropdownMenu>
          </div>

          <div className="text-sm">
            <Label className="mb-1 block text-xs font-normal text-muted-foreground">
              Quality
            </Label>
            <DropdownMenu disabled={isExporting}>
              <DropdownTrigger
                disabled={isExporting}
                className="flex h-8 w-full items-center justify-between rounded-lg border-0 bg-background px-4 text-[13px] text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {compressionLabel}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownTrigger>
              <DropdownContent
                checkedIndex={selectedCompressionIndex}
                className="z-[5010]"
              >
                {EXPORT_COMPRESSION_OPTIONS.map((option, index) => (
                  <MenuItem
                    key={option.value}
                    index={index}
                    detail={formatExportBitrateDetail({
                      ...project.exportSettings,
                      compression: option.value,
                    })}
                    label={option.label}
                    checked={compression === option.value}
                    disabled={isExporting}
                    onSelect={() => {
                      if (!isExporting) {
                        onCompressionChange(option.value)
                      }
                    }}
                  />
                ))}
              </DropdownContent>
            </DropdownMenu>
          </div>

          <div className="text-sm">
            <Label className="mb-1 block text-xs font-normal text-muted-foreground">
              Project properties
            </Label>
            <div className="grid gap-1">
              <Metric
                label="Size"
                value={`${project.exportSettings.width}x${project.exportSettings.height}`}
              />
              <Metric
                label="Frame rate"
                value={`${project.exportSettings.fps} fps`}
              />
              <Metric
                label="Estimated size"
                value={`~${formatBytes(estimatedSizeBytes)}`}
              />
            </div>
          </div>

          <Progress value={Math.round(exportState.progress * 100)}>
            <ProgressLabel>{exportState.message}</ProgressLabel>
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {Math.round(exportState.progress * 100)}%
            </span>
          </Progress>

          <div className="flex flex-wrap justify-end gap-2">
            {exportState.controller ? (
              <Button type="button" variant="outline" onClick={onCancelExport}>
                Cancel
              </Button>
            ) : null}
            {exportState.url ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCancelConfirmOpen(false)
                    onExport()
                  }}
                >
                  Re-export
                </Button>
                <Button
                  nativeButton={false}
                  render={
                    <a
                      href={exportState.url}
                      download={`${project.name || "export"}.${downloadExtension}`}
                    />
                  }
                >
                  <Download data-icon="inline-start" />
                  Download
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  setCancelConfirmOpen(false)
                  onExport()
                }}
                disabled={isExporting}
              >
                <Download data-icon="inline-start" />
                Export {formatLabel}
              </Button>
            )}
          </div>
        </div>
        {cancelConfirmOpen && isExporting ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/45 backdrop-blur-sm"
            aria-hidden="true"
          />
        ) : null}
        <Dialog
          open={cancelConfirmOpen && isExporting}
          onOpenChange={setCancelConfirmOpen}
        >
          <DialogContent backdropClassName="z-[5002]" className="z-[5003]">
            <div className="space-y-1">
              <DialogTitle>Cancel Export?</DialogTitle>
              <DialogDescription>
                The current export is still running. Closing this dialog will
                cancel the export.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelConfirmOpen(false)}
              >
                Keep Exporting
              </Button>
              <Button type="button" onClick={confirmCancelExport}>
                Cancel Export
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function ReconnectWarningDialog({
  pendingReconnect,
  onCancel,
  onConfirm,
}: {
  pendingReconnect: PendingReconnect | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={Boolean(pendingReconnect)}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>Heads up</DialogTitle>
          <DialogDescription>
            The file you are reconnecting looks different from the original
            media reference.
          </DialogDescription>
        </div>

        {pendingReconnect ? (
          <div className="space-y-3 rounded-lg bg-muted/55 p-3 text-sm">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {pendingReconnect.assetName}
              </p>
              <p className="text-muted-foreground">
                Selected: {pendingReconnect.file.name}
              </p>
            </div>
            <ul className="space-y-1 text-muted-foreground">
              {pendingReconnect.warnings.map((warning) => (
                <li key={warning} className="flex gap-2">
                  <CircleExclamation className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Reconnect Anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ReconnectButton({
  group,
  onReconnect,
  connectedCount,
}: {
  group: SourceAssetGroup
  connectedCount: number
  onReconnect: (
    assetId: string | string[],
    file: File,
    fileHandle?: FileSystemFileHandle
  ) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const asset = group.primaryAsset
  const assetIds = group.assets.map((item) => item.id)
  const connectionStatus =
    connectedCount === group.assets.length
      ? "connected"
      : connectedCount > 0
        ? `${group.assets.length - connectedCount} missing`
        : "missing"
  const hasMissingReferences = connectedCount < group.assets.length
  const referenceLabel =
    group.assets.length > 1 ? `${group.assets.length} references · ` : ""

  async function reconnectWithPersistentPicker() {
    const accept = asset.type === "video" ? "video" : "audio"
    const selected = await chooseLocalFiles(accept).catch(() => [])
    const match =
      selected.find((item) => item.file.name === asset.name) ?? selected[0]

    if (match) {
      onReconnect(assetIds, match.file, match.fileHandle)
      return
    }

    inputRef.current?.click()
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(asset.sizeBytes)} · {referenceLabel}
          {connectionStatus}
        </p>
      </div>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={asset.type === "video" ? "video/*" : "audio/*"}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""

          if (file) {
            onReconnect(assetIds, file)
          }
        }}
      />
      {hasMissingReferences ? (
        <Tooltip content="Missing local file">
          <span
            className="inline-flex size-7 items-center justify-center text-destructive"
            aria-label="Missing local file"
          >
            <CircleExclamation className="size-4" />
          </span>
        </Tooltip>
      ) : null}
      <Tooltip
        content={
          hasMissingReferences ? "Reconnect local file" : "File is connected"
        }
      >
        <span className="inline-flex">
          <Button
            size="icon-sm"
            variant="outline"
            disabled={!hasMissingReferences}
            onClick={() => {
              if ("showOpenFilePicker" in window) {
                reconnectWithPersistentPicker()
              } else {
                inputRef.current?.click()
              }
            }}
            aria-label={`Reconnect local file for ${asset.name}`}
          >
            <LinkIcon />
          </Button>
        </span>
      </Tooltip>
    </div>
  )
}

function groupSourceAssets(assets: SourceAsset[]): SourceAssetGroup[] {
  const groups = new Map<string, SourceAssetGroup>()

  for (const asset of assets) {
    const key = getSourceAssetGroupKey(asset)
    const group = groups.get(key)

    if (group) {
      group.assets.push(asset)
      continue
    }

    groups.set(key, {
      key,
      primaryAsset: asset,
      assets: [asset],
    })
  }

  return Array.from(groups.values())
}

function getSourceAssetGroupKey(asset: SourceAsset) {
  const durationMs =
    asset.durationSeconds === undefined
      ? ""
      : Math.round(asset.durationSeconds * 1000)

  return [
    asset.type,
    asset.name.trim().toLowerCase(),
    asset.sizeBytes,
    durationMs,
    asset.width ?? "",
    asset.height ?? "",
  ].join("|")
}

function PreviewStage({
  project,
  runtimeAssets,
  playheadSeconds,
  isPlaying,
  isScrubbing,
  previewResolutionScale,
  onPlayChange,
  onPlayheadChange,
  onPreviewResolutionScaleChange,
  onOpenFileList,
}: {
  project: Project
  runtimeAssets: RuntimeAssetMap
  playheadSeconds: number
  isPlaying: boolean
  isScrubbing: boolean
  previewResolutionScale: PreviewResolutionScale
  onPlayChange: (isPlaying: boolean) => void
  onPlayheadChange: (seconds: number) => void
  onPreviewResolutionScaleChange: (scale: PreviewResolutionScale) => void
  onOpenFileList: () => void
}) {
  const playheadRef = useRef(playheadSeconds)
  const previewAudioContextRef = useRef<AudioContext | null>(null)
  const [previewAudioContext, setPreviewAudioContext] =
    useState<AudioContext | null>(null)
  const [previewIssues, setPreviewIssues] = useState<Record<string, string>>({})
  const [previewProxyMap, setPreviewProxyMap] = useState<PreviewProxyMap>({})
  const [previewProxyAssetProgress, setPreviewProxyAssetProgress] =
    useState<PreviewProxyAssetProgressMap>({})
  const [
    fullResolutionIdleFramePlayhead,
    setFullResolutionIdleFramePlayhead,
  ] = useState<number | null>(null)
  const isPreviewStageMountedRef = useRef(true)
  const referencedPreviewAssetIdsRef = useRef<Set<string>>(new Set())
  const scheduledPreviewProxyAssetsRef = useRef<Set<string>>(new Set())
  const playbackClockRef = useRef<{
    playheadSeconds: number
    startedAt: number
  } | null>(null)
  const generatedPlayheadRef = useRef<number | null>(null)
  const previewProxyMapRef = useRef<PreviewProxyMap>({})
  const previousIsPlayingRef = useRef(isPlaying)
  const sortedClips = useMemo(
    () =>
      [...project.clips].sort(
        (a, b) =>
          getTrackIndex(b) - getTrackIndex(a) ||
          a.timelineStartSeconds - b.timelineStartSeconds
      ),
    [project.clips]
  )
  const sortedMusicTracks = useMemo(
    () =>
      [...project.musicTracks].sort(
        (a, b) =>
          getTrackIndex(b) - getTrackIndex(a) ||
          a.timelineStartSeconds - b.timelineStartSeconds
      ),
    [project.musicTracks]
  )
  const activeClips = useMemo(
    () => findTimelineItemsAtTime(sortedClips, playheadSeconds),
    [playheadSeconds, sortedClips]
  )
  const previewClips = useMemo(
    () =>
      findTimelineItemsNearTime(
        sortedClips,
        playheadSeconds,
        PREVIEW_PRELOAD_SECONDS
      ),
    [playheadSeconds, sortedClips]
  )
  const activeMusicTracks = useMemo(
    () => findTimelineItemsAtTime(sortedMusicTracks, playheadSeconds),
    [playheadSeconds, sortedMusicTracks]
  )
  const hasPlayableMedia =
    sortedClips.some((clip) => runtimeAssets[clip.sourceAssetId]) ||
    sortedMusicTracks.some((track) => runtimeAssets[track.sourceAssetId])
  const hasActiveVideo = activeClips.some(
    (clip) => runtimeAssets[clip.sourceAssetId]
  )
  const activeClipIds = new Set(activeClips.map((clip) => clip.id))
  const projectDuration = getProjectDuration(project)
  const previewAspectRatio = getExportAspectRatio(project.exportSettings)
  const previewRenderScale = clampPreviewResolutionScale(previewResolutionScale)
  const previewProxyScale = getPreviewProxyScale(previewRenderScale)
  const previewProxyCandidates = useMemo(() => {
    if (!previewProxyScale) {
      return []
    }

    const assetsById = new Map(
      project.sourceAssets.map((asset) => [asset.id, asset])
    )
    const uniqueCandidates = new Map<
      string,
      {
        asset: SourceAsset
        runtimeAsset: RuntimeAsset
        segmentIndex: number
        sourceTimeSeconds: number
      }
    >()

    for (const clip of previewClips) {
      const asset = assetsById.get(clip.sourceAssetId)
      const runtimeAsset = runtimeAssets[clip.sourceAssetId]

      if (
        asset?.type === "video" &&
        runtimeAsset &&
        canCreatePreviewProxy(asset)
      ) {
        const sourceTimeSeconds = getSourceTimeForTimelineItem(
          {
            sourceEndSeconds: clip.sourceEndSeconds,
            sourceStartSeconds: clip.sourceStartSeconds,
            timelineStartSeconds: clip.timelineStartSeconds,
          },
          playheadSeconds
        )
        const segmentIndex = getPreviewProxySegmentIndex(sourceTimeSeconds)
        const segment = getPreviewProxySegmentBounds(asset, segmentIndex)

        if (segment.sourceEndSeconds <= segment.sourceStartSeconds) {
          continue
        }

        uniqueCandidates.set(
          getPreviewProxyEntryKey(asset.id, previewProxyScale, segmentIndex),
          { asset, runtimeAsset, segmentIndex, sourceTimeSeconds }
        )
      }
    }

    return Array.from(uniqueCandidates.values())
  }, [
    playheadSeconds,
    previewClips,
    previewProxyScale,
    project.sourceAssets,
    runtimeAssets,
  ])
  const isPreviewProxySegmentLoading = Boolean(
    previewProxyScale &&
      previewProxyCandidates.some(({ asset, segmentIndex }) => {
        const entry =
          previewProxyMap[
            getPreviewProxyEntryKey(asset.id, previewProxyScale, segmentIndex)
          ]
        const fingerprint = getSourceAssetPreviewFingerprint(asset)

        return (
          !entry ||
          entry.fingerprint !== fingerprint ||
          entry.status === "loading"
        )
      })
  )
  const hasPreviewProxyError = Boolean(
    previewProxyScale &&
      previewProxyCandidates.some(({ asset, segmentIndex }) => {
        const entry =
          previewProxyMap[
            getPreviewProxyEntryKey(asset.id, previewProxyScale, segmentIndex)
          ]
        const fingerprint = getSourceAssetPreviewFingerprint(asset)

        return entry?.status === "error" && entry.fingerprint === fingerprint
      })
  )
  const previewProxyBackgroundProgress = previewProxyScale
    ? getPreviewProxyBackgroundProgress(
        previewProxyCandidates,
        previewProxyMap,
        previewProxyAssetProgress,
        previewProxyScale
      )
    : null
  const isPreviewProxyBackgroundLoading = Boolean(
    previewProxyBackgroundProgress &&
      previewProxyBackgroundProgress.completed <
        previewProxyBackgroundProgress.total
  )
  const isPreviewProxyLoading =
    isPreviewProxySegmentLoading || isPreviewProxyBackgroundLoading
  const previewProxyLoadingProgress =
    previewProxyBackgroundProgress?.progress ?? null

  const shouldRenderFullResolutionIdleFrame =
    Boolean(previewProxyScale) &&
    !isPlaying &&
    !isScrubbing &&
    fullResolutionIdleFramePlayhead !== null &&
    Math.abs(fullResolutionIdleFramePlayhead - playheadSeconds) < 0.000001

  useEffect(() => {
    const wasPlaying = previousIsPlayingRef.current
    previousIsPlayingRef.current = isPlaying

    if (!previewProxyScale || isPlaying || isScrubbing) {
      return
    }

    const timer = window.setTimeout(() => {
      setFullResolutionIdleFramePlayhead(playheadSeconds)
    }, wasPlaying ? 0 : PREVIEW_IDLE_FULL_RESOLUTION_FRAME_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [isPlaying, isScrubbing, playheadSeconds, previewProxyScale])

  useEffect(
    () => {
      isPreviewStageMountedRef.current = true

      return () => {
        isPreviewStageMountedRef.current = false
        previewAudioContextRef.current?.close().catch(() => undefined)
        previewAudioContextRef.current = null
      }
    },
    []
  )

  useEffect(() => {
    previewProxyMapRef.current = previewProxyMap
  }, [previewProxyMap])

  useEffect(
    () => () => {
      for (const entry of Object.values(previewProxyMapRef.current)) {
        if (entry.status === "ready") {
          URL.revokeObjectURL(entry.runtimeAsset.objectUrl)
        }
      }
    },
    []
  )

  useEffect(() => {
    const referencedAssetIds = new Set(
      [...project.clips, ...project.musicTracks].map(
        (item) => item.sourceAssetId
      )
    )

    referencedPreviewAssetIdsRef.current = referencedAssetIds

    const cleanupTimer = window.setTimeout(() => {
      setPreviewProxyMap((current) => {
        let changed = false
        const next: PreviewProxyMap = {}

        for (const [key, entry] of Object.entries(current)) {
          if (!referencedAssetIds.has(entry.assetId)) {
            changed = true

            if (entry.status === "ready") {
              URL.revokeObjectURL(entry.runtimeAsset.objectUrl)
            }

            continue
          }

          next[key] = entry
        }

        if (changed) {
          previewProxyMapRef.current = next
        }

        return changed ? next : current
      })
    }, 0)

    return () => window.clearTimeout(cleanupTimer)
  }, [project.clips, project.musicTracks, project.sourceAssets])

  const setPreviewProxyEntry = useCallback(
    (entry: PreviewProxyEntry) => {
      const key = getPreviewProxyEntryKey(
        entry.assetId,
        entry.scale,
        entry.segmentIndex
      )
      const previous = previewProxyMapRef.current[key]

      if (
        previous?.status === "ready" &&
        (entry.status !== "ready" ||
          previous.runtimeAsset.objectUrl !== entry.runtimeAsset.objectUrl)
      ) {
        URL.revokeObjectURL(previous.runtimeAsset.objectUrl)
      }

      setPreviewProxyMap((current) => {
        const next = {
          ...current,
          [key]: entry,
        }

        previewProxyMapRef.current = next

        return next
      })
    },
    []
  )

  useEffect(() => {
    if (!previewProxyScale) {
      return
    }

    for (const {
      asset,
      runtimeAsset,
      segmentIndex,
      sourceTimeSeconds,
    } of previewProxyCandidates) {
      const fingerprint = getSourceAssetPreviewFingerprint(asset)
      const current =
        previewProxyMapRef.current[
          getPreviewProxyEntryKey(asset.id, previewProxyScale, segmentIndex)
        ]
      const requestedAt = Date.now()
      const isFreshLoading =
        current?.fingerprint === fingerprint &&
        current.status === "loading" &&
        requestedAt - current.requestedAt < PREVIEW_PROXY_LOADING_RETRY_MS
      let lastProgressUiUpdate = 0

      if (
        current?.fingerprint === fingerprint &&
        (isFreshLoading ||
          current.status === "ready" ||
          current.status === "error")
      ) {
        continue
      }

      setPreviewProxyEntry({
        status: "loading",
        assetId: asset.id,
        fingerprint,
        processedTimeSeconds: 0,
        progress: 0,
        requestedAt,
        scale: previewProxyScale,
        segmentIndex,
      })

      ensurePreviewProxy({
        asset,
        runtimeAsset,
        priority: PREVIEW_PROXY_VISIBLE_PRIORITY,
        scale: previewProxyScale,
        sourceTimeSeconds,
        onProgress: (progress, processedTimeSeconds) => {
          if (!isPreviewStageMountedRef.current) {
            return
          }

          const now = performance.now()
          const shouldUpdateUi =
            progress >= 1 ||
            now - lastProgressUiUpdate >=
              PREVIEW_PROXY_PROGRESS_UI_INTERVAL_MS

          if (!shouldUpdateUi) {
            return
          }

          lastProgressUiUpdate = now
          setPreviewProxyEntry({
            status: "loading",
            assetId: asset.id,
            fingerprint,
            processedTimeSeconds,
            progress,
            requestedAt,
            scale: previewProxyScale,
            segmentIndex,
          })
        },
      })
        .then((proxyFile) => {
          if (!isPreviewStageMountedRef.current) {
            return
          }

          if (!proxyFile) {
            setPreviewProxyEntry({
              status: "error",
              assetId: asset.id,
              fingerprint,
              scale: previewProxyScale,
              segmentIndex,
            })
            return
          }

          setPreviewProxyEntry({
            status: "ready",
            assetId: asset.id,
            fingerprint,
            runtimeAsset: createRuntimeAsset(proxyFile.file),
            scale: previewProxyScale,
            segmentIndex: proxyFile.segmentIndex,
            sourceEndSeconds: proxyFile.sourceEndSeconds,
            sourceStartSeconds: proxyFile.sourceStartSeconds,
          })
        })
        .catch(() => {
          if (
            !isPreviewStageMountedRef.current ||
            !referencedPreviewAssetIdsRef.current.has(asset.id)
          ) {
            return
          }

          setPreviewProxyEntry({
            status: "error",
            assetId: asset.id,
            fingerprint,
            scale: previewProxyScale,
            segmentIndex,
          })
        })
    }
  }, [previewProxyCandidates, previewProxyScale, setPreviewProxyEntry])

  useEffect(() => {
    if (!previewProxyScale) {
      return
    }

    const assetsToSchedule = new Map<
      string,
      {
        asset: SourceAsset
        runtimeAsset: RuntimeAsset
        startSegmentIndex: number
      }
    >()

    for (const { asset, runtimeAsset, segmentIndex } of previewProxyCandidates) {
      const progressKey = getPreviewProxyAssetProgressKey(
        asset,
        previewProxyScale
      )

      if (!assetsToSchedule.has(progressKey)) {
        assetsToSchedule.set(progressKey, {
          asset,
          runtimeAsset,
          startSegmentIndex: segmentIndex,
        })
      }
    }

    for (const [progressKey, { asset, runtimeAsset, startSegmentIndex }] of
      assetsToSchedule) {
      if (scheduledPreviewProxyAssetsRef.current.has(progressKey)) {
        continue
      }

      const total = getPreviewProxySegmentCount(asset)
      const fingerprint = getSourceAssetPreviewFingerprint(asset)

      scheduledPreviewProxyAssetsRef.current.add(progressKey)
      setPreviewProxyAssetProgress((current) => ({
        ...current,
        [progressKey]: current[progressKey] ?? {
          completed: 0,
          failed: 0,
          total,
        },
      }))

      for (const segmentIndex of getPreviewProxyBackgroundSegmentOrder(
        total,
        startSegmentIndex
      )) {
        const segment = getPreviewProxySegmentBounds(asset, segmentIndex)

        if (segment.sourceEndSeconds <= segment.sourceStartSeconds) {
          incrementPreviewProxyAssetProgress(progressKey, false)
          continue
        }

        ensurePreviewProxy({
          asset,
          runtimeAsset,
          priority: PREVIEW_PROXY_BACKGROUND_PRIORITY,
          scale: previewProxyScale,
          sourceTimeSeconds: segment.sourceStartSeconds,
        })
          .then((proxyFile) => {
            if (!isPreviewStageMountedRef.current) {
              return
            }

            if (proxyFile) {
              setPreviewProxyEntry({
                status: "ready",
                assetId: asset.id,
                fingerprint,
                runtimeAsset: createRuntimeAsset(proxyFile.file),
                scale: previewProxyScale,
                segmentIndex: proxyFile.segmentIndex,
                sourceEndSeconds: proxyFile.sourceEndSeconds,
                sourceStartSeconds: proxyFile.sourceStartSeconds,
              })
            }

            incrementPreviewProxyAssetProgress(progressKey, Boolean(proxyFile))
          })
          .catch(() => {
            if (!isPreviewStageMountedRef.current) {
              return
            }

            incrementPreviewProxyAssetProgress(progressKey, false)
          })
      }
    }

    function incrementPreviewProxyAssetProgress(
      progressKey: string,
      didSucceed: boolean
    ) {
      setPreviewProxyAssetProgress((current) => {
        const currentProgress = current[progressKey]

        if (!currentProgress) {
          return current
        }

        return {
          ...current,
          [progressKey]: {
            ...currentProgress,
            completed: Math.min(
              currentProgress.total,
              currentProgress.completed + 1
            ),
            failed: didSucceed
              ? currentProgress.failed
              : currentProgress.failed + 1,
          },
        }
      })
    }
  }, [previewProxyCandidates, previewProxyScale, setPreviewProxyEntry])

  useEffect(() => {
    playheadRef.current = playheadSeconds

    if (!isPlaying || isScrubbing) {
      playbackClockRef.current = null
      generatedPlayheadRef.current = null
      return
    }

    const generatedPlayhead = generatedPlayheadRef.current
    const isGeneratedPlayhead =
      generatedPlayhead !== null &&
      Math.abs(generatedPlayhead - playheadSeconds) < 0.08

    if (isGeneratedPlayhead) {
      return
    }

    playbackClockRef.current = {
      playheadSeconds,
      startedAt: performance.now(),
    }
  }, [isPlaying, isScrubbing, playheadSeconds])

  useEffect(() => {
    if (isPlaying) {
      previewAudioContext?.resume().catch(() => undefined)
    }
  }, [isPlaying, previewAudioContext])

  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      return
    }

    playbackClockRef.current = {
      playheadSeconds: playheadRef.current,
      startedAt: performance.now(),
    }
    let frame = 0
    let lastTimelineUpdate = 0

    function tick() {
      const clock = playbackClockRef.current ?? {
        playheadSeconds: playheadRef.current,
        startedAt: performance.now(),
      }
      playbackClockRef.current = clock
      const elapsedSeconds = (performance.now() - clock.startedAt) / 1000
      const nextPlayhead = clamp(
        clock.playheadSeconds + elapsedSeconds,
        0,
        projectDuration
      )
      const now = performance.now()

      if (now - lastTimelineUpdate > 16) {
        lastTimelineUpdate = now
        generatedPlayheadRef.current = nextPlayhead
        onPlayheadChange(nextPlayhead)
      }

      if (nextPlayhead >= projectDuration) {
        onPlayChange(false)
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [isPlaying, isScrubbing, onPlayChange, onPlayheadChange, projectDuration])

  function setPreviewIssue(id: string, issue: string | null) {
    setPreviewIssues((current) => {
      if (!issue) {
        if (!current[id]) {
          return current
        }

        const next = { ...current }
        delete next[id]

        return next
      }

      if (current[id] === issue) {
        return current
      }

      return { ...current, [id]: issue }
    })
  }

  const previewIssue = activeClips
    .map((clip) => previewIssues[clip.id])
    .find(Boolean)

  const getPreviewAudioContext = useCallback(() => {
    if (previewAudioContextRef.current) {
      return previewAudioContextRef.current
    }

    const nextAudioContext = createPreviewAudioContext()

    if (!nextAudioContext) {
      return null
    }

    previewAudioContextRef.current = nextAudioContext
    setPreviewAudioContext(nextAudioContext)

    return nextAudioContext
  }, [])

  function togglePlayback() {
    const nextIsPlaying = !isPlaying

    if (nextIsPlaying) {
      getPreviewAudioContext()?.resume().catch(() => undefined)
    }

    onPlayChange(nextIsPlaying)
  }

  return (
    <section
      className={`grid min-h-0 min-w-0 overflow-hidden ${CARD_CLASS}`}
      style={{ gridTemplateRows: "minmax(0, 1fr) auto" }}
    >
      <div className="grid min-h-0 place-items-center bg-card p-3">
        <div className="[container-type:size] relative grid h-full min-h-0 w-full place-items-center overflow-hidden bg-card">
          <div
            className="relative m-auto overflow-hidden rounded-lg bg-background"
            style={{
              aspectRatio: String(previewAspectRatio),
              height: `min(100%, calc(100cqw / ${previewAspectRatio}))`,
              width: `min(100%, calc(100cqh * ${previewAspectRatio}))`,
            }}
          >
            {previewClips.map((clip) => {
              const runtimeAsset = runtimeAssets[clip.sourceAssetId]
              const asset = project.sourceAssets.find(
                (item) => item.id === clip.sourceAssetId
              )

              if (!runtimeAsset) {
                return activeClipIds.has(clip.id) ? (
                  <PreviewMissingVideoLayer
                    key={clip.id}
                    clip={clip}
                    asset={asset}
                    frameWidth={project.exportSettings.width}
                    frameHeight={project.exportSettings.height}
                    onOpenFileList={onOpenFileList}
                  />
                ) : null
              }

              const clipSourceTime = getSourceTimeForTimelineItem(
                {
                  sourceEndSeconds: clip.sourceEndSeconds,
                  sourceStartSeconds: clip.sourceStartSeconds,
                  timelineStartSeconds: clip.timelineStartSeconds,
                },
                playheadSeconds
              )
              const clipProxySegmentIndex =
                getPreviewProxySegmentIndex(clipSourceTime)
              const proxyEntry =
                previewProxyScale && asset
                  ? previewProxyMap[
                      getPreviewProxyEntryKey(
                        asset.id,
                        previewProxyScale,
                        clipProxySegmentIndex
                      )
                    ]
                  : null
              const proxyFingerprint = asset
                ? getSourceAssetPreviewFingerprint(asset)
                : null
              const canUseProxyEntry =
                proxyEntry?.status === "ready" &&
                proxyEntry.fingerprint === proxyFingerprint &&
                isSourceTimeInPreviewProxySegment(clipSourceTime, proxyEntry)
              const useFullResolutionIdleFrame =
                shouldRenderFullResolutionIdleFrame &&
                activeClipIds.has(clip.id) &&
                canUseProxyEntry
              const videoRuntimeAsset = canUseProxyEntry
                ? proxyEntry.runtimeAsset
                : runtimeAsset
              const videoSourceOffsetSeconds = canUseProxyEntry
                ? proxyEntry.sourceStartSeconds
                : 0

              return (
                <PreviewVideoLayer
                  key={clip.id}
                  clip={clip}
                  asset={asset}
                  frameWidth={project.exportSettings.width}
                  frameHeight={project.exportSettings.height}
                  audioRuntimeAsset={runtimeAsset}
                  videoRuntimeAsset={videoRuntimeAsset}
                  videoSourceOffsetSeconds={videoSourceOffsetSeconds}
                  useFullResolutionIdleFrame={useFullResolutionIdleFrame}
                  fullResolutionIdleFrameOffsetSeconds={
                    1 / project.exportSettings.fps
                  }
                  playheadSeconds={playheadSeconds}
                  isPlaying={isPlaying}
                  isScrubbing={isScrubbing}
                  isActive={activeClipIds.has(clip.id)}
                  audioContext={previewAudioContext}
                  getAudioContext={getPreviewAudioContext}
                  onIssue={(issue) => setPreviewIssue(clip.id, issue)}
                />
              )
            })}
            {hasActiveVideo || activeClips.length > 0 ? null : (
              <div className="absolute inset-0 grid place-items-center bg-background text-center text-sm text-muted-foreground">
                <div className="space-y-2">
                  <Film className="mx-auto size-10" />
                  <p>
                    {hasPlayableMedia
                      ? "No video at the playhead."
                      : "Import or reconnect local media to preview."}
                  </p>
                  {!hasPlayableMedia ? (
                    <div className="pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onOpenFileList}
                      >
                        <FolderOpen data-icon="inline-start" />
                        Open File List
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            {previewIssue ? (
              <div className="absolute inset-x-3 bottom-3 z-[2000] rounded-lg border border-white/15 bg-black/80 p-3 text-xs leading-5 text-white">
                {previewIssue}
              </div>
            ) : null}
            {activeMusicTracks.map((track) => {
              const runtimeAsset = runtimeAssets[track.sourceAssetId]

              if (!runtimeAsset) {
                return null
              }

              return (
                <PreviewAudioLayer
                  key={track.id}
                  track={track}
                  runtimeAsset={runtimeAsset}
                  playheadSeconds={playheadSeconds}
                  isPlaying={isPlaying}
                  isScrubbing={isScrubbing}
                  audioContext={previewAudioContext}
                  getAudioContext={getPreviewAudioContext}
                />
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasPlayableMedia}
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <span className="font-pixel text-sm text-muted-foreground">
            {formatDuration(playheadSeconds)} /{" "}
            {formatDuration(projectDuration)}
          </span>
        </div>
        <PreviewResolutionSelect
          hasError={hasPreviewProxyError}
          isLoading={isPreviewProxyLoading}
          loadingProgress={previewProxyLoadingProgress}
          value={previewResolutionScale}
          onValueChange={onPreviewResolutionScaleChange}
        />
      </div>
    </section>
  )
}

function PreviewResolutionSelect({
  hasError,
  isLoading,
  loadingProgress,
  value,
  onValueChange,
}: {
  hasError: boolean
  isLoading: boolean
  loadingProgress: number | null
  value: PreviewResolutionScale
  onValueChange: (scale: PreviewResolutionScale) => void
}) {
  const selectedScale = clampPreviewResolutionScale(value)
  const selectedIndex = Math.max(
    0,
    PREVIEW_RESOLUTION_OPTIONS.findIndex(
      (option) => option.scale === selectedScale
    )
  )
  const selectedOption =
    PREVIEW_RESOLUTION_OPTIONS[selectedIndex] ?? PREVIEW_RESOLUTION_OPTIONS[1]
  const loadingLabel =
    typeof loadingProgress === "number" && loadingProgress > 0
      ? `Building lower-resolution preview (${formatPreviewProxyProgress(
          loadingProgress
        )})`
      : "Queued lower-resolution preview"

  return (
    <DropdownMenu>
      <DropdownTrigger className="flex h-8 w-40 items-center justify-between rounded-lg border-0 bg-background px-4 text-[13px] text-muted-foreground outline-none hover:text-foreground">
        <span className="truncate">{selectedOption.label}</span>
        {isLoading ? (
          <Tooltip content={loadingLabel} side="top">
            <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
              <Loader className="size-3.5 animate-spin" />
            </span>
          </Tooltip>
        ) : hasError ? (
          <Tooltip
            content="Lower-resolution preview failed. Using original media."
            side="top"
          >
            <span className="grid size-3.5 shrink-0 place-items-center text-destructive">
              <CircleExclamation className="size-3.5" />
            </span>
          </Tooltip>
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownTrigger>
      <DropdownContent
        align="end"
        checkedIndex={selectedIndex}
        className="z-[5010] w-44"
      >
        <DropdownLabel>Playback quality</DropdownLabel>
        {PREVIEW_RESOLUTION_OPTIONS.map((option, index) => (
          <MenuItem
            key={option.value}
            index={index}
            label={option.label}
            checked={option.scale === selectedScale}
            onSelect={() => onValueChange(option.scale)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  )
}

function clampPreviewResolutionScale(
  scale: PreviewResolutionScale
): PreviewResolutionScale {
  return PREVIEW_RESOLUTION_OPTIONS.some((option) => option.scale === scale)
    ? scale
    : DEFAULT_PREVIEW_RESOLUTION_SCALE
}

function getPreviewProxyScale(
  scale: PreviewResolutionScale
): PreviewProxyScale | null {
  return scale === 0.5 ? scale : null
}

function getPreviewProxyBackgroundProgress(
  candidates: Array<{
    asset: SourceAsset
    runtimeAsset: RuntimeAsset
    segmentIndex: number
    sourceTimeSeconds: number
  }>,
  proxyMap: PreviewProxyMap,
  progressMap: PreviewProxyAssetProgressMap,
  scale: PreviewProxyScale
) {
  const seenKeys = new Set<string>()
  let completed = 0
  let total = 0

  for (const { asset } of candidates) {
    const key = getPreviewProxyAssetProgressKey(asset, scale)

    if (seenKeys.has(key)) {
      continue
    }

    seenKeys.add(key)

    const fingerprint = getSourceAssetPreviewFingerprint(asset)
    const progress = progressMap[key]
    const assetEntries = Object.values(proxyMap).filter(
      (entry) =>
        entry.assetId === asset.id &&
        entry.fingerprint === fingerprint &&
        entry.scale === scale
    )
    const readySegments = assetEntries.filter(
      (entry) => entry.status === "ready"
    ).length
    const loadingProgress = Math.max(
      0,
      ...assetEntries
        .filter(
          (entry): entry is Extract<PreviewProxyEntry, { status: "loading" }> =>
            entry.status === "loading"
        )
        .map((entry) => entry.progress)
    )

    const assetTotal = progress?.total ?? getPreviewProxySegmentCount(asset)
    const assetCompleted = Math.max(
      readySegments,
      progress ? Math.min(progress.completed, progress.total) : 0
    )

    completed += Math.min(assetTotal, assetCompleted + loadingProgress)
    total += assetTotal
  }

  if (total === 0) {
    return null
  }

  return {
    completed,
    progress: completed / total,
    total,
  }
}

function getPreviewProxyEntryKey(
  assetId: string,
  scale: PreviewProxyScale,
  segmentIndex: number
) {
  return `${assetId}:${scale}:${segmentIndex}`
}

function getPreviewProxyAssetProgressKey(
  asset: SourceAsset,
  scale: PreviewProxyScale
) {
  return `${asset.id}:${scale}:${getSourceAssetPreviewFingerprint(asset)}`
}

function getPreviewProxyBackgroundSegmentOrder(
  segmentCount: number,
  startSegmentIndex: number
) {
  const clampedStartSegmentIndex = clamp(
    startSegmentIndex,
    0,
    Math.max(0, segmentCount - 1)
  )
  const order = [clampedStartSegmentIndex]

  for (let distance = 1; order.length < segmentCount; distance++) {
    const next = clampedStartSegmentIndex + distance
    const previous = clampedStartSegmentIndex - distance

    if (next < segmentCount) {
      order.push(next)
    }

    if (previous >= 0) {
      order.push(previous)
    }
  }

  return order
}

function formatPreviewProxyProgress(progress: number) {
  const percent = Math.max(0, Math.min(100, progress * 100))

  if (percent > 0 && percent < 10) {
    return `${percent.toFixed(1)}%`
  }

  return `${Math.round(percent)}%`
}

function PreviewVideoLayer({
  clip,
  asset,
  frameWidth,
  frameHeight,
  audioRuntimeAsset,
  videoRuntimeAsset,
  videoSourceOffsetSeconds,
  useFullResolutionIdleFrame,
  fullResolutionIdleFrameOffsetSeconds,
  playheadSeconds,
  isPlaying,
  isScrubbing,
  isActive,
  audioContext,
  getAudioContext,
  onIssue,
}: {
  clip: TimelineClip
  asset?: SourceAsset
  frameWidth: number
  frameHeight: number
  audioRuntimeAsset: RuntimeAsset
  videoRuntimeAsset: RuntimeAsset
  videoSourceOffsetSeconds: number
  useFullResolutionIdleFrame: boolean
  fullResolutionIdleFrameOffsetSeconds: number
  playheadSeconds: number
  isPlaying: boolean
  isScrubbing: boolean
  isActive: boolean
  audioContext: AudioContext | null
  getAudioContext: () => AudioContext | null
  onIssue: (issue: string | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const idleFrameVideoRef = useRef<HTMLVideoElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const activeIdleFrameObjectUrlRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeAudioObjectUrlRef = useRef<string | null>(null)
  const audioControllerRef = useRef<PreviewAudioController | null>(null)
  const [
    readyFullResolutionIdleFrameKey,
    setReadyFullResolutionIdleFrameKey,
  ] = useState<string | null>(null)
  const playheadSourceTime = getSourceTimeForTimelineItem(
    {
      sourceStartSeconds: clip.sourceStartSeconds,
      sourceEndSeconds: clip.sourceEndSeconds,
      timelineStartSeconds: clip.timelineStartSeconds,
    },
    playheadSeconds
  )
  const fullResolutionIdleFrameKey = [
    audioRuntimeAsset.objectUrl,
    playheadSourceTime.toFixed(6),
    fullResolutionIdleFrameOffsetSeconds.toFixed(6),
  ].join(":")
  const shouldShowFullResolutionIdleFrame =
    useFullResolutionIdleFrame &&
    readyFullResolutionIdleFrameKey === fullResolutionIdleFrameKey
  const clipAudioSettingsRef = useRef({
    isActive,
    muted: clip.muted,
    name: asset?.name,
    volume: clip.volume,
  })
  const layerGeometry = getPreviewVideoLayerGeometry({
    asset,
    clip,
    frameHeight,
    frameWidth,
  })
  const layerStyle = getPreviewVideoLayerStyle(
    layerGeometry,
    getPreviewLayerZIndex(clip)
  )

  useEffect(
    () => () => {
      disconnectPreviewAudio(audioControllerRef)
      clearPreviewAudioDebug(`clip:${clip.id}`)
    },
    [clip.id]
  )

  useEffect(() => {
    clipAudioSettingsRef.current = {
      isActive,
      muted: clip.muted,
      name: asset?.name,
      volume: clip.volume,
    }
  }, [asset?.name, clip.muted, clip.volume, isActive])

  const applyClipAudioVolume = useCallback(() => {
    const player = audioRef.current

    if (!player) {
      return
    }
    const settings = clipAudioSettingsRef.current

    const audioStatus = setPreviewMediaVolume({
      player,
      audioContext,
      getAudioContext,
      audioControllerRef,
      volume: settings.volume,
      muted: settings.muted || !settings.isActive,
      maxVolume: MAX_MEDIA_VOLUME,
    })
    publishPreviewAudioDebug(`clip:${clip.id}`, {
      ...audioStatus,
      id: clip.id,
      kind: "clip",
      name: settings.name,
    })
  }, [audioContext, clip.id, getAudioContext])

  useEffect(() => {
    applyClipAudioVolume()
  }, [applyClipAudioVolume, clip.muted, clip.volume, isActive])

  useEffect(() => {
    const player = videoRef.current

    if (!player) {
      return
    }

    const sourceChanged =
      activeObjectUrlRef.current !== videoRuntimeAsset.objectUrl
    const clipTiming = {
      sourceStartSeconds: clip.sourceStartSeconds,
      sourceEndSeconds: clip.sourceEndSeconds,
      timelineStartSeconds: clip.timelineStartSeconds,
    }
    const targetTime =
      getSourceTimeForTimelineItem(clipTiming, playheadSeconds) -
      videoSourceOffsetSeconds
    const shouldPlay = isPlaying && isActive && !isScrubbing
    const shouldSeek =
      sourceChanged ||
      !shouldPlay ||
      Math.abs(player.currentTime - targetTime) > 0.25

    if (shouldPlay && !shouldSeek) {
      if (player.paused) {
        player.play().catch(() => undefined)
      }
      return
    }

    let cancelled = false

    async function syncVideo() {
      if (!player) {
        return
      }

      if (sourceChanged) {
        player.src = videoRuntimeAsset.objectUrl
        activeObjectUrlRef.current = videoRuntimeAsset.objectUrl
        player.muted = true
        await waitForMediaMetadata(player)
      }

      if (cancelled) {
        return
      }

      if (
        Number.isFinite(targetTime) &&
        Math.abs(player.currentTime - targetTime) > 0.04
      ) {
        player.currentTime = targetTime

        if (!shouldPlay) {
          await waitForMediaSeek(player)
        }
      }

      if (cancelled) {
        return
      }

      if (player.videoWidth > 0 && player.videoHeight > 0) {
        onIssue(null)
      }

      if (shouldPlay) {
        await player.play().catch(() => undefined)
      } else {
        player.pause()
      }
    }

    syncVideo().catch(() =>
      onIssue("This browser could not decode one of the active video files.")
    )

    return () => {
      cancelled = true
    }
  }, [
    clip.sourceEndSeconds,
    clip.sourceStartSeconds,
    clip.timelineStartSeconds,
    isActive,
    isPlaying,
    isScrubbing,
    onIssue,
    playheadSeconds,
    videoSourceOffsetSeconds,
    videoRuntimeAsset.objectUrl,
  ])

  useEffect(() => {
    const player = idleFrameVideoRef.current

    if (!player || !useFullResolutionIdleFrame) {
      return
    }

    const sourceChanged =
      activeIdleFrameObjectUrlRef.current !== audioRuntimeAsset.objectUrl
    const visibleVideo = videoRef.current
    const visibleVideoSourceTime =
      visibleVideo &&
      activeObjectUrlRef.current === videoRuntimeAsset.objectUrl &&
      visibleVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      Number.isFinite(visibleVideo.currentTime)
        ? visibleVideo.currentTime + videoSourceOffsetSeconds
        : playheadSourceTime
    const targetTime = clamp(
      visibleVideoSourceTime + fullResolutionIdleFrameOffsetSeconds,
      clip.sourceStartSeconds,
      Math.max(
        clip.sourceStartSeconds,
        clip.sourceEndSeconds - PREVIEW_EDGE_SAMPLE_SECONDS
      )
    )
    const readyKey = fullResolutionIdleFrameKey
    let cancelled = false

    async function syncFullResolutionIdleFrame() {
      if (!player) {
        return
      }

      player.pause()
      player.muted = true

      if (sourceChanged) {
        player.src = audioRuntimeAsset.objectUrl
        activeIdleFrameObjectUrlRef.current = audioRuntimeAsset.objectUrl
        await waitForMediaMetadata(player)
      }

      if (cancelled) {
        return
      }

      if (
        Number.isFinite(targetTime) &&
        Math.abs(player.currentTime - targetTime) > 0.01
      ) {
        player.currentTime = targetTime
        await waitForMediaSeek(player)
      }

      await waitForMediaCurrentData(player)
      await waitForAnimationFrame()

      if (cancelled) {
        return
      }

      if (player.videoWidth > 0 && player.videoHeight > 0) {
        onIssue(null)
        setReadyFullResolutionIdleFrameKey(readyKey)
      }
    }

    syncFullResolutionIdleFrame().catch(() => {
      if (!cancelled) {
        setReadyFullResolutionIdleFrameKey((current) =>
          current === readyKey ? null : current
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    audioRuntimeAsset.objectUrl,
    clip.sourceEndSeconds,
    clip.sourceStartSeconds,
    clip.timelineStartSeconds,
    fullResolutionIdleFrameOffsetSeconds,
    fullResolutionIdleFrameKey,
    onIssue,
    playheadSourceTime,
    useFullResolutionIdleFrame,
    videoRuntimeAsset.objectUrl,
    videoSourceOffsetSeconds,
  ])

  useEffect(() => {
    const player = audioRef.current

    if (!player) {
      return
    }

    if (isScrubbing) {
      player.pause()
      return
    }

    const sourceChanged =
      activeAudioObjectUrlRef.current !== audioRuntimeAsset.objectUrl
    const clipTiming = {
      sourceStartSeconds: clip.sourceStartSeconds,
      sourceEndSeconds: clip.sourceEndSeconds,
      timelineStartSeconds: clip.timelineStartSeconds,
    }
    const targetTime = getSourceTimeForTimelineItem(
      clipTiming,
      playheadSeconds
    )
    const shouldPlay = isPlaying && isActive && !clip.muted
    const shouldSeek =
      sourceChanged ||
      !shouldPlay ||
      Math.abs(player.currentTime - targetTime) > 0.25

    if (shouldPlay && !shouldSeek) {
      if (player.paused) {
        player.play().catch(() => undefined)
      }
      return
    }

    let cancelled = false

    async function syncClipAudio() {
      if (!player) {
        return
      }

      if (sourceChanged) {
        player.src = audioRuntimeAsset.objectUrl
        activeAudioObjectUrlRef.current = audioRuntimeAsset.objectUrl
        await waitForMediaMetadata(player)
        applyClipAudioVolume()
      }

      if (cancelled) {
        return
      }

      if (
        Number.isFinite(targetTime) &&
        Math.abs(player.currentTime - targetTime) > 0.04
      ) {
        player.currentTime = targetTime
        await waitForMediaSeek(player)
      }

      if (cancelled) {
        return
      }

      if (shouldPlay) {
        await player.play().catch(() => undefined)
      } else {
        player.pause()
      }
    }

    syncClipAudio().catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [
    clip.muted,
    clip.sourceEndSeconds,
    clip.sourceStartSeconds,
    clip.timelineStartSeconds,
    isActive,
    isPlaying,
    isScrubbing,
    applyClipAudioVolume,
    playheadSeconds,
    audioRuntimeAsset.objectUrl,
  ])

  return (
    <>
      <div
        className={[
          "absolute overflow-hidden",
          isActive ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={layerStyle}
      >
        <video
          ref={videoRef}
          className="block size-full bg-card object-contain"
          muted
          playsInline
          preload="auto"
          onError={() =>
            onIssue(
              "This browser could not decode one of the active video files."
            )
          }
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            video.muted = true
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              onIssue(null)
            }
          }}
        />
        <video
          ref={idleFrameVideoRef}
          className={[
            "absolute inset-0 block size-full bg-card object-contain",
            shouldShowFullResolutionIdleFrame ? "opacity-100" : "opacity-0",
          ].join(" ")}
          muted
          playsInline
          preload="metadata"
          onError={() =>
            setReadyFullResolutionIdleFrameKey((current) =>
              current === fullResolutionIdleFrameKey ? null : current
            )
          }
        />
      </div>
      <audio ref={audioRef} preload="auto" />
    </>
  )
}

function PreviewMissingVideoLayer({
  clip,
  asset,
  frameWidth,
  frameHeight,
  onOpenFileList,
}: {
  clip: TimelineClip
  asset?: SourceAsset
  frameWidth: number
  frameHeight: number
  onOpenFileList: () => void
}) {
  const layerGeometry = getPreviewVideoLayerGeometry({
    asset,
    clip,
    frameHeight,
    frameWidth,
  })
  const layerStyle = getPreviewVideoLayerStyle(
    layerGeometry,
    getPreviewLayerZIndex(clip)
  )
  const inverseScale = 1 / Math.max(0.01, layerGeometry.scale)
  const warningMaxSize = `${Math.min(1, Math.max(0.01, layerGeometry.scale)) * 100}%`
  const fileName = asset?.name ?? "Unknown file"

  return (
    <div
      className="absolute grid place-items-center overflow-hidden bg-background/70 text-center text-muted-foreground"
      style={layerStyle}
    >
      <div
        className="flex flex-col items-center gap-1.5 rounded-lg bg-background/95 px-3 py-2"
        style={{
          maxHeight: warningMaxSize,
          maxWidth: `min(14rem, ${warningMaxSize})`,
          transform: `scale(${inverseScale})`,
        }}
      >
        <CircleExclamation className="size-5 shrink-0 text-destructive" />
        <p className="max-w-full truncate text-xs">
          Missing local file:{" "}
          <span className="font-medium text-foreground">{fileName}</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation()
            onOpenFileList()
          }}
        >
          <FolderOpen data-icon="inline-start" />
          Open File List
        </Button>
      </div>
    </div>
  )
}

function PreviewAudioLayer({
  track,
  runtimeAsset,
  playheadSeconds,
  isPlaying,
  isScrubbing,
  audioContext,
  getAudioContext,
}: {
  track: MusicTrack
  runtimeAsset: RuntimeAsset
  playheadSeconds: number
  isPlaying: boolean
  isScrubbing: boolean
  audioContext: AudioContext | null
  getAudioContext: () => AudioContext | null
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const audioControllerRef = useRef<PreviewAudioController | null>(null)
  const trackAudioSettingsRef = useRef({ volume: track.volume })

  useEffect(
    () => () => {
      disconnectPreviewAudio(audioControllerRef)
      clearPreviewAudioDebug(`music:${track.id}`)
    },
    [track.id]
  )

  useEffect(() => {
    trackAudioSettingsRef.current = { volume: track.volume }
  }, [track.volume])

  const applyTrackAudioVolume = useCallback(() => {
    const player = audioRef.current

    if (!player) {
      return
    }

    const audioStatus = setPreviewMediaVolume({
      player,
      audioContext,
      getAudioContext,
      audioControllerRef,
      volume: trackAudioSettingsRef.current.volume,
      muted: false,
      maxVolume: MAX_MEDIA_VOLUME,
    })
    publishPreviewAudioDebug(`music:${track.id}`, {
      ...audioStatus,
      id: track.id,
      kind: "music",
    })
  }, [audioContext, getAudioContext, track.id])

  useEffect(() => {
    applyTrackAudioVolume()
  }, [applyTrackAudioVolume, track.volume])

  useEffect(() => {
    const player = audioRef.current

    if (!player) {
      return
    }

    if (isScrubbing) {
      player.pause()
      return
    }

    const sourceChanged = activeObjectUrlRef.current !== runtimeAsset.objectUrl
    const trackTiming = {
      sourceStartSeconds: track.sourceStartSeconds,
      sourceEndSeconds: track.sourceEndSeconds,
      timelineStartSeconds: track.timelineStartSeconds,
    }
    const targetTime = getSourceTimeForTimelineItem(
      trackTiming,
      playheadSeconds
    )
    const shouldSeek =
      sourceChanged ||
      !isPlaying ||
      Math.abs(player.currentTime - targetTime) > 0.25

    if (isPlaying && !shouldSeek) {
      if (player.paused) {
        player.play().catch(() => undefined)
      }
      return
    }

    let cancelled = false

    async function syncAudio() {
      if (!player) {
        return
      }

      if (sourceChanged) {
        player.src = runtimeAsset.objectUrl
        activeObjectUrlRef.current = runtimeAsset.objectUrl
        await waitForMediaMetadata(player)
        applyTrackAudioVolume()
      }

      if (cancelled) {
        return
      }

      if (
        Number.isFinite(targetTime) &&
        Math.abs(player.currentTime - targetTime) > 0.04
      ) {
        player.currentTime = targetTime
        await waitForMediaSeek(player)
      }

      if (cancelled) {
        return
      }

      if (isPlaying) {
        await player.play().catch(() => undefined)
      } else {
        player.pause()
      }
    }

    syncAudio().catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [
    isPlaying,
    isScrubbing,
    applyTrackAudioVolume,
    playheadSeconds,
    runtimeAsset.objectUrl,
    track.sourceEndSeconds,
    track.sourceStartSeconds,
    track.timelineStartSeconds,
  ])

  return <audio ref={audioRef} preload="auto" />
}

function clampTimelineZoom(zoom: number) {
  return clamp(zoom, TIMELINE_MIN_ZOOM, TIMELINE_MAX_ZOOM)
}

function getTimelineZoomSliderValue(zoom: number) {
  const min = Math.log(TIMELINE_MIN_ZOOM)
  const max = Math.log(TIMELINE_MAX_ZOOM)
  const current = Math.log(clampTimelineZoom(zoom))

  return clamp((current - min) / (max - min), 0, 1)
}

function getTimelineZoomFromSliderValue(value: number) {
  const min = Math.log(TIMELINE_MIN_ZOOM)
  const max = Math.log(TIMELINE_MAX_ZOOM)
  const progress = clamp(value, 0, 1)

  return Number(Math.exp(min + progress * (max - min)).toFixed(2))
}

function Timeline({
  project,
  runtimeAssets,
  selection,
  playheadSeconds,
  zoom: rawZoom,
  viewportHeight,
  onSelect,
  onPlayheadChange,
  onSeekingChange,
  onClipChange,
  onMusicChange,
  onZoomChange,
  onSplit,
  canSplit,
  onDelete,
  canDelete,
  snapEnabled,
  onSnapEnabledChange,
  onClipPreviewChange,
  onMusicPreviewChange,
  onDropFiles,
}: {
  project: Project
  runtimeAssets: RuntimeAssetMap
  selection: Selection
  playheadSeconds: number
  zoom: number
  viewportHeight: number
  onSelect: (selection: Selection) => void
  onPlayheadChange: (seconds: number) => void
  onSeekingChange: (isSeeking: boolean) => void
  onClipChange: (
    id: string,
    patch: Partial<TimelineClip>,
    options?: TimelineItemCommitOptions
  ) => void
  onMusicChange: (
    id: string,
    patch: Partial<MusicTrack>,
    options?: TimelineItemCommitOptions
  ) => void
  onZoomChange: (zoom: number) => void
  onSplit: () => void
  canSplit: boolean
  onDelete: () => void
  canDelete: boolean
  snapEnabled: boolean
  onSnapEnabledChange: (enabled: boolean) => void
  onClipPreviewChange: (
    id: string,
    preview: TimelineItemDragPreview | null
  ) => void
  onMusicPreviewChange: (
    id: string,
    preview: TimelineItemDragPreview | null
  ) => void
  onDropFiles: (
    dropped: TimelineDroppedFile[],
    placement: TimelineDropPlacement
  ) => void
}) {
  const zoom = clampTimelineZoom(rawZoom)
  const timelineItems = useMemo(
    () => [...project.clips, ...project.musicTracks],
    [project.clips, project.musicTracks]
  )
  const duration = Math.max(12, getProjectDuration(project) + 3)
  const width = Math.max(duration * zoom, 1200)
  const [topTrackInsertItemId, setTopTrackInsertItemId] = useState<
    string | null
  >(null)
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(
    null
  )
  const hasTopTrackInsertPreview =
    Boolean(topTrackInsertItemId) || Boolean(dropPreview?.insertTrackAtTop)
  const trackCount =
    Math.max(4, getTrackCount(timelineItems)) +
    (hasTopTrackInsertPreview ? 1 : 0)
  const timelineHeight =
    TIMELINE_TRACK_TOP + trackCount * (TRACK_HEIGHT + TRACK_GAP) + 12
  const timelineContentHeight = Math.max(timelineHeight, viewportHeight)
  const tickInterval = getTimeTickInterval(zoom)
  const ticks = useMemo(() => {
    const count = Math.ceil(duration / tickInterval) + 1

    return Array.from({ length: count }, (_, index) => index * tickInterval)
  }, [duration, tickInterval])
  const timelineShellRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const durationRef = useRef(duration)
  const playheadSecondsRef = useRef(playheadSeconds)
  const isSeekingRef = useRef(false)
  const panDragRef = useRef<{
    x: number
    y: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const dropMetadataCacheRef = useRef<Map<string, TimelineDropMetadataCache>>(
    new Map()
  )
  const dropPreviewPointerRef = useRef<{
    clientX: number
    clientY: number
    container: HTMLDivElement
  } | null>(null)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0)
  const [hoverSeconds, setHoverSeconds] = useState<number | null>(null)
  const [isSeeking, setIsSeeking] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [interactionMode, setInteractionMode] =
    useState<TimelineInteractionMode>("select")
  const [snapPreview, setSnapPreview] = useState<TimelineSnapPreview | null>(
    null
  )
  const snapItems = timelineItems
  const [waveforms, setWaveforms] = useState<TimelineWaveformMap>({})
  const waveformsRef = useRef<TimelineWaveformMap>({})
  const waveformMountedRef = useRef(true)
  const waveformAssetKey = useMemo(() => {
    return Array.from(
      new Set(timelineItems.map((item) => item.sourceAssetId))
    )
      .sort()
      .join("|")
  }, [timelineItems])

  useEffect(() => {
    if (!Object.is(rawZoom, zoom)) {
      onZoomChange(zoom)
    }
  }, [onZoomChange, rawZoom, zoom])

  useEffect(() => {
    zoomRef.current = zoom
    durationRef.current = duration
    playheadSecondsRef.current = playheadSeconds
  }, [duration, playheadSeconds, zoom])

  useEffect(() => {
    waveformsRef.current = waveforms
  }, [waveforms])

  useEffect(() => {
    waveformMountedRef.current = true

    return () => {
      waveformMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const assetIds = waveformAssetKey === "" ? [] : waveformAssetKey.split("|")
    const abortControllers: AbortController[] = []

    for (const assetId of assetIds) {
      const runtimeAsset = runtimeAssets[assetId]

      if (!runtimeAsset) {
        continue
      }

      const fingerprint = getRuntimeAssetFingerprint(runtimeAsset)
      const currentWaveform = waveformsRef.current[assetId]

      if (currentWaveform?.fingerprint === fingerprint) {
        continue
      }

      setWaveforms((current) => {
        if (current[assetId]?.fingerprint === fingerprint) {
          return current
        }

        const next = {
          ...current,
          [assetId]: {
            status: "loading",
            fingerprint,
          } satisfies TimelineWaveform,
        }

        waveformsRef.current = next
        return next
      })

      const abortController = new AbortController()
      abortControllers.push(abortController)

      extractTimelineWaveform(runtimeAsset.file, {
        signal: abortController.signal,
        onProgress: (waveform) => {
          if (
            abortController.signal.aborted ||
            !waveformMountedRef.current
          ) {
            return
          }

          setWaveforms((current) => {
            if (current[assetId]?.fingerprint !== fingerprint) {
              return current
            }

            const next = {
              ...current,
              [assetId]: {
                status: "ready",
                fingerprint,
                peaks: waveform.peaks,
                durationSeconds: waveform.durationSeconds,
                peaksPerMinute: waveform.peaksPerMinute,
              },
            } satisfies TimelineWaveformMap

            waveformsRef.current = next
            return next
          })
        },
      })
        .then((waveform) => {
          if (
            abortController.signal.aborted ||
            !waveformMountedRef.current
          ) {
            return
          }

          setWaveforms((current) => {
            if (current[assetId]?.fingerprint !== fingerprint) {
              return current
            }

            const next = {
              ...current,
              [assetId]: waveform
                ? {
                    status: "ready",
                    fingerprint,
                    peaks: waveform.peaks,
                    durationSeconds: waveform.durationSeconds,
                    peaksPerMinute: waveform.peaksPerMinute,
                  }
                : { status: "unavailable", fingerprint },
            } satisfies TimelineWaveformMap

            waveformsRef.current = next
            return next
          })
        })
        .catch(() => {
          if (
            abortController.signal.aborted ||
            !waveformMountedRef.current
          ) {
            return
          }

          setWaveforms((current) => {
            if (current[assetId]?.fingerprint !== fingerprint) {
              return current
            }

            const next = {
              ...current,
              [assetId]: { status: "unavailable", fingerprint },
            } satisfies TimelineWaveformMap

            waveformsRef.current = next
            return next
          })
        })
    }

    return () => {
      for (const abortController of abortControllers) {
        abortController.abort()
      }
    }
  }, [runtimeAssets, waveformAssetKey])

  function setTimelineScrollPosition(nextScrollLeft: number) {
    const normalizedScrollLeft = Math.max(0, nextScrollLeft)

    setTimelineScrollLeft((currentScrollLeft) =>
      Math.abs(currentScrollLeft - normalizedScrollLeft) < 0.5
        ? currentScrollLeft
        : normalizedScrollLeft
    )
  }

  function setTimelineViewportSize(nextViewportWidth: number) {
    const normalizedViewportWidth = Math.max(0, nextViewportWidth)

    setTimelineViewportWidth((currentViewportWidth) =>
      Math.abs(currentViewportWidth - normalizedViewportWidth) < 0.5
        ? currentViewportWidth
        : normalizedViewportWidth
    )
  }

  function syncTimelineScrollVariable(scrollContainer: HTMLElement) {
    const scrollLeft = `${Math.max(0, scrollContainer.scrollLeft)}px`

    scrollContainer.style.setProperty(
      "--timeline-scroll-left",
      scrollLeft
    )
    timelineShellRef.current?.style.setProperty(
      "--timeline-scroll-left",
      scrollLeft
    )
  }

  useEffect(() => {
    const container = timelineRef.current

    if (!container) {
      return
    }

    setTimelineViewportSize(container.clientWidth)

    const resizeObserver = new ResizeObserver(() => {
      setTimelineViewportSize(container.clientWidth)
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const container = timelineRef.current

    if (!container) {
      return
    }

    const scrollContainer = container

    syncTimelineScrollVariable(scrollContainer)

    function onWheel(event: WheelEvent) {
      const currentZoom = zoomRef.current
      const currentDuration = durationRef.current

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()

        const rect = scrollContainer.getBoundingClientRect()
        const cursorX = event.clientX - rect.left
        const secondsAtCursor = getTimelineSeconds(
          scrollContainer,
          event.clientX,
          currentZoom,
          currentDuration,
          TIMELINE_CONTENT_INSET_X
        )
        const zoomFactor = Math.exp(-event.deltaY * 0.005)
        const nextZoom = clamp(
          currentZoom * zoomFactor,
          TIMELINE_MIN_ZOOM,
          TIMELINE_MAX_ZOOM
        )

        if (Math.abs(nextZoom - currentZoom) < 0.01) {
          return
        }

        const roundedZoom = Number(nextZoom.toFixed(2))
        const nextScrollLeft = Math.max(
          0,
          TIMELINE_CONTENT_INSET_X + secondsAtCursor * roundedZoom - cursorX
        )

        zoomRef.current = roundedZoom
        flushSync(() => {
          setTimelineScrollPosition(nextScrollLeft)
          onZoomChange(roundedZoom)
        })
        scrollContainer.scrollLeft = nextScrollLeft
        syncTimelineScrollVariable(scrollContainer)

        return
      }

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        scrollContainer.scrollLeft += event.deltaX
        syncTimelineScrollVariable(scrollContainer)
        setTimelineScrollPosition(scrollContainer.scrollLeft)
      }
    }

    scrollContainer.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    })

    return () => {
      scrollContainer.removeEventListener("wheel", onWheel, { capture: true })
    }
  }, [onZoomChange])

  function zoomAroundPlayhead(nextZoom: number) {
    const scrollContainer = timelineRef.current
    const clampedZoom = clamp(
      nextZoom,
      TIMELINE_MIN_ZOOM,
      TIMELINE_MAX_ZOOM
    )

    if (!scrollContainer) {
      onZoomChange(clampedZoom)
      return
    }

    const anchorSeconds = playheadSecondsRef.current
    const anchorX = scrollContainer.clientWidth / 2
    const nextScrollLeft = Math.max(
      0,
      TIMELINE_CONTENT_INSET_X + anchorSeconds * clampedZoom - anchorX
    )

    zoomRef.current = clampedZoom
    flushSync(() => {
      setTimelineScrollPosition(nextScrollLeft)
      onZoomChange(clampedZoom)
    })
    scrollContainer.scrollLeft = nextScrollLeft
    syncTimelineScrollVariable(scrollContainer)
  }

  function getSecondsFromPointer(event: PointerEvent<HTMLDivElement>) {
    return getTimelineSeconds(
      event.currentTarget,
      event.clientX,
      zoom,
      duration,
      TIMELINE_CONTENT_INSET_X
    )
  }

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    isSeekingRef.current = true
    setIsSeeking(true)
    onSeekingChange(true)
    onPlayheadChange(getSecondsFromPointer(event))
  }

  function updateHover(event: PointerEvent<HTMLDivElement>) {
    const seconds = getSecondsFromPointer(event)

    setHoverSeconds(seconds)

    if (isSeekingRef.current || isSeeking) {
      event.preventDefault()
      onPlayheadChange(seconds)
    }
  }

  function stopSeeking() {
    if (!isSeekingRef.current && !isSeeking) {
      return
    }

    isSeekingRef.current = false
    setIsSeeking(false)
    onSeekingChange(false)
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setHoverSeconds(null)
    panDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: timelineViewportRef.current?.scrollTop ?? 0,
    }
    setIsPanning(true)
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const drag = panDragRef.current

    if (!drag) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const nextScrollLeft = Math.max(0, drag.scrollLeft - (event.clientX - drag.x))
    const nextScrollTop = Math.max(0, drag.scrollTop - (event.clientY - drag.y))

    event.currentTarget.scrollLeft = nextScrollLeft
    if (timelineViewportRef.current) {
      timelineViewportRef.current.scrollTop = nextScrollTop
    }
    syncTimelineScrollVariable(event.currentTarget)
    setTimelineScrollPosition(nextScrollLeft)
  }

  function stopPan() {
    if (!panDragRef.current) {
      return
    }

    panDragRef.current = null
    setIsPanning(false)
  }

  function handleTimelinePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (interactionMode === "pan") {
      startPan(event)
      return
    }

    seekFromPointer(event)
  }

  function handleTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (panDragRef.current) {
      movePan(event)
      return
    }

    updateHover(event)
  }

  function handleTimelinePointerUp() {
    if (panDragRef.current) {
      stopPan()
      return
    }

    stopSeeking()
  }

  function handleTimelinePointerCancel() {
    stopPan()
    stopSeeking()
  }

  function updateTimelineScroll(event: UIEvent<HTMLDivElement>) {
    syncTimelineScrollVariable(event.currentTarget)
    setTimelineViewportSize(event.currentTarget.clientWidth)
    setTimelineScrollPosition(event.currentTarget.scrollLeft)
  }

  function updateDropPreview(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const draggedDuration = getTimelineDraggedFileDuration(
      event.dataTransfer,
      dropMetadataCacheRef.current
    )
    dropPreviewPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      container: event.currentTarget,
    }
    setDropPreview(
      getTimelineDropPreview(
        event,
        zoom,
        duration,
        TIMELINE_CONTENT_INSET_X,
        draggedDuration
      )
    )

    if (draggedDuration !== undefined) {
      return
    }

    const pendingDuration = loadTimelineDraggedFileDuration(
      event.dataTransfer,
      dropMetadataCacheRef.current
    )

    pendingDuration?.then((durationSeconds) => {
      const pointer = dropPreviewPointerRef.current

      if (durationSeconds === undefined || !pointer) {
        return
      }

      setDropPreview(
        getTimelineDropPreviewFromPoint({
          clientX: pointer.clientX,
          clientY: pointer.clientY,
          container: pointer.container,
          contentInsetX: TIMELINE_CONTENT_INSET_X,
          duration,
          draggedDurationSeconds: durationSeconds,
          zoom,
        })
      )
    })
  }

  async function dropFilesOnTimeline(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const preview =
      dropPreview ??
      getTimelineDropPreview(event, zoom, duration, TIMELINE_CONTENT_INSET_X)
    const dropped = await getDroppedLocalFiles(event.dataTransfer)

    setDropPreview(null)
    dropPreviewPointerRef.current = null

    if (dropped.length > 0) {
      onDropFiles(dropped, preview.placement)
    }
  }

  const timelineVisibleStartPx = timelineScrollLeft
  const timelineVisibleEndPx =
    timelineScrollLeft +
    (timelineViewportWidth > 0 ? timelineViewportWidth : width)
  const isTrimSnapPreview =
    snapPreview?.mode === "start" || snapPreview?.mode === "end"

  function getRenderedTrackIndex(item: TimelineItemData) {
    const trackIndex = getTrackIndex(item)

    return hasTopTrackInsertPreview &&
      (!topTrackInsertItemId || item.id !== topTrackInsertItemId)
      ? trackIndex + 1
      : trackIndex
  }

  function updateTopTrackInsertPreview(
    id: string,
    preview: TimelineItemDragPreview | null
  ) {
    setTopTrackInsertItemId(preview?.insertTrackAtTop ? id : null)
  }

  return (
    <section className={`min-h-0 max-w-full min-w-0 ${CARD_CLASS}`}>
      <div className="flex h-10 min-w-0 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip
            content={canSplit ? "Split selected clip" : "Select a clip to split"}
          >
            <span className="inline-flex">
              <Button
                type="button"
                variant={canSplit ? "outline" : "ghost"}
                size="icon-sm"
                aria-label="Split clip"
                onClick={onSplit}
                disabled={!canSplit}
                className={
                  canSplit
                    ? undefined
                    : "bg-transparent disabled:bg-transparent disabled:opacity-35"
                }
              >
                <Scissors />
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            content={
              canDelete
                ? "Delete selected timeline item"
                : "Select a timeline item to delete"
            }
          >
            <span className="inline-flex">
              <Button
                type="button"
                variant={canDelete ? "outline" : "ghost"}
                size="icon-sm"
                aria-label="Delete selected timeline item"
                onClick={onDelete}
                disabled={!canDelete}
                className={
                  canDelete
                    ? undefined
                    : "bg-transparent disabled:bg-transparent disabled:opacity-35"
                }
              >
                <Trash />
              </Button>
            </span>
          </Tooltip>
          <div className="h-5 w-px bg-border" aria-hidden="true" />
          <Tooltip content="Select timeline items">
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                active={interactionMode === "select"}
                aria-label="Select timeline items"
                aria-pressed={interactionMode === "select"}
                onClick={() => setInteractionMode("select")}
              >
                <Cursor />
              </Button>
            </span>
          </Tooltip>
          <Tooltip content="Pan timeline">
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                active={interactionMode === "pan"}
                aria-label="Pan timeline"
                aria-pressed={interactionMode === "pan"}
                onClick={() => {
                  stopSeeking()
                  setInteractionMode("pan")
                }}
              >
                <HandStop />
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            content={
              snapEnabled
                ? "Disable timeline snapping"
                : "Enable timeline snapping"
            }
          >
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                active={snapEnabled}
                aria-label={
                  snapEnabled
                    ? "Disable timeline snapping"
                    : "Enable timeline snapping"
                }
                aria-pressed={snapEnabled}
                onClick={() => onSnapEnabledChange(!snapEnabled)}
              >
                {snapEnabled ? <Magnet /> : <MagnetOff />}
              </Button>
            </span>
          </Tooltip>
        </div>
        <div className="flex w-52 shrink-0 items-center gap-2">
          <Label className="text-xs">Zoom</Label>
          <Slider
            value={[getTimelineZoomSliderValue(zoom)]}
            min={0}
            max={1}
            step={0.001}
            onValueChange={(value) =>
              zoomAroundPlayhead(
                getTimelineZoomFromSliderValue(
                  getSliderValue(value, getTimelineZoomSliderValue(zoom))
                )
              )
            }
          />
        </div>
      </div>

      <div
        ref={timelineViewportRef}
        className="scrollbar-minimal min-w-0 overflow-y-auto rounded-b-xl bg-card"
        style={{
          height: viewportHeight,
        }}
      >
        <div
          ref={timelineShellRef}
          className="relative min-w-0"
          style={
            {
              minHeight: timelineContentHeight,
              "--timeline-scroll-left": "0px",
            } as CSSProperties
          }
        >
          <div
            className="pointer-events-none sticky top-0 z-[60] overflow-hidden"
            style={{
              height: viewportHeight,
              marginBottom: -viewportHeight,
            }}
          >
            <div
              className="absolute inset-x-0 top-0 bg-card/95"
              style={{ height: RULER_HEIGHT }}
            >
              {ticks.map((seconds) => (
                <div
                  key={seconds}
                  className="absolute top-0 h-full border-l border-border/70 px-1 pt-1 font-pixel text-[10px] text-muted-foreground"
                  style={{
                    left: `calc(${
                      TIMELINE_CONTENT_INSET_X + seconds * zoom
                    }px - var(--timeline-scroll-left, 0px))`,
                  }}
                >
                  {formatDuration(seconds)}
                </div>
              ))}
            </div>
            {hoverSeconds === null ? null : (
              <div
                className="absolute top-0 bottom-0 z-[61] w-px bg-primary/35"
                style={{
                  left: `calc(${
                    TIMELINE_CONTENT_INSET_X + hoverSeconds * zoom
                  }px - var(--timeline-scroll-left, 0px))`,
                }}
              />
            )}
            {snapPreview?.mode === "move" ? (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-[61] w-px bg-snap-orange/90"
                style={{
                  left: `calc(${snapPreview.left}px - var(--timeline-scroll-left, 0px))`,
                }}
              />
            ) : null}
            <div
              className={[
                "absolute top-0 bottom-0 z-[62] w-px",
                isTrimSnapPreview ? "bg-snap-orange" : "bg-primary",
              ].join(" ")}
              style={{
                left: `calc(${
                  playheadSeconds * zoom +
                  TIMELINE_CONTENT_INSET_X +
                  TIMELINE_PLAYHEAD_LINE_OFFSET_PX
                }px - var(--timeline-scroll-left, 0px))`,
              }}
            />
            <div
              className={[
                "absolute top-1 z-[63] size-2 -translate-x-1/2 rotate-45 rounded-[2px]",
                isTrimSnapPreview ? "bg-snap-orange" : "bg-primary",
              ].join(" ")}
              style={{
                left: `calc(${
                  playheadSeconds * zoom +
                  TIMELINE_CONTENT_INSET_X +
                  TIMELINE_PLAYHEAD_CAP_OFFSET_PX
                }px - var(--timeline-scroll-left, 0px))`,
              }}
            />
          </div>
          <div
            ref={timelineRef}
            data-timeline-drop-zone="true"
            className={[
              "scrollbar-minimal absolute inset-0 h-full w-full max-w-full min-w-0 [touch-action:pan-x] overflow-x-auto overflow-y-hidden overscroll-x-contain",
              interactionMode === "pan"
                ? isPanning
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : "",
            ].join(" ")}
            style={{
              contain: "layout paint",
              minHeight: timelineContentHeight,
              scrollbarGutter: "stable",
              "--timeline-scroll-left": "0px",
            } as CSSProperties}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerCancel={handleTimelinePointerCancel}
            onLostPointerCapture={handleTimelinePointerCancel}
            onPointerLeave={() => setHoverSeconds(null)}
            onScroll={updateTimelineScroll}
            onDragEnter={updateDropPreview}
            onDragOver={updateDropPreview}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null
                )
              ) {
                setDropPreview(null)
              }
            }}
            onDrop={dropFilesOnTimeline}
          >
            <div
              className="relative min-h-full max-w-none"
              style={{
                minHeight: timelineContentHeight,
                minWidth: width + TIMELINE_CONTENT_INSET_X * 2,
                width: width + TIMELINE_CONTENT_INSET_X * 2,
              }}
            >
              {ticks.map((seconds) => (
                <div
                  key={`grid-${seconds}`}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/70"
                  style={{ left: TIMELINE_CONTENT_INSET_X + seconds * zoom }}
                />
              ))}
              {Array.from({ length: trackCount }, (_, index) => (
                <TrackLane
                  key={`track-lane-${index}`}
                  top={getTimelineTrackTop(index)}
                />
              ))}
              {dropPreview ? (
                <div
                  className="pointer-events-none absolute z-20 rounded-lg border border-dashed border-primary bg-primary/15 ring-2 ring-primary/20"
                  style={{
                    top: dropPreview.top,
                    left: dropPreview.left,
                    width: dropPreview.width,
                    height: TRACK_HEIGHT,
                  }}
                />
              ) : null}
              {project.clips.map((clip) => {
                const asset = project.sourceAssets.find(
                  (item) => item.id === clip.sourceAssetId
                )
                const connected = Boolean(runtimeAssets[clip.sourceAssetId])
                const trackIndex = getRenderedTrackIndex(clip)

                return (
                  <TimelineItem
                    key={clip.id}
                    top={getTimelineTrackTop(trackIndex)}
                    left={
                      TIMELINE_CONTENT_INSET_X +
                      clip.timelineStartSeconds * zoom
                    }
                    width={getClipDuration(clip) * zoom}
                    selected={
                      selection.type === "clip" && selection.id === clip.id
                    }
                    label={asset?.name ?? "Missing video"}
                    muted={clip.muted}
                    waveform={waveforms[clip.sourceAssetId]}
                    waveformVolume={clip.muted ? 0 : clip.volume}
                    sourceStartSeconds={clip.sourceStartSeconds}
                    sourceEndSeconds={clip.sourceEndSeconds}
                    timelineVisibleStartPx={timelineVisibleStartPx}
                    timelineVisibleEndPx={timelineVisibleEndPx}
                    connected={connected}
                    canDrag={interactionMode === "select"}
                    onSelect={() => onSelect({ type: "clip", id: clip.id })}
                    onSnapPreviewChange={setSnapPreview}
                    onTrimPreview={onPlayheadChange}
                    onDragPreview={(mode, deltaSeconds, deltaTracks) =>
                      getTimelineItemDragPreview(
                        clip,
                        timelineItems,
                        snapEnabled ? snapItems : null,
                        mode,
                        deltaSeconds,
                        deltaTracks,
                        zoom,
                        getTimelineTrackTop,
                        TIMELINE_CONTENT_INSET_X,
                        getSnapThresholdSeconds(zoom),
                        getTimelineItemSourceDuration(
                          clip,
                          project.sourceAssets
                        )
                      )
                    }
                    onDragCommit={(preview) =>
                      onClipChange(
                        clip.id,
                        preview.patch as Partial<TimelineClip>,
                        { insertTrackAtTop: preview.insertTrackAtTop }
                      )
                    }
                    onDragPreviewChange={(preview) => {
                      updateTopTrackInsertPreview(clip.id, preview)
                      onClipPreviewChange(clip.id, preview)
                    }}
                    zoom={zoom}
                  />
                )
              })}
              {project.musicTracks.map((track) => {
                const asset = project.sourceAssets.find(
                  (item) => item.id === track.sourceAssetId
                )
                const connected = Boolean(runtimeAssets[track.sourceAssetId])
                const trackIndex = getRenderedTrackIndex(track)

                return (
                  <TimelineItem
                    key={track.id}
                    top={getTimelineTrackTop(trackIndex)}
                    left={
                      TIMELINE_CONTENT_INSET_X +
                      track.timelineStartSeconds * zoom
                    }
                    width={getClipDuration(track) * zoom}
                    selected={
                      selection.type === "music" && selection.id === track.id
                    }
                    label={asset?.name ?? "Missing audio"}
                    muted={false}
                    waveform={waveforms[track.sourceAssetId]}
                    waveformVolume={track.volume}
                    sourceStartSeconds={track.sourceStartSeconds}
                    sourceEndSeconds={track.sourceEndSeconds}
                    timelineVisibleStartPx={timelineVisibleStartPx}
                    timelineVisibleEndPx={timelineVisibleEndPx}
                    connected={connected}
                    canDrag={interactionMode === "select"}
                    onSelect={() => onSelect({ type: "music", id: track.id })}
                    onSnapPreviewChange={setSnapPreview}
                    onTrimPreview={onPlayheadChange}
                    onDragPreview={(mode, deltaSeconds, deltaTracks) =>
                      getTimelineItemDragPreview(
                        track,
                        timelineItems,
                        snapEnabled ? snapItems : null,
                        mode,
                        deltaSeconds,
                        deltaTracks,
                        zoom,
                        getTimelineTrackTop,
                        TIMELINE_CONTENT_INSET_X,
                        getSnapThresholdSeconds(zoom),
                        getTimelineItemSourceDuration(
                          track,
                          project.sourceAssets
                        )
                      )
                    }
                    onDragCommit={(preview) =>
                      onMusicChange(
                        track.id,
                        preview.patch as Partial<MusicTrack>,
                        { insertTrackAtTop: preview.insertTrackAtTop }
                      )
                    }
                    onDragPreviewChange={(preview) => {
                      updateTopTrackInsertPreview(track.id, preview)
                      onMusicPreviewChange(track.id, preview)
                    }}
                    zoom={zoom}
                  />
                )
              })}
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-[70] w-8 bg-gradient-to-r from-card to-transparent"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-[70] w-8 bg-gradient-to-l from-card to-transparent"
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  )
}

function TimelineItem({
  top,
  left,
  width,
  selected,
  label,
  muted,
  waveform,
  waveformVolume,
  sourceStartSeconds,
  sourceEndSeconds,
  timelineVisibleStartPx,
  timelineVisibleEndPx,
  connected,
  canDrag,
  zoom,
  onSelect,
  onSnapPreviewChange,
  onTrimPreview,
  onDragPreview,
  onDragCommit,
  onDragPreviewChange,
}: {
  top: number
  left: number
  width: number
  selected: boolean
  label: string
  muted: boolean
  waveform?: TimelineWaveform
  waveformVolume: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  timelineVisibleStartPx: number
  timelineVisibleEndPx: number
  connected: boolean
  canDrag: boolean
  zoom: number
  onSelect: () => void
  onSnapPreviewChange: (preview: TimelineSnapPreview | null) => void
  onTrimPreview: (seconds: number) => void
  onDragPreview: (
    mode: TimelineDragMode,
    deltaSeconds: number,
    deltaTracks: number
  ) => TimelineItemDragPreview
  onDragCommit: (preview: TimelineItemDragPreview) => void
  onDragPreviewChange: (preview: TimelineItemDragPreview | null) => void
}) {
  const dragRef = useRef<{
    x: number
    y: number
    mode: TimelineDragMode
    dragging: boolean
  } | null>(null)
  const previewRef = useRef<TimelineItemDragPreview | null>(null)
  const [preview, setPreview] = useState<TimelineItemDragPreview | null>(null)
  const stylePreview = preview ?? { top, left, width }
  const showHandles = stylePreview.width >= TIMELINE_HANDLE_MIN_WIDTH
  const leadingInset = showHandles ? 16 : 10
  const trailingInset = muted ? 24 : leadingInset
  const previewSourceStartSeconds =
    typeof preview?.patch.sourceStartSeconds === "number"
      ? preview.patch.sourceStartSeconds
      : sourceStartSeconds
  const previewSourceEndSeconds =
    typeof preview?.patch.sourceEndSeconds === "number"
      ? preview.patch.sourceEndSeconds
      : sourceEndSeconds
  const waveformBars =
    waveform?.status === "ready"
      ? getTimelineItemWaveformBars({
          peaks: waveform.peaks,
          durationSeconds: waveform.durationSeconds,
          sourceStartSeconds: previewSourceStartSeconds,
          sourceEndSeconds: previewSourceEndSeconds,
          width: stylePreview.width,
          zoom,
          visibleStartPx: timelineVisibleStartPx - stylePreview.left,
          visibleEndPx: timelineVisibleEndPx - stylePreview.left,
        })
      : { totalBars: 0, bars: [] }
  const labelViewportWidth = Math.max(
    0,
    stylePreview.width - leadingInset - trailingInset
  )
  const maxLabelOffset = Math.max(0, labelViewportWidth - 24)
  const handleClassName = [
    "absolute top-1/2 z-30 h-5 w-1 -translate-y-1/2 rounded-full",
    canDrag ? "cursor-ew-resize" : "cursor-grab",
    selected ? "bg-primary-foreground/80" : "bg-foreground/25",
  ].join(" ")

  function startDrag(
    event: PointerEvent<HTMLDivElement>,
    mode: TimelineDragMode
  ) {
    onSelect()

    if (!canDrag) {
      return
    }

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      mode,
      dragging: false,
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return
    }

    event.stopPropagation()
    const deltaX = event.clientX - dragRef.current.x
    const deltaY = event.clientY - dragRef.current.y

    if (
      !dragRef.current.dragging &&
      Math.hypot(deltaX, deltaY) < TIMELINE_DRAG_START_THRESHOLD_PX
    ) {
      return
    }

    dragRef.current.dragging = true
    const deltaSeconds = deltaX / zoom
    const deltaTracks =
      dragRef.current.mode === "move"
        ? Math.round(deltaY / (TRACK_HEIGHT + TRACK_GAP))
        : 0
    const nextPreview = onDragPreview(
      dragRef.current.mode,
      deltaSeconds,
      deltaTracks
    )

    previewRef.current = nextPreview
    setPreview(nextPreview)
    onDragPreviewChange(nextPreview)
    onSnapPreviewChange(nextPreview.snapPreview ?? null)

    if (nextPreview.trimPlayheadSeconds !== undefined) {
      onTrimPreview(nextPreview.trimPlayheadSeconds)
    }
  }

  function resetDrag() {
    previewRef.current = null
    dragRef.current = null
    setPreview(null)
    onDragPreviewChange(null)
    onSnapPreviewChange(null)
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (previewRef.current && isPointerInsideTimelineDropZone(event)) {
      onDragCommit(previewRef.current)
    }

    resetDrag()
  }

  return (
    <div
      className={[
        "absolute overflow-hidden rounded-lg border text-xs",
        "cursor-grab",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
        connected ? "" : "opacity-60",
        preview ? "z-30 opacity-80" : "",
      ].join(" ")}
      style={{
        top: stylePreview.top,
        left: stylePreview.left,
        width: stylePreview.width,
        height: TRACK_HEIGHT,
        "--timeline-item-left": `${stylePreview.left}px`,
        "--timeline-label-max-offset": `${maxLabelOffset}px`,
      } as CSSProperties}
      onPointerDown={(event) => startDrag(event, "move")}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={resetDrag}
    >
      <TimelineWaveform
        waveform={waveformBars}
        volume={waveformVolume}
        selected={selected}
      />
      {showHandles ? (
        <div
          className={`${handleClassName} left-1`}
          onPointerDown={(event) => startDrag(event, "start")}
        />
      ) : null}
      <div
        className="pointer-events-none absolute top-0 bottom-0 z-20 overflow-hidden"
        style={{
          left: leadingInset,
          right: trailingInset,
        }}
      >
        <span
          className="absolute top-0 bottom-0 flex min-w-0 items-center"
          style={{
            left:
              "clamp(0px, calc(var(--timeline-scroll-left, 0px) - var(--timeline-item-left, 0px)), var(--timeline-label-max-offset, 0px))",
            right: 0,
          }}
          title={connected ? label : `${label} · missing file`}
        >
          <span
            className={[
              "flex min-w-0 max-w-full items-center gap-1 rounded px-1 py-0.5",
              selected ? "bg-primary" : "bg-background",
            ].join(" ")}
          >
            <span className="min-w-0 truncate">{label}</span>
            {!connected ? (
              <Tooltip content="Missing local file">
                <span
                  className="pointer-events-auto inline-flex size-3 shrink-0 items-center justify-center text-destructive"
                  tabIndex={0}
                  aria-label="Missing local file"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <CircleExclamation className="size-3" />
                </span>
              </Tooltip>
            ) : null}
          </span>
        </span>
      </div>
      {muted ? (
        <VolumeX className="absolute top-1/2 right-2 z-20 size-3 -translate-y-1/2" />
      ) : null}
      {showHandles ? (
        <div
          className={`${handleClassName} right-1`}
          onPointerDown={(event) => startDrag(event, "end")}
        />
      ) : null}
    </div>
  )
}

function TimelineWaveform({
  waveform,
  volume,
  selected,
}: {
  waveform: TimelineItemWaveformBars
  volume: number
  selected: boolean
}) {
  const volumeScale = clamp(volume, 0, MAX_MEDIA_VOLUME)
  const waveformPath = useMemo(() => {
    return waveform.bars
      .map(({ index, peak }) => {
        const normalizedPeak = clamp(peak * volumeScale, 0, 1)
        const halfHeight = Math.max(1, normalizedPeak * 48)
        const x = index + 0.5

        return `M${x} ${50 - halfHeight}V${50 + halfHeight}`
      })
      .join(" ")
  }, [volumeScale, waveform.bars])

  if (
    volumeScale <= WAVEFORM_MIN_VISIBLE_VOLUME ||
    waveform.totalBars === 0 ||
    waveform.bars.length === 0
  ) {
    return null
  }
  return (
    <div
      className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-[calc(100%-12px)] -translate-y-1/2 opacity-85"
      aria-hidden="true"
    >
      <svg
        className="size-full"
        viewBox={`0 0 ${waveform.totalBars} 100`}
        preserveAspectRatio="none"
      >
        <path
          className={
            selected
              ? "stroke-primary-foreground/55"
              : "stroke-muted-foreground/45 dark:stroke-muted-foreground/60"
          }
          d={waveformPath}
          fill="none"
          strokeLinecap="round"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

function isPointerInsideTimelineDropZone(event: PointerEvent<HTMLElement>) {
  const dropZone = event.currentTarget.closest("[data-timeline-drop-zone]")

  if (!(dropZone instanceof HTMLElement)) {
    return false
  }

  const rect = dropZone.getBoundingClientRect()

  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function TrackLane({ top }: { top: number }) {
  return (
    <div
      className="absolute inset-x-0 rounded-lg"
      style={{ top, height: TRACK_HEIGHT }}
    />
  )
}

function RangeField({
  label,
  value,
  min = 0,
  max,
  step,
  formatValue = (nextValue) => `${Math.round(nextValue * 100)}%`,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max: number
  step: number
  formatValue?: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <SliderComfortable
        value={value}
        min={min}
        max={max}
        step={step}
        variant="scrubber"
        bordered={false}
        label={label}
        formatValue={formatValue}
        onChange={(nextValue) => {
          if (Object.is(nextValue, value)) {
            return
          }

          onChange(nextValue)
        }}
      />
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="group relative">
        <Input
          className={`select-text ${unit ? "pr-16" : ""}`}
          type="number"
          min={0}
          step={0.1}
          value={Number(value.toFixed(2))}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit ? (
          <span className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 text-[13px] text-muted-foreground group-focus-within:text-foreground group-hover:text-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3 rounded-lg bg-background px-4 text-[13px] text-muted-foreground">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function getExportFormatLabel(format: ExportFormat) {
  return format.toUpperCase()
}

function formatExportBitrateDetail(settings: Project["exportSettings"]) {
  const { audioBitsPerSecond, videoBitsPerSecond } = getExportBitrates(settings)

  return `${formatBitrate(videoBitsPerSecond)} / ${formatBitrate(audioBitsPerSecond)}`
}

function formatBitrate(bitsPerSecond: number) {
  if (bitsPerSecond >= 1_000_000) {
    return `${formatRoundedNumber(bitsPerSecond / 1_000_000)} Mbps`
  }

  return `${Math.round(bitsPerSecond / 1_000)} kbps`
}

function formatRoundedNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function getExportAspectRatio(settings: Project["exportSettings"]) {
  return settings.width / settings.height || 16 / 9
}

function getExportAspectOption(settings: Project["exportSettings"]) {
  const ratio = getExportAspectRatio(settings)

  return (
    ASPECT_RATIO_OPTIONS.find(
      (option) => Math.abs(option.width / option.height - ratio) < 0.01
    ) ?? ASPECT_RATIO_OPTIONS[0]
  )
}

function getResolutionValue(width: number, height: number) {
  return `${width}x${height}`
}

function getResolutionOptions(settings: Project["exportSettings"]) {
  const aspectOption = getExportAspectOption(settings)
  const options = aspectOption.resolutions.map((resolution) => ({
    label: resolution.label,
    value: getResolutionValue(resolution.width, resolution.height),
  }))
  const currentValue = getResolutionValue(settings.width, settings.height)

  if (!options.some((option) => option.value === currentValue)) {
    return [
      {
        label: `${settings.width} x ${settings.height}`,
        value: currentValue,
      },
      ...options,
    ]
  }

  return options
}

function getPreviewVideoLayerGeometry({
  asset,
  clip,
  frameHeight,
  frameWidth,
}: {
  asset?: SourceAsset
  clip: TimelineClip
  frameHeight: number
  frameWidth: number
}) {
  const sourceAspectRatio =
    asset?.width && asset.height
      ? asset.width / asset.height
      : frameWidth / frameHeight
  const frameAspectRatio = frameWidth / frameHeight
  const sourceWidth =
    sourceAspectRatio >= frameAspectRatio
      ? frameWidth
      : frameHeight * sourceAspectRatio
  const sourceHeight =
    sourceAspectRatio >= frameAspectRatio
      ? frameWidth / sourceAspectRatio
      : frameHeight

  return {
    heightPercent: (sourceHeight / frameHeight) * 100,
    positionX: getClipPositionX(clip),
    positionY: getClipPositionY(clip),
    scale: getClipScale(clip),
    sourceHeight,
    sourceWidth,
    widthPercent: (sourceWidth / frameWidth) * 100,
  }
}

function getPreviewVideoLayerStyle(
  layerGeometry: ReturnType<typeof getPreviewVideoLayerGeometry>,
  zIndex: number
): CSSProperties {
  return {
    aspectRatio: `${layerGeometry.sourceWidth} / ${layerGeometry.sourceHeight}`,
    height: `${layerGeometry.heightPercent}%`,
    left: `${50 + layerGeometry.positionX}%`,
    top: `${50 + layerGeometry.positionY}%`,
    transform: `translate3d(-50%, -50%, 0) scale(${layerGeometry.scale})`,
    width: `${layerGeometry.widthPercent}%`,
    zIndex,
  }
}

function getClipScale(clip: { scale?: number }) {
  return clamp(clip.scale ?? 1, 0, 2)
}

function getClipPositionX(clip: { positionX?: number }) {
  return clamp(clip.positionX ?? 0, -100, 100)
}

function getClipPositionY(clip: { positionY?: number }) {
  return clamp(clip.positionY ?? 0, -100, 100)
}

function ResizeGapHandle({
  orientation,
  active,
  ...props
}: {
  orientation: "vertical" | "horizontal"
  active: boolean
} & Omit<ComponentPropsWithoutRef<"button">, "type">) {
  const isVertical = orientation === "vertical"

  return (
    <button
      {...props}
      type="button"
      className={[
        "rounded-full transition-[width,height] duration-150",
        isVertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        active
          ? "bg-primary"
          : "bg-muted-foreground/25 hover:bg-muted-foreground/45",
        isVertical
          ? active
            ? "h-20"
            : "h-10 hover:h-16"
          : active
            ? "w-24"
            : "w-12 hover:w-20",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  )
}

type TimelineItemData = TimelineClip | MusicTrack
type TimelineDragMode = "move" | "start" | "end"
type TimelineInteractionMode = "select" | "pan"
type TimelineDroppedFile = {
  file: File
  fileHandle?: FileSystemFileHandle
}
type TimelineDropPlacement = {
  timelineStartSeconds: number
  trackIndex: number
  insertTrackAtTop?: boolean
}
type TimelineDropPreview = {
  top: number
  left: number
  width: number
  placement: TimelineDropPlacement
  insertTrackAtTop?: boolean
}
type TimelineDropMetadataCache = {
  durationSeconds?: number
  loaded?: boolean
  promise?: Promise<number | undefined>
}
type TimelineItemDragPreview = {
  top: number
  left: number
  width: number
  insertTrackAtTop?: boolean
  snapPreview?: TimelineSnapPreview
  trimPlayheadSeconds?: number
  patch: Partial<TimelineItemData>
}
type TimelineSnapPreview = {
  left: number
  mode: TimelineDragMode
}

function getTrackIndex(item: { trackIndex?: number }) {
  return Math.max(0, Math.round(item.trackIndex ?? 0))
}

function getTrackCount(items: { trackIndex?: number }[]) {
  return items.reduce(
    (count, item) => Math.max(count, getTrackIndex(item) + 1),
    1
  )
}

function getTimelineItemSourceDuration(
  item: TimelineItemData,
  sourceAssets: SourceAsset[]
) {
  return (
    sourceAssets.find((asset) => asset.id === item.sourceAssetId)
      ?.durationSeconds ?? item.sourceEndSeconds
  )
}

function getTimelineTrackTop(trackIndex: number) {
  return TIMELINE_TRACK_TOP + trackIndex * (TRACK_HEIGHT + TRACK_GAP)
}

function getTimelineDropPreview(
  event: DragEvent<HTMLDivElement>,
  zoom: number,
  duration: number,
  contentInsetX: number,
  draggedDurationSeconds?: number
): TimelineDropPreview {
  return getTimelineDropPreviewFromPoint({
    clientX: event.clientX,
    clientY: event.clientY,
    container: event.currentTarget,
    contentInsetX,
    duration,
    draggedDurationSeconds,
    zoom,
  })
}

function getTimelineDropPreviewFromPoint({
  clientX,
  clientY,
  container,
  contentInsetX,
  duration,
  draggedDurationSeconds,
  zoom,
}: {
  clientX: number
  clientY: number
  container: HTMLDivElement
  contentInsetX: number
  duration: number
  draggedDurationSeconds?: number
  zoom: number
}): TimelineDropPreview {
  const rect = container.getBoundingClientRect()
  const y = clientY - rect.top
  const timelineStartSeconds = getTimelineSeconds(
    container,
    clientX,
    zoom,
    duration,
    contentInsetX
  )
  const rawTrackIndex = Math.round(
    (y - TIMELINE_TRACK_TOP) / (TRACK_HEIGHT + TRACK_GAP)
  )
  const insertTrackAtTop = rawTrackIndex < 0
  const trackIndex = insertTrackAtTop ? 0 : Math.max(0, rawTrackIndex)

  return {
    top: getTimelineTrackTop(trackIndex),
    left: contentInsetX + timelineStartSeconds * zoom,
    width: getTimelineDropPreviewWidth(zoom, draggedDurationSeconds),
    placement: {
      timelineStartSeconds,
      trackIndex,
      insertTrackAtTop,
    },
    insertTrackAtTop,
  }
}

function getTimelineDropPreviewWidth(
  zoom: number,
  durationSeconds?: number
) {
  if (durationSeconds !== undefined && durationSeconds > 0) {
    return Math.max(TIMELINE_DROP_FALLBACK_MIN_WIDTH, durationSeconds * zoom)
  }

  return Math.max(
    TIMELINE_DROP_FALLBACK_MIN_WIDTH,
    TIMELINE_DROP_FALLBACK_DURATION_SECONDS * zoom
  )
}

function getTimelineDraggedFileDuration(
  dataTransfer: DataTransfer,
  cache: Map<string, TimelineDropMetadataCache>
) {
  const file = getFirstTimelineDraggedMediaFile(dataTransfer)

  if (!file) {
    return undefined
  }

  const cached = cache.get(getTimelineDraggedFileKey(file))

  return cached?.loaded ? cached.durationSeconds : undefined
}

function loadTimelineDraggedFileDuration(
  dataTransfer: DataTransfer,
  cache: Map<string, TimelineDropMetadataCache>
) {
  const file = getFirstTimelineDraggedMediaFile(dataTransfer)
  const type = file ? getFileKind(file) : null

  if (!file || !type) {
    return undefined
  }

  const key = getTimelineDraggedFileKey(file)
  const cached = cache.get(key)

  if (cached?.loaded) {
    return Promise.resolve(cached.durationSeconds)
  }

  if (cached?.promise) {
    return cached.promise
  }

  const promise = readMediaMetadata(file, type).then((metadata) => {
    const durationSeconds =
      metadata.durationSeconds !== undefined && metadata.durationSeconds > 0
        ? metadata.durationSeconds
        : undefined

    cache.set(key, { durationSeconds, loaded: true })

    return durationSeconds
  })

  cache.set(key, { promise })

  return promise
}

function getFirstTimelineDraggedMediaFile(dataTransfer: DataTransfer) {
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue
    }

    const file = item.getAsFile()

    if (file && getFileKind(file)) {
      return file
    }
  }

  for (const file of Array.from(dataTransfer.files)) {
    if (getFileKind(file)) {
      return file
    }
  }

  return null
}

function getTimelineDraggedFileKey(file: File) {
  return [file.name, file.type, file.size, file.lastModified].join(":")
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

function getTimelineItemDragPreview<T extends TimelineItemData>(
  item: T,
  laneItems: TimelineItemData[],
  snapItems: TimelineItemData[] | null,
  mode: TimelineDragMode,
  deltaSeconds: number,
  deltaTracks: number,
  zoom: number,
  getTop: (trackIndex: number) => number,
  contentInsetX: number,
  snapThresholdSeconds: number,
  sourceDurationSeconds: number
): TimelineItemDragPreview {
  const rawTrackIndex = getTrackIndex(item) + deltaTracks
  const insertTrackAtTop = mode === "move" && rawTrackIndex < 0
  const constraintItems = insertTrackAtTop
    ? shiftTimelineItemsForTopInsert(laneItems, item.id)
    : laneItems
  const constraintSnapItems =
    snapItems && insertTrackAtTop
      ? shiftTimelineItemsForTopInsert(snapItems, item.id)
      : snapItems
  const patch = {
    ...getTimelineDragPatch(
      item,
      mode,
      deltaSeconds,
      deltaTracks,
      sourceDurationSeconds
    ),
    ...(insertTrackAtTop ? { trackIndex: 0 } : null),
  } as Partial<T>
  const next = constrainTimelineItemPatch(
    item,
    constraintItems,
    patch,
    constraintSnapItems,
    snapThresholdSeconds,
    sourceDurationSeconds
  )
  const duration = getClipDuration(next)
  const snapGuideSeconds = snapItems
    ? getTimelineSnapGuideSeconds(
        next,
        snapItems.filter((candidate) => candidate.id !== item.id),
        mode,
        snapThresholdSeconds
      )
    : null

  return {
    top: getTop(insertTrackAtTop ? 0 : getTrackIndex(next)),
    left: contentInsetX + next.timelineStartSeconds * zoom,
    width: duration * zoom,
    insertTrackAtTop,
    snapPreview:
      snapGuideSeconds === null
        ? undefined
        : {
            left: contentInsetX + snapGuideSeconds * zoom,
            mode,
          },
    trimPlayheadSeconds:
      mode === "start"
        ? next.timelineStartSeconds
        : mode === "end"
          ? next.timelineStartSeconds + duration
          : undefined,
    patch: getTimelineCommitPatch(next, mode),
  }
}

function shiftTimelineItemsForTopInsert(
  items: TimelineItemData[],
  selectedItemId: string
) {
  return items.map((item) =>
    item.id === selectedItemId
      ? item
      : { ...item, trackIndex: getTrackIndex(item) + 1 }
  )
}

function getTimelineDragPatch<T extends TimelineItemData>(
  item: T,
  mode: TimelineDragMode,
  deltaSeconds: number,
  deltaTracks: number,
  sourceDurationSeconds: number
): Partial<T> {
  if (mode === "move") {
    return {
      timelineStartSeconds: Math.max(
        0,
        item.timelineStartSeconds + deltaSeconds
      ),
      trackIndex: Math.max(0, getTrackIndex(item) + deltaTracks),
    } as Partial<T>
  }

  if (mode === "start") {
    const desiredSourceStart = clamp(
      item.sourceStartSeconds + deltaSeconds,
      0,
      item.sourceEndSeconds - MIN_ITEM_DURATION_SECONDS
    )
    const desiredSourceDelta = desiredSourceStart - item.sourceStartSeconds
    const sourceDelta = Math.max(
      -item.timelineStartSeconds,
      desiredSourceDelta
    )

    return {
      sourceStartSeconds: item.sourceStartSeconds + sourceDelta,
      timelineStartSeconds: item.timelineStartSeconds + sourceDelta,
    } as Partial<T>
  }

  const sourceDuration = Math.max(
    MIN_ITEM_DURATION_SECONDS,
    sourceDurationSeconds
  )

  return {
    sourceEndSeconds: clamp(
      item.sourceEndSeconds + deltaSeconds,
      item.sourceStartSeconds + MIN_ITEM_DURATION_SECONDS,
      sourceDuration
    ),
  } as Partial<T>
}

function getTimelineCommitPatch<T extends TimelineItemData>(
  item: T,
  mode: TimelineDragMode
): Partial<T> {
  if (mode === "move") {
    return {
      timelineStartSeconds: item.timelineStartSeconds,
      trackIndex: getTrackIndex(item),
    } as Partial<T>
  }

  if (mode === "start") {
    return {
      timelineStartSeconds: item.timelineStartSeconds,
      sourceStartSeconds: item.sourceStartSeconds,
    } as Partial<T>
  }

  return {
    sourceEndSeconds: item.sourceEndSeconds,
  } as Partial<T>
}

function getTimeTickInterval(zoom: number) {
  const targetPixels = 96
  const rawSeconds = targetPixels / zoom
  const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

  return intervals.find((interval) => interval >= rawSeconds) ?? 900
}

function findAvailableTrackIndex(
  items: TimelineItemData[],
  startSeconds: number,
  durationSeconds: number
) {
  for (let trackIndex = 0; trackIndex < 32; trackIndex += 1) {
    if (
      !items.some(
        (item) =>
          getTrackIndex(item) === trackIndex &&
          rangesOverlap(
            startSeconds,
            startSeconds + durationSeconds,
            item.timelineStartSeconds,
            item.timelineStartSeconds + getClipDuration(item)
          )
      )
    ) {
      return trackIndex
    }
  }

  return 0
}

function findNearestAvailableTrackIndex(
  items: TimelineItemData[],
  preferredTrackIndex: number,
  startSeconds: number,
  durationSeconds: number
) {
  const clampedPreferredTrackIndex = Math.max(0, preferredTrackIndex)
  const candidates = [clampedPreferredTrackIndex]

  for (let offset = 1; offset < 32; offset += 1) {
    candidates.push(clampedPreferredTrackIndex + offset)

    if (clampedPreferredTrackIndex - offset >= 0) {
      candidates.push(clampedPreferredTrackIndex - offset)
    }
  }

  return (
    candidates.find(
      (trackIndex) =>
        !items.some(
          (item) =>
            getTrackIndex(item) === trackIndex &&
            rangesOverlap(
              startSeconds,
              startSeconds + durationSeconds,
              item.timelineStartSeconds,
              item.timelineStartSeconds + getClipDuration(item)
            )
        )
    ) ?? clampedPreferredTrackIndex
  )
}

function constrainTimelineItemPatch<T extends TimelineItemData>(
  item: T,
  items: TimelineItemData[],
  patch: Partial<T>,
  snapItems: TimelineItemData[] | null = items,
  snapThresholdSeconds = SNAP_THRESHOLD_SECONDS,
  sourceDurationSeconds?: number
): T {
  const sourceDuration = Math.max(
    MIN_ITEM_DURATION_SECONDS,
    sourceDurationSeconds ?? item.sourceEndSeconds
  )
  const patchedSourceStart =
    patch.sourceStartSeconds ?? item.sourceStartSeconds
  const safeSourceStart = clamp(
    patchedSourceStart,
    0,
    sourceDuration - MIN_ITEM_DURATION_SECONDS
  )
  const patchedSourceEnd = patch.sourceEndSeconds ?? item.sourceEndSeconds
  const safeSourceEnd = clamp(
    patchedSourceEnd,
    safeSourceStart + MIN_ITEM_DURATION_SECONDS,
    sourceDuration
  )
  const next = {
    ...item,
    ...patch,
    sourceStartSeconds: safeSourceStart,
    sourceEndSeconds: safeSourceEnd,
    trackIndex: Math.max(
      0,
      Math.round(patch.trackIndex ?? item.trackIndex ?? 0)
    ),
  }
  const laneItems = items.filter(
    (candidate) =>
      candidate.id !== item.id && getTrackIndex(candidate) === next.trackIndex
  )
  const isTrimStart =
    patch.timelineStartSeconds !== undefined &&
    patch.sourceStartSeconds !== undefined
  const isTrimEnd = patch.sourceEndSeconds !== undefined && !isTrimStart
  const isMove =
    patch.timelineStartSeconds !== undefined && !isTrimStart && !isTrimEnd

  if (isMove) {
    const duration = getClipDuration(next)
    const desiredStart = Math.max(0, next.timelineStartSeconds)
    const snappedStart = snapItems
      ? snapTimelineStart(
          desiredStart,
          duration,
          snapItems.filter((candidate) => candidate.id !== item.id),
          snapThresholdSeconds
        )
      : normalizeTimelineSeconds(desiredStart)

    return {
      ...next,
      timelineStartSeconds: findNearestNonOverlappingStart(
        snappedStart,
        duration,
        laneItems
      ),
    }
  }

  if (isTrimStart) {
    const fixedEnd = item.timelineStartSeconds + getClipDuration(item)
    const nextItemStart = getNextItemStart(laneItems, fixedEnd)
    const maxEnd = nextItemStart ?? fixedEnd
    const start = Math.max(0, next.timelineStartSeconds)
    const minStartFromSource = Math.max(
      0,
      item.timelineStartSeconds - item.sourceStartSeconds
    )
    const desiredStart = snapItems
      ? snapPoint(
          start,
          [
            0,
            ...snapItems
              .filter((candidate) => candidate.id !== item.id)
              .flatMap((snapItem) => [
                snapItem.timelineStartSeconds,
                snapItem.timelineStartSeconds + getClipDuration(snapItem),
              ]),
          ],
          snapThresholdSeconds
        )
      : normalizeTimelineSeconds(start)
    const clampedStart = clamp(
      desiredStart,
      Math.max(getPreviousItemEnd(laneItems, fixedEnd), minStartFromSource),
      Math.min(fixedEnd - MIN_ITEM_DURATION_SECONDS, maxEnd)
    )
    const normalizedStart = normalizeTimelineSeconds(clampedStart)
    const duration = fixedEnd - normalizedStart

    return {
      ...next,
      timelineStartSeconds: normalizedStart,
      sourceStartSeconds: normalizeTimelineSeconds(
        clamp(
          next.sourceEndSeconds - duration,
          0,
          next.sourceEndSeconds - MIN_ITEM_DURATION_SECONDS
        )
      ),
    }
  }

  if (isTrimEnd) {
    const start = next.timelineStartSeconds
    const maxEnd = Math.min(
      getNextItemStart(laneItems, start) ?? Infinity,
      start + sourceDuration - next.sourceStartSeconds
    )
    const end = start + getClipDuration(next)
    const desiredEnd = snapItems
      ? snapPoint(
          end,
          [
            ...snapItems
              .filter((candidate) => candidate.id !== item.id)
              .flatMap((snapItem) => [
                snapItem.timelineStartSeconds,
                snapItem.timelineStartSeconds + getClipDuration(snapItem),
              ]),
          ],
          snapThresholdSeconds
        )
      : normalizeTimelineSeconds(end)
    const clampedEnd = clamp(
      desiredEnd,
      start + MIN_ITEM_DURATION_SECONDS,
      maxEnd
    )

    return {
      ...next,
      sourceEndSeconds:
        next.sourceStartSeconds +
        normalizeTimelineSeconds(
          clamp(
            clampedEnd - start,
            MIN_ITEM_DURATION_SECONDS,
            sourceDuration - next.sourceStartSeconds
          )
        ),
    }
  }

  return next
}

function snapTimelineStart(
  startSeconds: number,
  durationSeconds: number,
  laneItems: TimelineItemData[],
  snapThresholdSeconds = SNAP_THRESHOLD_SECONDS
) {
  const endSeconds = startSeconds + durationSeconds
  const points = [
    0,
    ...laneItems.flatMap((item) => [
      item.timelineStartSeconds,
      item.timelineStartSeconds + getClipDuration(item),
    ]),
  ]
  const snappedStart = snapPoint(startSeconds, points, snapThresholdSeconds)

  if (Math.abs(snappedStart - startSeconds) > TIMELINE_EPSILON_SECONDS) {
    return normalizeTimelineSeconds(snappedStart)
  }

  const snappedEnd = snapPoint(endSeconds, points, snapThresholdSeconds)

  return normalizeTimelineSeconds(
    Math.abs(snappedEnd - endSeconds) <= TIMELINE_EPSILON_SECONDS
      ? startSeconds
      : snappedEnd - durationSeconds - SNAP_OVERLAP_SECONDS
  )
}

function snapPoint(
  value: number,
  points: number[],
  snapThresholdSeconds = SNAP_THRESHOLD_SECONDS
) {
  let nearest = value
  let nearestDistance = snapThresholdSeconds

  for (const point of points) {
    const distance = Math.abs(value - point)

    if (distance <= nearestDistance) {
      nearest = point
      nearestDistance = distance
    }
  }

  return normalizeTimelineSeconds(Math.max(0, nearest))
}

function getSnapThresholdSeconds(zoom: number) {
  return clamp(
    SNAP_THRESHOLD_TARGET_PIXELS / Math.max(zoom, 0.001),
    SNAP_THRESHOLD_SECONDS,
    SNAP_THRESHOLD_MAX_SECONDS
  )
}

function getTimelineSnapGuideSeconds(
  item: TimelineItemData,
  snapItems: TimelineItemData[],
  mode: TimelineDragMode,
  snapThresholdSeconds: number
) {
  const duration = getClipDuration(item)
  const points = [
    0,
    ...snapItems.flatMap((snapItem) => [
      snapItem.timelineStartSeconds,
      snapItem.timelineStartSeconds + getClipDuration(snapItem),
    ]),
  ]
  const edges =
    mode === "start"
      ? [item.timelineStartSeconds]
      : mode === "end"
        ? [item.timelineStartSeconds + duration]
        : [item.timelineStartSeconds, item.timelineStartSeconds + duration]
  let nearestPoint: number | null = null
  let nearestDistance = snapThresholdSeconds + TIMELINE_EPSILON_SECONDS

  for (const edge of edges) {
    for (const point of points) {
      const distance = Math.abs(edge - point)

      if (distance <= nearestDistance) {
        nearestPoint = point
        nearestDistance = distance
      }
    }
  }

  return nearestPoint === null ? null : normalizeTimelineSeconds(nearestPoint)
}

function findNearestNonOverlappingStart(
  desiredStart: number,
  durationSeconds: number,
  laneItems: TimelineItemData[]
) {
  const sorted = [...laneItems].sort(
    (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
  )
  const candidates = [Math.max(0, desiredStart), 0]

  for (const item of sorted) {
    candidates.push(item.timelineStartSeconds - durationSeconds)
    candidates.push(item.timelineStartSeconds + getClipDuration(item))
  }

  const nearestStart =
    candidates
      .filter((candidate) => candidate >= 0)
      .filter(
        (candidate) =>
          !sorted.some((item) =>
            rangesOverlap(
              candidate,
              candidate + durationSeconds,
              item.timelineStartSeconds,
              item.timelineStartSeconds + getClipDuration(item)
            )
          )
      )
      .sort(
        (a, b) => Math.abs(a - desiredStart) - Math.abs(b - desiredStart)
      )[0] ?? Math.max(0, desiredStart)

  return normalizeTimelineSeconds(nearestStart)
}

function normalizeTimelineSeconds(seconds: number) {
  return Math.max(
    0,
    Math.round(seconds * TIMELINE_PRECISION_SECONDS) /
      TIMELINE_PRECISION_SECONDS
  )
}

function isTimelineItemActiveAt(item: TimelineItemData, seconds: number) {
  const start = item.timelineStartSeconds
  const end = item.timelineStartSeconds + getClipDuration(item)

  return (
    seconds + TIMELINE_EPSILON_SECONDS >= start &&
    seconds < end + TIMELINE_EPSILON_SECONDS
  )
}

function isTimelineItemNearTime(
  item: TimelineItemData,
  seconds: number,
  lookaheadSeconds: number
) {
  const start = item.timelineStartSeconds
  const end = item.timelineStartSeconds + getClipDuration(item)

  return (
    seconds + TIMELINE_EPSILON_SECONDS >= start - lookaheadSeconds &&
    seconds < end + TIMELINE_EPSILON_SECONDS
  )
}

function getPreviousItemEnd(
  laneItems: TimelineItemData[],
  beforeSeconds: number
) {
  return laneItems.reduce((end, item) => {
    const itemEnd = item.timelineStartSeconds + getClipDuration(item)

    return itemEnd <= beforeSeconds ? Math.max(end, itemEnd) : end
  }, 0)
}

function getNextItemStart(laneItems: TimelineItemData[], afterSeconds: number) {
  return laneItems.reduce<number | undefined>((start, item) => {
    if (item.timelineStartSeconds < afterSeconds) {
      return start
    }

    return start === undefined
      ? item.timelineStartSeconds
      : Math.min(start, item.timelineStartSeconds)
  }, undefined)
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  return startA < endB && endA > startB
}

function findTimelineItemsAtTime<T extends TimelineItemData>(
  items: T[],
  seconds: number
) {
  return items.filter((item) => isTimelineItemActiveAt(item, seconds))
}

function findTimelineItemsNearTime<T extends TimelineItemData>(
  items: T[],
  seconds: number,
  lookaheadSeconds: number
) {
  return items.filter((item) =>
    isTimelineItemNearTime(item, seconds, lookaheadSeconds)
  )
}

function getPreviewLayerZIndex(item: TimelineItemData) {
  return 1000 - getTrackIndex(item)
}

function getSourceTimeForTimelineItem(
  item: {
    sourceStartSeconds: number
    sourceEndSeconds: number
    timelineStartSeconds: number
  },
  playheadSeconds: number
) {
  const itemOffset = clamp(
    playheadSeconds - item.timelineStartSeconds,
    0,
    getClipDuration(item)
  )

  const sourceTime = item.sourceStartSeconds + itemOffset
  const maxPreviewSourceTime = Math.max(
    item.sourceStartSeconds,
    item.sourceEndSeconds - PREVIEW_EDGE_SAMPLE_SECONDS
  )

  return clamp(sourceTime, item.sourceStartSeconds, maxPreviewSourceTime)
}

function waitForMediaMetadata(media: HTMLMediaElement) {
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      media.removeEventListener("loadedmetadata", onLoadedMetadata)
      media.removeEventListener("error", onError)
    }

    function onLoadedMetadata() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error("Could not load media metadata"))
    }

    media.addEventListener("loadedmetadata", onLoadedMetadata, { once: true })
    media.addEventListener("error", onError, { once: true })
  })
}

function waitForMediaSeek(media: HTMLMediaElement) {
  if (!media.seeking) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      media.removeEventListener("seeked", onSeeked)
      media.removeEventListener("error", onError)
    }

    function onSeeked() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error("Could not seek media"))
    }

    media.addEventListener("seeked", onSeeked, { once: true })
    media.addEventListener("error", onError, { once: true })
  })
}

function waitForMediaCurrentData(media: HTMLMediaElement) {
  if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      media.removeEventListener("loadeddata", onLoadedData)
      media.removeEventListener("canplay", onLoadedData)
      media.removeEventListener("error", onError)
    }

    function onLoadedData() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error("Could not load media frame"))
    }

    media.addEventListener("loadeddata", onLoadedData, { once: true })
    media.addEventListener("canplay", onLoadedData, { once: true })
    media.addEventListener("error", onError, { once: true })
  })
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function getTimelineSeconds(
  container: HTMLDivElement,
  clientX: number,
  zoom: number,
  duration: number,
  contentInsetX = 0
) {
  const rect = container.getBoundingClientRect()
  const x = clientX - rect.left + container.scrollLeft

  return clamp((x - contentInsetX) / zoom, 0, duration)
}

function getSliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? (value[0] ?? fallback) : value
}

function getStoredEditorLayoutValue(
  key: "inspectorWidth" | "timelinePanelHeight",
  fallback: number,
  min: number,
  max: number
) {
  if (typeof window === "undefined") {
    return fallback
  }

  try {
    const stored = window.localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY)

    if (!stored) {
      return fallback
    }

    const parsed = JSON.parse(stored) as Partial<
      Record<"inspectorWidth" | "timelinePanelHeight", number>
    >
    const value = parsed[key]

    return typeof value === "number" && Number.isFinite(value)
      ? clamp(value, min, max)
      : fallback
  } catch {
    return fallback
  }
}

function saveEditorLayout(layout: {
  inspectorWidth: number
  timelinePanelHeight: number
}) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      EDITOR_LAYOUT_STORAGE_KEY,
      JSON.stringify(layout)
    )
  } catch {
    // Ignore layout persistence failures; the editor can still use defaults.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()

  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.getAttribute("role") === "textbox"
  )
}

function showUnsupportedMediaToast(files: File[]) {
  const firstFile = files[0]
  const title =
    files.length === 1 ? "Unsupported file" : `${files.length} unsupported files`
  const description =
    files.length === 1 && firstFile
      ? `${firstFile.name} is not a supported video or audio file. Supported: ${SUPPORTED_MEDIA_EXTENSIONS}.`
      : `Supported: ${SUPPORTED_MEDIA_EXTENSIONS}.`

  toast.warning(title, {
    id: "unsupported-media-file",
    description,
    duration: 5000,
  })
}

function getPersistedFileBlob(file: File) {
  if (file.size > MAX_PERSISTED_FILE_BLOB_BYTES) {
    return undefined
  }

  return file
}

function getReconnectWarnings(
  asset: SourceAsset,
  file: File,
  metadata: MediaMetadata
) {
  const warnings: string[] = []

  if (file.name !== asset.name) {
    warnings.push(`File name changed from ${asset.name} to ${file.name}.`)
  }

  if (file.size !== asset.sizeBytes) {
    warnings.push(
      `File size changed from ${formatBytes(asset.sizeBytes)} to ${formatBytes(
        file.size
      )}.`
    )
  }

  if (
    asset.durationSeconds !== undefined &&
    metadata.durationSeconds !== undefined &&
    Math.abs(asset.durationSeconds - metadata.durationSeconds) > 0.5
  ) {
    warnings.push(
      `Duration changed from ${formatDuration(
        asset.durationSeconds
      )} to ${formatDuration(metadata.durationSeconds)}.`
    )
  }

  if (
    asset.width !== undefined &&
    asset.height !== undefined &&
    metadata.width !== undefined &&
    metadata.height !== undefined &&
    (asset.width !== metadata.width || asset.height !== metadata.height)
  ) {
    warnings.push(
      `Resolution changed from ${asset.width}x${asset.height} to ${metadata.width}x${metadata.height}.`
    )
  }

  return warnings
}

function publishLocalFileDebug(
  phase: string,
  project: Project,
  restore?: LocalFileDebugRestore
) {
  if (typeof window === "undefined") {
    return
  }

  window.__LOCAL_VIDEO_EDITOR_FILE_DEBUG__ = {
    phase,
    projectId: project.id,
    projectName: project.name,
    timestamp: new Date().toISOString(),
    sourceAssets: project.sourceAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      sizeBytes: asset.sizeBytes,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      hasFileHandle: Boolean(asset.fileHandle),
      hasFileHandleGetFile: Boolean(asset.fileHandle?.getFile),
      fileHandleName: asset.fileHandle?.name,
      hasFileBlob: Boolean(asset.fileBlob),
      fileBlobSize: asset.fileBlob?.size,
    })),
    restore: restore
      ? {
          restoredCount: restore.restoredCount,
          permissionNeededCount: restore.permissionNeededCount,
          unavailableCount: restore.unavailableCount,
          diagnostics: restore.diagnostics,
        }
      : undefined,
  }
}

function cleanupExportResult(state: ExportUiState) {
  if (state.url) {
    URL.revokeObjectURL(state.url)
  }

  state.cleanup?.().catch(() => undefined)
}

function triggerExportDownload({
  extension,
  projectName,
  url,
}: {
  extension: ExportFormat
  projectName: string
  url: string
}) {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${projectName || "export"}.${extension}`
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function mergeRuntimeAssets(
  current: RuntimeAssetMap,
  next: RuntimeAssetMap
): RuntimeAssetMap {
  for (const [assetId, asset] of Object.entries(next)) {
    const currentAsset = current[assetId]

    if (currentAsset && currentAsset.objectUrl !== asset.objectUrl) {
      URL.revokeObjectURL(currentAsset.objectUrl)
    }
  }

  return {
    ...current,
    ...next,
  }
}

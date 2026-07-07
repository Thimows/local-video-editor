"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  IconChevronLeft as ChevronLeft,
  IconCircleXFilled as VolumeX,
  IconFileDownloadFilled as Download,
  IconFileScissorsFilled as Scissors,
  IconFileUploadFilled as Upload,
  IconFolderOpenFilled as FolderOpen,
  IconInfoCircleFilled as Info,
  IconPlayerPauseFilled as Pause,
  IconPlayerPlayFilled as Play,
  IconPointerFilled as MousePointer2,
  IconVideoFilled as Film,
} from "@tabler/icons-react"
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  CSSProperties,
  DragEvent,
  PointerEvent,
  UIEvent,
} from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { ThemeToggle } from "@/components/theme-toggle"
import { exportProjectToWebM } from "@/lib/editor/export-webm"
import {
  chooseLocalFiles,
  createRuntimeAsset,
  getDroppedLocalFiles,
  getFileKind,
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
import { getProject, saveProject } from "@/lib/editor/db"
import type {
  MusicTrack,
  Project,
  RuntimeAsset,
  RuntimeAssetMap,
  Selection,
  SourceAsset,
  TimelineClip,
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
import { SliderComfortable } from "@workspace/ui/components/ui/slider"
import {
  TabsSubtle,
  TabsSubtleItem,
} from "@workspace/ui/components/ui/tabs-subtle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

const TRACK_HEADER_WIDTH = 40
const RULER_HEIGHT = 28
const TIMELINE_VIEWPORT_HEIGHT = 178
const TIMELINE_PLAYHEAD_LINE_OFFSET_PX = 0.5
const TIMELINE_PLAYHEAD_CAP_OFFSET_PX = 1
const TRACK_HEIGHT = 34
const TRACK_GAP = 5
const TIMELINE_TRACK_TOP = RULER_HEIGHT + 10
const SNAP_THRESHOLD_SECONDS = 1
const MIN_ITEM_DURATION_SECONDS = 0.2
const PREVIEW_PRELOAD_SECONDS = 0.75
const SNAP_OVERLAP_SECONDS = 0.001
const TIMELINE_EPSILON_SECONDS = 1 / 120
const TIMELINE_PRECISION_SECONDS = 1_000
const TIMELINE_HANDLE_MIN_WIDTH = 34
const TIMELINE_DRAG_START_THRESHOLD_PX = 3
const TIMELINE_MIN_ZOOM = 0.4
const TIMELINE_MAX_ZOOM = 80
const MAX_MEDIA_VOLUME = 2
const CARD_CLASS = "rounded-xl bg-card"
const EDITOR_LAYOUT_STORAGE_KEY = "local-video-editor:editor-layout"
const DEFAULT_INSPECTOR_WIDTH = 320
const MIN_INSPECTOR_WIDTH = 240
const MAX_INSPECTOR_WIDTH = 520
const DEFAULT_TIMELINE_PANEL_HEIGHT = 40 + TIMELINE_VIEWPORT_HEIGHT
const MIN_TIMELINE_PANEL_HEIGHT = 160
const MAX_TIMELINE_PANEL_HEIGHT = 420
const RESIZE_GAP_SIZE = 12

type InspectorView = "project" | "selection" | "files"
type PreviewAudioController = {
  source: MediaElementAudioSourceNode
  gain: GainNode
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [status, setStatus] = useState("Loading project")
  const [exportState, setExportState] = useState<{
    progress: number
    message: string
    url?: string
    controller?: AbortController
  }>({ progress: 0, message: "Idle" })
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        (event.code !== "Space" &&
          event.key !== " " &&
          event.key !== "Backspace" &&
          event.key !== "Delete") ||
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

      event.preventDefault()
      setProject((current) => {
        if (!current) {
          return current
        }

        if (selection.type === "clip") {
          return {
            ...current,
            clips: current.clips.filter((clip) => clip.id !== selection.id),
            updatedAt: Date.now(),
          }
        }

        if (selection.type === "music") {
          return {
            ...current,
            musicTracks: current.musicTracks.filter(
              (track) => track.id !== selection.id
            ),
            updatedAt: Date.now(),
          }
        }

        return current
      })
      selectEditorSelection({ type: "project" })
    }

    window.addEventListener("keydown", onKeyDown)

    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectEditorSelection, selection])

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

      setProject(loadedProject)
      setStatus("Project metadata loaded locally")
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
        Object.values(result.runtimeAssets).forEach((asset) =>
          URL.revokeObjectURL(asset.objectUrl)
        )
        return
      }

      if (result.restoredCount > 0) {
        setRuntimeAssets((current) =>
          mergeRuntimeAssets(current, result.runtimeAssets)
        )
      }

      if (result.restoredCount > 0) {
        setStatus(
          `Restored ${result.restoredCount} saved local file handle${
            result.restoredCount === 1 ? "" : "s"
          }`
        )
      } else if (result.permissionNeededCount > 0) {
        setStatus("Saved file handles need permission before preview/export")
      } else if (result.unavailableCount > 0) {
        setStatus("Some files need manual reconnect in this browser")
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
    return () => {
      Object.values(runtimeAssetsRef.current).forEach((asset) =>
        URL.revokeObjectURL(asset.objectUrl)
      )
    }
  }, [])

  useEffect(() => {
    if (!project) {
      return
    }

    const timeout = window.setTimeout(() => {
      saveProject(project).catch((reason) => {
        setStatus(
          reason instanceof Error ? reason.message : "Could not save project"
        )
      })
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

    const importedAssets: SourceAsset[] = []
    const importedClips: TimelineClip[] = []
    const importedTracks: MusicTrack[] = []
    const nextRuntimeAssets: Record<string, RuntimeAsset> = {}
    let nextTimelineStart =
      placement?.timelineStartSeconds ?? getProjectDuration(project)
    let placedTimelineOffset = 0

    for (const file of files) {
      const type = getFileKind(file)

      if (!type) {
        continue
      }

      const metadata = await readMediaMetadata(file, type)
      const asset: SourceAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        type,
        sizeBytes: file.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        createdAt: Date.now(),
        fileHandle: handles[file.name],
        fileBlob: file,
      }
      const sourceEndSeconds = metadata.durationSeconds ?? 5

      importedAssets.push(asset)
      nextRuntimeAssets[asset.id] = createRuntimeAsset(file)

      const timelineItems = [
        ...project.clips,
        ...project.musicTracks,
        ...importedClips,
        ...importedTracks,
      ]
      const desiredStart = placement
        ? placement.timelineStartSeconds + placedTimelineOffset
        : nextTimelineStart
      const desiredTrackIndex = placement
        ? findNearestAvailableTrackIndex(
            timelineItems,
            placement.trackIndex,
            desiredStart,
            sourceEndSeconds
          )
        : findAvailableTrackIndex(timelineItems, desiredStart, sourceEndSeconds)
      const timelineStartSeconds = findNearestNonOverlappingStart(
        snapTimelineStart(desiredStart, sourceEndSeconds, timelineItems),
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
      setStatus("No supported local media files were selected")
      return
    }

    const nextProject = {
      ...project,
      sourceAssets: [...project.sourceAssets, ...importedAssets],
      clips: [...project.clips, ...importedClips],
      musicTracks: [...project.musicTracks, ...importedTracks],
      updatedAt: Date.now(),
    }

    setRuntimeAssets((current) =>
      mergeRuntimeAssets(current, nextRuntimeAssets)
    )
    setProject(nextProject)
    await saveProject(nextProject)
    const savedProject = await getProject(nextProject.id)
    const savedHandleCount =
      savedProject?.sourceAssets.filter((asset) => asset.fileHandle?.getFile)
        .length ?? 0
    setStatus(
      `Imported ${importedAssets.length} local file${
        importedAssets.length === 1 ? "" : "s"
      }${
        importedAssets.every((asset) => asset.fileHandle)
          ? ` with persistent handles (${savedHandleCount} saved)`
          : ". Files were stored in this browser for reload restore"
      }`
    )
  }

  async function importWithPicker() {
    if (!("showOpenFilePicker" in window)) {
      setStatus(
        "This browser import path cannot persist file access after refresh"
      )
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

  function updateClip(id: string, patch: Partial<TimelineClip>) {
    if (!project) {
      return
    }

    setProject({
      ...project,
      clips: project.clips.map((clip) =>
        clip.id === id
          ? constrainTimelineItemPatch(
              clip,
              [...project.clips, ...project.musicTracks],
              patch
            )
          : clip
      ),
      updatedAt: Date.now(),
    })
  }

  function updateMusic(id: string, patch: Partial<MusicTrack>) {
    if (!project) {
      return
    }

    setProject({
      ...project,
      musicTracks: project.musicTracks.map((track) =>
        track.id === id
          ? constrainTimelineItemPatch(
              track,
              [...project.clips, ...project.musicTracks],
              patch
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
      setStatus("Move the playhead inside the selected clip before splitting")
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
    setStatus("Clip split locally")
  }

  async function reconnectAsset(
    assetId: string,
    file: File,
    fileHandle?: FileSystemFileHandle
  ) {
    if (!project) {
      return
    }

    const asset = project.sourceAssets.find((item) => item.id === assetId)

    if (!asset) {
      return
    }

    if (file.name !== asset.name) {
      setStatus(`Expected ${asset.name}, got ${file.name}`)
      return
    }

    setRuntimeAssets((current) =>
      mergeRuntimeAssets(current, { [assetId]: createRuntimeAsset(file) })
    )
    const nextProject = {
      ...project,
      sourceAssets: project.sourceAssets.map((item) =>
        item.id === assetId
          ? {
              ...item,
              fileHandle: fileHandle ?? item.fileHandle,
              fileBlob: file,
            }
          : item
      ),
      updatedAt: Date.now(),
    }

    setProject(nextProject)
    await saveProject(nextProject)
    const savedProject = await getProject(nextProject.id)
    const savedAsset = savedProject?.sourceAssets.find(
      (item) => item.id === assetId
    )
    setStatus(
      `Reconnected ${asset.name}${
        fileHandle
          ? savedAsset?.fileHandle?.getFile
            ? " with persistent access saved"
            : " but the handle was not stored by this browser"
          : " for this session"
      }`
    )
  }

  async function restoreSavedAccess() {
    if (!project) {
      return
    }

    const result = await restoreProjectFileHandles(project, true)

    if (result.restoredCount > 0) {
      setRuntimeAssets((current) =>
        mergeRuntimeAssets(current, result.runtimeAssets)
      )
    } else {
      Object.values(result.runtimeAssets).forEach((asset) =>
        URL.revokeObjectURL(asset.objectUrl)
      )
    }

    if (result.restoredCount > 0) {
      setStatus(
        `Restored ${result.restoredCount} local file${
          result.restoredCount === 1 ? "" : "s"
        }`
      )
    } else if (result.permissionNeededCount > 0) {
      setStatus("File access was not granted")
    } else {
      setStatus("No saved file handles could be restored")
    }
  }

  async function runExport() {
    if (!project) {
      return
    }

    if (exportState.url) {
      URL.revokeObjectURL(exportState.url)
    }

    const controller = new AbortController()
    setExportState({
      progress: 0,
      message: "Preparing local export",
      controller,
    })

    try {
      const blob = await exportProjectToWebM({
        project,
        runtimeAssets,
        signal: controller.signal,
        onProgress: ({ progress, message }) =>
          setExportState((current) => ({ ...current, progress, message })),
      })
      const url = URL.createObjectURL(blob)
      setExportState({ progress: 1, message: "WebM export ready", url })
    } catch (reason) {
      setExportState({
        progress: 0,
        message: reason instanceof Error ? reason.message : "Export failed",
      })
    }
  }

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
        <div className="flex min-w-0 items-center gap-2">
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
              className="h-7 border-transparent px-1 text-sm font-medium shadow-none select-text"
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
          <Button variant="outline" size="sm" onClick={importWithPicker}>
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <ExportDialog
            project={project}
            exportState={exportState}
            onExport={runExport}
            onCancelExport={() => exportState.controller?.abort()}
          />
          <ThemeToggle size="icon-sm" />
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
            status={status}
            onClipChange={updateClip}
            onMusicChange={updateMusic}
            onReconnect={reconnectAsset}
            onRestoreSavedAccess={restoreSavedAccess}
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
            project={project}
            runtimeAssets={runtimeAssets}
            playheadSeconds={playheadSeconds}
            isPlaying={isPlaying}
            onPlayChange={setIsPlaying}
            onPlayheadChange={setPlayheadSeconds}
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
          onClipChange={updateClip}
          onMusicChange={updateMusic}
          onZoomChange={setTimelineZoom}
          onSplit={splitSelectedClip}
          canSplit={Boolean(selectedClip)}
          onDropFiles={importTimelineDrop}
        />
      </section>
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
  status,
  onClipChange,
  onMusicChange,
  onReconnect,
  onRestoreSavedAccess,
}: {
  view: InspectorView
  onViewChange: (view: InspectorView) => void
  project: Project
  selectedAsset: SourceAsset | null
  selectedClip: TimelineClip | null
  selectedMusic: MusicTrack | null
  missingAssets: SourceAsset[]
  status: string
  onClipChange: (id: string, patch: Partial<TimelineClip>) => void
  onMusicChange: (id: string, patch: Partial<MusicTrack>) => void
  onReconnect: (
    assetId: string,
    file: File,
    fileHandle?: FileSystemFileHandle
  ) => void
  onRestoreSavedAccess: () => void
}) {
  const duration = getProjectDuration(project)
  const missingSavedHandles = missingAssets.filter((asset) => asset.fileHandle)
  const missingAssetIds = new Set(missingAssets.map((asset) => asset.id))
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
          ? `${selectedAsset.type} · ${formatBytes(selectedAsset.sizeBytes)}`
          : "Timeline item properties."
        : "Edit decisions are stored locally. Media files are referenced from disk."
  const fileList =
    project.sourceAssets.length > 0 ? project.sourceAssets : missingAssets
  const canRestoreSavedAccess = missingSavedHandles.length > 0

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
        {canRestoreSavedAccess ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={onRestoreSavedAccess}
          >
            <FolderOpen data-icon="inline-start" />
            Restore saved access
          </Button>
        ) : null}

        {fileList.length === 0 ? (
          <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            Import video or audio files to start building a timeline.
          </p>
        ) : (
          <div className="space-y-2">
            {fileList.map((asset) => (
              <ReconnectButton
                key={asset.id}
                asset={asset}
                connected={!missingAssetIds.has(asset.id)}
                onReconnect={onReconnect}
              />
            ))}
          </div>
        )}

        <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
          {status}
        </p>
      </div>
    ) : (
      <div className="grid gap-3 text-sm">
        <Metric label="Duration" value={formatDuration(duration)} />
        <Metric label="Clips" value={String(project.clips.length)} />
        <Metric label="Audio" value={String(project.musicTracks.length)} />
        <Metric label="Files" value={String(project.sourceAssets.length)} />
        <Metric
          label="Export"
          value={`${project.exportSettings.width}x${project.exportSettings.height} WebM`}
        />
      </div>
    )

  return (
    <aside className={`flex min-h-0 flex-col overflow-visible ${CARD_CLASS}`}>
      <InspectorViewNav view={view} onViewChange={onViewChange} />
      <div className="min-h-0 overflow-y-auto p-3">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h2 className="truncate text-base leading-5 font-semibold">
              {heading}
            </h2>
            <p className="text-xs leading-5 text-pretty text-muted-foreground">
              {description}
            </p>
          </div>

          {body}
        </div>
      </div>
    </aside>
  )
}

function InspectorViewNav({
  view,
  onViewChange,
}: {
  view: InspectorView
  onViewChange: (view: InspectorView) => void
}) {
  const tabs: Array<{
    view: InspectorView
    label: string
    icon: typeof Info
  }> = [
    { view: "project", label: "Project details", icon: Info },
    { view: "selection", label: "Selected item", icon: MousePointer2 },
    { view: "files", label: "Files", icon: FolderOpen },
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

function ExportDialog({
  project,
  exportState,
  onExport,
  onCancelExport,
}: {
  project: Project
  exportState: {
    progress: number
    message: string
    url?: string
    controller?: AbortController
  }
  onExport: () => void
  onCancelExport: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Download data-icon="inline-start" />
            Export
          </Button>
        }
      />
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Render this project locally as a WebM file using the saved export
            settings.
          </DialogDescription>
        </div>

        <div className="grid gap-3 rounded-lg bg-muted/55 p-3 text-sm">
          <Metric
            label="Size"
            value={`${project.exportSettings.width}x${project.exportSettings.height}`}
          />
          <Metric label="Format" value={project.exportSettings.format} />
          <Metric
            label="Frame rate"
            value={`${project.exportSettings.fps} fps`}
          />
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
            <Button
              nativeButton={false}
              render={
                <a
                  href={exportState.url}
                  download={`${project.name || "export"}.webm`}
                />
              }
            >
              <Download data-icon="inline-start" />
              Download
            </Button>
          ) : (
            <Button type="button" onClick={onExport}>
              <Download data-icon="inline-start" />
              Export WebM
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ReconnectButton({
  asset,
  onReconnect,
  connected,
}: {
  asset: SourceAsset
  connected?: boolean
  onReconnect: (
    assetId: string,
    file: File,
    fileHandle?: FileSystemFileHandle
  ) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function reconnectWithPersistentPicker() {
    const accept = asset.type === "video" ? "video" : "audio"
    const selected = await chooseLocalFiles(accept).catch(() => [])
    const match =
      selected.find((item) => item.file.name === asset.name) ?? selected[0]

    if (match) {
      onReconnect(asset.id, match.file, match.fileHandle)
      return
    }

    inputRef.current?.click()
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(asset.sizeBytes)} ·{" "}
          {asset.fileHandle
            ? "persistent handle saved"
            : asset.fileBlob
              ? "stored in browser"
              : "temporary file only"}{" "}
          · {connected ? "connected" : "missing"}
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
            onReconnect(asset.id, file)
          }
        }}
      />
      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => {
          if ("showOpenFilePicker" in window) {
            reconnectWithPersistentPicker()
          } else {
            inputRef.current?.click()
          }
        }}
        aria-label={`Reconnect ${asset.name}`}
      >
        <FolderOpen />
      </Button>
    </div>
  )
}

function PreviewStage({
  project,
  runtimeAssets,
  playheadSeconds,
  isPlaying,
  onPlayChange,
  onPlayheadChange,
}: {
  project: Project
  runtimeAssets: RuntimeAssetMap
  playheadSeconds: number
  isPlaying: boolean
  onPlayChange: (isPlaying: boolean) => void
  onPlayheadChange: (seconds: number) => void
}) {
  const playheadRef = useRef(playheadSeconds)
  const previewAudioContextRef = useRef<AudioContext | null>(null)
  const [previewAudioContext, setPreviewAudioContext] =
    useState<AudioContext | null>(null)
  const playbackClockRef = useRef<{
    playheadSeconds: number
    startedAt: number
  } | null>(null)
  const generatedPlayheadRef = useRef<number | null>(null)
  const [previewIssues, setPreviewIssues] = useState<Record<string, string>>({})
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

  useEffect(
    () => () => {
      previewAudioContextRef.current?.close().catch(() => undefined)
      previewAudioContextRef.current = null
    },
    []
  )

  useEffect(() => {
    playheadRef.current = playheadSeconds

    if (!isPlaying) {
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
  }, [isPlaying, playheadSeconds])

  useEffect(() => {
    if (isPlaying) {
      previewAudioContext?.resume().catch(() => undefined)
    }
  }, [isPlaying, previewAudioContext])

  useEffect(() => {
    if (!isPlaying) {
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
  }, [isPlaying, onPlayChange, onPlayheadChange, projectDuration])

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

  function getPreviewAudioContext() {
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
  }

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
        <div className="[container-type:size] relative h-full min-h-0 w-full overflow-hidden bg-card">
          {previewClips.map((clip) => {
            const runtimeAsset = runtimeAssets[clip.sourceAssetId]
            const asset = project.sourceAssets.find(
              (item) => item.id === clip.sourceAssetId
            )

            if (!runtimeAsset) {
              return null
            }

            return (
              <PreviewVideoLayer
                key={clip.id}
                clip={clip}
                asset={asset}
                runtimeAsset={runtimeAsset}
                playheadSeconds={playheadSeconds}
                isPlaying={isPlaying}
                isActive={activeClipIds.has(clip.id)}
                audioContext={previewAudioContext}
                onIssue={(issue) => setPreviewIssue(clip.id, issue)}
              />
            )
          })}
          {hasActiveVideo ? null : (
            <div className="absolute inset-0 grid place-items-center bg-card text-center text-sm text-muted-foreground">
              <div className="space-y-2">
                <Film className="mx-auto size-10" />
                <p>
                  {hasPlayableMedia
                    ? "No video at the playhead."
                    : "Import or reconnect local media to preview."}
                </p>
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
                audioContext={previewAudioContext}
              />
            )
          })}
        </div>
      </div>
      <div className="flex items-center px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasPlayableMedia}
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <span className="font-mono text-sm text-muted-foreground">
            {formatDuration(playheadSeconds)} /{" "}
            {formatDuration(projectDuration)}
          </span>
        </div>
      </div>
    </section>
  )
}

function PreviewVideoLayer({
  clip,
  asset,
  runtimeAsset,
  playheadSeconds,
  isPlaying,
  isActive,
  audioContext,
  onIssue,
}: {
  clip: TimelineClip
  asset?: SourceAsset
  runtimeAsset: RuntimeAsset
  playheadSeconds: number
  isPlaying: boolean
  isActive: boolean
  audioContext: AudioContext | null
  onIssue: (issue: string | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const audioControllerRef = useRef<PreviewAudioController | null>(null)
  const [isFrameReady, setIsFrameReady] = useState(false)
  const aspectRatio =
    asset?.width && asset.height ? asset.width / asset.height : 16 / 9

  useEffect(
    () => () => {
      disconnectPreviewAudio(audioControllerRef)
    },
    []
  )

  useEffect(() => {
    const player = videoRef.current

    if (!player) {
      return
    }

    const sourceChanged = activeObjectUrlRef.current !== runtimeAsset.objectUrl
    const targetTime = getSourceTimeForTimelineItem(clip, playheadSeconds)
    const shouldPlay = isPlaying && isActive
    const shouldSeek =
      sourceChanged ||
      !shouldPlay ||
      Math.abs(player.currentTime - targetTime) > 0.25

    setPreviewMediaVolume({
      player,
      audioContext,
      audioControllerRef,
      volume: clip.volume,
      muted: clip.muted || !isActive,
    })

    if (shouldPlay && !shouldSeek) {
      setIsFrameReady(true)

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
        player.src = runtimeAsset.objectUrl
        activeObjectUrlRef.current = runtimeAsset.objectUrl
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
        await waitForMediaSeek(player)
      }

      if (cancelled) {
        return
      }

      onIssue(
        player.videoWidth === 0 || player.videoHeight === 0
          ? "A stacked video can play audio, but this browser is not exposing a decodable video track for it."
          : null
      )
      setIsFrameReady(true)

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
    clip,
    audioContext,
    isActive,
    isPlaying,
    onIssue,
    playheadSeconds,
    runtimeAsset.objectUrl,
  ])

  return (
    <video
      ref={videoRef}
      className={[
        "absolute inset-0 m-auto block rounded-lg bg-card object-fill transition-opacity duration-75",
        isActive && isFrameReady ? "opacity-100" : "opacity-0",
      ].join(" ")}
      style={{
        aspectRatio: String(aspectRatio),
        height: `min(100%, calc(100cqw / ${aspectRatio}))`,
        width: `min(100%, calc(100cqh * ${aspectRatio}))`,
        zIndex: getPreviewLayerZIndex(clip),
      }}
      playsInline
      preload="auto"
      onError={() =>
        onIssue("This browser could not decode one of the active video files.")
      }
      onLoadedMetadata={(event) => {
        const video = event.currentTarget
        onIssue(
          video.videoWidth === 0 || video.videoHeight === 0
            ? "A stacked video can play audio, but this browser is not exposing a decodable video track for it."
            : null
        )
      }}
    />
  )
}

function PreviewAudioLayer({
  track,
  runtimeAsset,
  playheadSeconds,
  isPlaying,
  audioContext,
}: {
  track: MusicTrack
  runtimeAsset: RuntimeAsset
  playheadSeconds: number
  isPlaying: boolean
  audioContext: AudioContext | null
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const audioControllerRef = useRef<PreviewAudioController | null>(null)

  useEffect(
    () => () => {
      disconnectPreviewAudio(audioControllerRef)
    },
    []
  )

  useEffect(() => {
    const player = audioRef.current

    if (!player) {
      return
    }

    const sourceChanged = activeObjectUrlRef.current !== runtimeAsset.objectUrl
    const targetTime = getSourceTimeForTimelineItem(track, playheadSeconds)
    const shouldSeek =
      sourceChanged ||
      !isPlaying ||
      Math.abs(player.currentTime - targetTime) > 0.25

    setPreviewMediaVolume({
      player,
      audioContext,
      audioControllerRef,
      volume: track.volume,
      muted: false,
    })

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
  }, [audioContext, isPlaying, playheadSeconds, runtimeAsset.objectUrl, track])

  return <audio ref={audioRef} preload="auto" />
}

function setPreviewMediaVolume({
  player,
  audioContext,
  audioControllerRef,
  volume,
  muted,
}: {
  player: HTMLMediaElement
  audioContext: AudioContext | null
  audioControllerRef: { current: PreviewAudioController | null }
  volume: number
  muted: boolean
}) {
  const gainValue = muted ? 0 : getMediaVolumeMultiplier(volume)

  if (!audioContext) {
    player.muted = muted
    player.volume = Math.min(1, gainValue)
    return
  }

  try {
    audioControllerRef.current ??= createPreviewAudioController(
      audioContext,
      player
    )
    player.muted = false
    player.volume = 1
    setPreviewGain(audioControllerRef.current.gain, audioContext, gainValue)
  } catch {
    player.muted = muted
    player.volume = Math.min(1, gainValue)
  }
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

function disconnectPreviewAudio(controllerRef: {
  current: PreviewAudioController | null
}) {
  const controller = controllerRef.current

  controllerRef.current = null
  controller?.source.disconnect()
  controller?.gain.disconnect()
}

function getMediaVolumeMultiplier(volume: number) {
  return clamp(volume, 0, MAX_MEDIA_VOLUME)
}

function createPreviewAudioContext() {
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
  onClipChange,
  onMusicChange,
  onZoomChange,
  onSplit,
  canSplit,
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
  onClipChange: (id: string, patch: Partial<TimelineClip>) => void
  onMusicChange: (id: string, patch: Partial<MusicTrack>) => void
  onZoomChange: (zoom: number) => void
  onSplit: () => void
  canSplit: boolean
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
  const trackCount = Math.max(4, getTrackCount(timelineItems))
  const timelineHeight =
    TIMELINE_TRACK_TOP + trackCount * (TRACK_HEIGHT + TRACK_GAP) + 12
  const timelineContentHeight = Math.max(timelineHeight, viewportHeight)
  const tickInterval = getTimeTickInterval(zoom)
  const ticks = useMemo(() => {
    const count = Math.ceil(duration / tickInterval) + 1

    return Array.from({ length: count }, (_, index) => index * tickInterval)
  }, [duration, tickInterval])
  const timelineRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const durationRef = useRef(duration)
  const playheadSecondsRef = useRef(playheadSeconds)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  const [hoverSeconds, setHoverSeconds] = useState<number | null>(null)
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(
    null
  )
  const snapItems = timelineItems

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

  function setTimelineScrollPosition(nextScrollLeft: number) {
    const normalizedScrollLeft = Math.max(0, nextScrollLeft)

    setTimelineScrollLeft((currentScrollLeft) =>
      Math.abs(currentScrollLeft - normalizedScrollLeft) < 0.5
        ? currentScrollLeft
        : normalizedScrollLeft
    )
  }

  function syncTimelineScrollVariable(scrollContainer: HTMLElement) {
    scrollContainer.style.setProperty(
      "--timeline-scroll-left",
      `${Math.max(0, scrollContainer.scrollLeft)}px`
    )
  }

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
          currentDuration
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
          secondsAtCursor * roundedZoom - cursorX
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
    const nextScrollLeft = Math.max(0, anchorSeconds * clampedZoom - anchorX)

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
      duration
    )
  }

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    onSelect({ type: "project" })
    onPlayheadChange(getSecondsFromPointer(event))
  }

  function updateHover(event: PointerEvent<HTMLDivElement>) {
    setHoverSeconds(getSecondsFromPointer(event))
  }

  function updateTimelineScroll(event: UIEvent<HTMLDivElement>) {
    syncTimelineScrollVariable(event.currentTarget)
    setTimelineScrollPosition(event.currentTarget.scrollLeft)
  }

  function updateDropPreview(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setDropPreview(getTimelineDropPreview(event, zoom, duration))
  }

  async function dropFilesOnTimeline(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const preview = dropPreview ?? getTimelineDropPreview(event, zoom, duration)
    const dropped = await getDroppedLocalFiles(event.dataTransfer)

    setDropPreview(null)

    if (dropped.length > 0) {
      onDropFiles(dropped, preview.placement)
    }
  }

  return (
    <section className={`min-h-0 max-w-full min-w-0 ${CARD_CLASS}`}>
      <div className="flex h-10 min-w-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">
            Drag clips to move, drag edges to trim, click the ruler to scrub.
          </span>
        </div>
        <div className="flex w-64 shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Split clip"
                  onClick={onSplit}
                  disabled={!canSplit}
                />
              }
            >
              <Scissors />
            </TooltipTrigger>
            <TooltipContent>Split selected clip</TooltipContent>
          </Tooltip>
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
        className="grid min-w-0 overflow-y-auto"
        style={{
          height: viewportHeight,
          gridTemplateColumns: `${TRACK_HEADER_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        <div className="relative" style={{ minHeight: timelineContentHeight }}>
          <div style={{ height: RULER_HEIGHT }} />
          {Array.from({ length: trackCount }, (_, index) => (
            <TrackLabel
              key={`track-${index}`}
              label={String(index + 1)}
              top={getTimelineTrackTop(index)}
            />
          ))}
        </div>
        <div
          className="relative min-w-0"
          style={{ minHeight: timelineContentHeight }}
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
                  className="absolute top-0 h-full border-l px-1 pt-1 font-mono text-[10px] text-muted-foreground"
                  style={{ left: seconds * zoom - timelineScrollLeft }}
                >
                  {formatDuration(seconds)}
                </div>
              ))}
            </div>
            {hoverSeconds === null ? null : (
              <div
                className="absolute top-0 bottom-0 z-[61] w-px bg-primary/35"
                style={{ left: hoverSeconds * zoom - timelineScrollLeft }}
              />
            )}
            <div
              className="absolute top-0 bottom-0 z-[62] w-px bg-primary"
              style={{
                left:
                  playheadSeconds * zoom -
                  timelineScrollLeft +
                  TIMELINE_PLAYHEAD_LINE_OFFSET_PX,
              }}
            />
            <div
              className="absolute top-1 z-[63] size-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-primary"
              style={{
                left:
                  playheadSeconds * zoom -
                  timelineScrollLeft +
                  TIMELINE_PLAYHEAD_CAP_OFFSET_PX,
              }}
            />
          </div>
          <div
            ref={timelineRef}
            data-timeline-drop-zone="true"
            className="absolute inset-0 h-full w-full max-w-full min-w-0 [touch-action:pan-x] overflow-x-auto overflow-y-hidden overscroll-x-contain"
            style={{
              contain: "layout paint",
              minHeight: timelineContentHeight,
              scrollbarGutter: "stable",
              "--timeline-scroll-left": "0px",
            } as CSSProperties}
            onPointerDown={seekFromPointer}
            onPointerMove={updateHover}
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
                minWidth: width,
                width,
              }}
            >
              {ticks.map((seconds) => (
                <div
                  key={`grid-${seconds}`}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/70"
                  style={{ left: seconds * zoom }}
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
                const trackIndex = getTrackIndex(clip)

                return (
                  <TimelineItem
                    key={clip.id}
                    top={getTimelineTrackTop(trackIndex)}
                    left={clip.timelineStartSeconds * zoom}
                    width={getClipDuration(clip) * zoom}
                    selected={
                      selection.type === "clip" && selection.id === clip.id
                    }
                    label={asset?.name ?? "Missing video"}
                    muted={clip.muted}
                    connected={connected}
                    onSelect={() => onSelect({ type: "clip", id: clip.id })}
                    onDragPreview={(mode, deltaSeconds, deltaTracks) =>
                      getTimelineItemDragPreview(
                        clip,
                        timelineItems,
                        snapItems,
                        mode,
                        deltaSeconds,
                        deltaTracks,
                        zoom,
                        getTimelineTrackTop
                      )
                    }
                    onDragCommit={(preview) =>
                      onClipChange(
                        clip.id,
                        preview.patch as Partial<TimelineClip>
                      )
                    }
                    zoom={zoom}
                  />
                )
              })}
              {project.musicTracks.map((track) => {
                const asset = project.sourceAssets.find(
                  (item) => item.id === track.sourceAssetId
                )
                const connected = Boolean(runtimeAssets[track.sourceAssetId])
                const trackIndex = getTrackIndex(track)

                return (
                  <TimelineItem
                    key={track.id}
                    top={getTimelineTrackTop(trackIndex)}
                    left={track.timelineStartSeconds * zoom}
                    width={getClipDuration(track) * zoom}
                    selected={
                      selection.type === "music" && selection.id === track.id
                    }
                    label={asset?.name ?? "Missing audio"}
                    muted={false}
                    connected={connected}
                    onSelect={() => onSelect({ type: "music", id: track.id })}
                    onDragPreview={(mode, deltaSeconds, deltaTracks) =>
                      getTimelineItemDragPreview(
                        track,
                        timelineItems,
                        snapItems,
                        mode,
                        deltaSeconds,
                        deltaTracks,
                        zoom,
                        getTimelineTrackTop
                      )
                    }
                    onDragCommit={(preview) =>
                      onMusicChange(
                        track.id,
                        preview.patch as Partial<MusicTrack>
                      )
                    }
                    zoom={zoom}
                  />
                )
              })}
            </div>
          </div>
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
  connected,
  zoom,
  onSelect,
  onDragPreview,
  onDragCommit,
}: {
  top: number
  left: number
  width: number
  selected: boolean
  label: string
  muted: boolean
  connected: boolean
  zoom: number
  onSelect: () => void
  onDragPreview: (
    mode: TimelineDragMode,
    deltaSeconds: number,
    deltaTracks: number
  ) => TimelineItemDragPreview
  onDragCommit: (preview: TimelineItemDragPreview) => void
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
  const labelViewportWidth = Math.max(
    0,
    stylePreview.width - leadingInset - trailingInset
  )
  const maxLabelOffset = Math.max(0, labelViewportWidth - 24)
  const handleClassName = [
    "absolute top-1/2 z-10 h-5 w-1 -translate-y-1/2 cursor-ew-resize rounded-full",
    selected ? "bg-primary-foreground/80" : "bg-foreground/25",
  ].join(" ")

  function startDrag(
    event: PointerEvent<HTMLDivElement>,
    mode: TimelineDragMode
  ) {
    event.stopPropagation()
    onSelect()
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
  }

  function resetDrag() {
    previewRef.current = null
    dragRef.current = null
    setPreview(null)
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
      {showHandles ? (
        <div
          className={`${handleClassName} left-1`}
          onPointerDown={(event) => startDrag(event, "start")}
        />
      ) : null}
      <div
        className="pointer-events-none absolute top-0 bottom-0 overflow-hidden"
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
          title={label}
        >
          <span className="block min-w-0 truncate">{label}</span>
        </span>
      </div>
      {muted ? (
        <VolumeX className="absolute top-1/2 right-2 size-3 -translate-y-1/2" />
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

function TrackLabel({ label, top }: { label: string; top: number }) {
  return (
    <div
      className="absolute inset-x-0 z-20 grid h-5 place-items-center text-[10px] font-medium text-muted-foreground"
      style={{ top: top + (TRACK_HEIGHT - 20) / 2 }}
      aria-label={label}
      title={label}
    >
      {label}
    </div>
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
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <SliderComfortable
        value={value}
        min={0}
        max={max}
        step={step}
        variant="scrubber"
        label={label}
        formatValue={(nextValue) => `${Math.round(nextValue * 100)}%`}
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
    <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
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
type TimelineDroppedFile = {
  file: File
  fileHandle?: FileSystemFileHandle
}
type TimelineDropPlacement = {
  timelineStartSeconds: number
  trackIndex: number
}
type TimelineDropPreview = {
  top: number
  left: number
  width: number
  placement: TimelineDropPlacement
}
type TimelineItemDragPreview = {
  top: number
  left: number
  width: number
  patch: Partial<TimelineItemData>
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

function getTimelineTrackTop(trackIndex: number) {
  return TIMELINE_TRACK_TOP + trackIndex * (TRACK_HEIGHT + TRACK_GAP)
}

function getTimelineDropPreview(
  event: DragEvent<HTMLDivElement>,
  zoom: number,
  duration: number
): TimelineDropPreview {
  const container = event.currentTarget
  const rect = container.getBoundingClientRect()
  const y = event.clientY - rect.top
  const timelineStartSeconds = getTimelineSeconds(
    container,
    event.clientX,
    zoom,
    duration
  )
  const trackIndex = Math.max(
    0,
    Math.round((y - TIMELINE_TRACK_TOP) / (TRACK_HEIGHT + TRACK_GAP))
  )

  return {
    top: getTimelineTrackTop(trackIndex),
    left: timelineStartSeconds * zoom,
    width: Math.max(72, 5 * zoom),
    placement: {
      timelineStartSeconds,
      trackIndex,
    },
  }
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

function getTimelineItemDragPreview<T extends TimelineItemData>(
  item: T,
  laneItems: TimelineItemData[],
  snapItems: TimelineItemData[],
  mode: TimelineDragMode,
  deltaSeconds: number,
  deltaTracks: number,
  zoom: number,
  getTop: (trackIndex: number) => number
): TimelineItemDragPreview {
  const patch = getTimelineDragPatch(item, mode, deltaSeconds, deltaTracks)
  const next = constrainTimelineItemPatch(item, laneItems, patch, snapItems)

  return {
    top: getTop(getTrackIndex(next)),
    left: next.timelineStartSeconds * zoom,
    width: getClipDuration(next) * zoom,
    patch: getTimelineCommitPatch(next, mode),
  }
}

function getTimelineDragPatch<T extends TimelineItemData>(
  item: T,
  mode: TimelineDragMode,
  deltaSeconds: number,
  deltaTracks: number
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
    return {
      sourceStartSeconds: Math.min(
        item.sourceStartSeconds + deltaSeconds,
        item.sourceEndSeconds - MIN_ITEM_DURATION_SECONDS
      ),
      timelineStartSeconds: Math.max(
        0,
        item.timelineStartSeconds + deltaSeconds
      ),
    } as Partial<T>
  }

  return {
    sourceEndSeconds: Math.max(
      item.sourceStartSeconds + MIN_ITEM_DURATION_SECONDS,
      item.sourceEndSeconds + deltaSeconds
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
  snapItems: TimelineItemData[] = items
): T {
  const next = {
    ...item,
    ...patch,
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
    const snappedStart = snapTimelineStart(
      Math.max(0, next.timelineStartSeconds),
      duration,
      snapItems.filter((candidate) => candidate.id !== item.id)
    )

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
    const desiredStart = snapPoint(Math.max(0, next.timelineStartSeconds), [
      0,
      ...snapItems
        .filter((candidate) => candidate.id !== item.id)
        .flatMap((snapItem) => [
          snapItem.timelineStartSeconds,
          snapItem.timelineStartSeconds + getClipDuration(snapItem),
        ]),
    ])
    const clampedStart = clamp(
      desiredStart,
      getPreviousItemEnd(laneItems, fixedEnd),
      Math.min(fixedEnd - MIN_ITEM_DURATION_SECONDS, maxEnd)
    )
    const normalizedStart = normalizeTimelineSeconds(clampedStart)
    const duration = fixedEnd - normalizedStart

    return {
      ...next,
      timelineStartSeconds: normalizedStart,
      sourceStartSeconds: next.sourceEndSeconds - duration,
    }
  }

  if (isTrimEnd) {
    const start = next.timelineStartSeconds
    const maxEnd = getNextItemStart(laneItems, start) ?? Infinity
    const desiredEnd = snapPoint(start + getClipDuration(next), [
      ...snapItems
        .filter((candidate) => candidate.id !== item.id)
        .flatMap((snapItem) => [
          snapItem.timelineStartSeconds,
          snapItem.timelineStartSeconds + getClipDuration(snapItem),
        ]),
    ])
    const clampedEnd = clamp(
      desiredEnd,
      start + MIN_ITEM_DURATION_SECONDS,
      maxEnd
    )

    return {
      ...next,
      sourceEndSeconds:
        next.sourceStartSeconds + normalizeTimelineSeconds(clampedEnd - start),
    }
  }

  return next
}

function snapTimelineStart(
  startSeconds: number,
  durationSeconds: number,
  laneItems: TimelineItemData[]
) {
  const endSeconds = startSeconds + durationSeconds
  const points = [
    0,
    ...laneItems.flatMap((item) => [
      item.timelineStartSeconds,
      item.timelineStartSeconds + getClipDuration(item),
    ]),
  ]
  const snappedStart = snapPoint(startSeconds, points)

  if (snappedStart !== startSeconds) {
    return normalizeTimelineSeconds(snappedStart)
  }

  const snappedEnd = snapPoint(endSeconds, points)

  return normalizeTimelineSeconds(
    snappedEnd === endSeconds
      ? startSeconds
      : snappedEnd - durationSeconds - SNAP_OVERLAP_SECONDS
  )
}

function snapPoint(value: number, points: number[]) {
  let nearest = value
  let nearestDistance = SNAP_THRESHOLD_SECONDS

  for (const point of points) {
    const distance = Math.abs(value - point)

    if (distance <= nearestDistance) {
      nearest = point
      nearestDistance = distance
    }
  }

  return normalizeTimelineSeconds(Math.max(0, nearest))
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
  item: TimelineItemData,
  playheadSeconds: number
) {
  const itemOffset = clamp(
    playheadSeconds - item.timelineStartSeconds,
    0,
    getClipDuration(item)
  )

  return item.sourceStartSeconds + itemOffset
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

function getTimelineSeconds(
  container: HTMLDivElement,
  clientX: number,
  zoom: number,
  duration: number
) {
  const rect = container.getBoundingClientRect()
  const x = clientX - rect.left + container.scrollLeft

  return clamp(x / zoom, 0, duration)
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

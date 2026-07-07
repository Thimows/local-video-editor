"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Download,
  FileAudio,
  Film,
  FolderOpen,
  Pause,
  Play,
  Scissors,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react"
import type { ChangeEvent, DragEvent, PointerEvent, ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"

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
import { Badge } from "@workspace/ui/components/badge"
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
import { Separator } from "@workspace/ui/components/separator"
import { Slider } from "@workspace/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

const TRACK_HEADER_WIDTH = 56
const RULER_HEIGHT = 28
const TRACK_HEIGHT = 42
const TRACK_GAP = 8
const VIDEO_TRACK_TOP = RULER_HEIGHT + 10
const SNAP_THRESHOLD_SECONDS = 1
const MIN_ITEM_DURATION_SECONDS = 0.2
const PREVIEW_PRELOAD_SECONDS = 0.75
const SNAP_OVERLAP_SECONDS = 0.001
const TIMELINE_EPSILON_SECONDS = 1 / 120
const TIMELINE_PRECISION_SECONDS = 1_000
const CARD_CLASS = "rounded-lg bg-card"

export function EditorClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id
  const [project, setProject] = useState<Project | null>(null)
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetMap>({})
  const [selection, setSelection] = useState<Selection>({ type: "project" })
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
  const runtimeAssetsRef = useRef<RuntimeAssetMap>({})

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        (event.code !== "Space" && event.key !== " ") ||
        isTextEditingTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      setIsPlaying((current) => !current)
    }

    window.addEventListener("keydown", onKeyDown)

    return () => window.removeEventListener("keydown", onKeyDown)
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
    let placedVideoOffset = 0
    let placedAudioOffset = 0

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

      if (type === "video") {
        const desiredStart =
          placement?.kind === "video"
            ? placement.timelineStartSeconds + placedVideoOffset
            : nextTimelineStart
        const trackIndex = findAvailableTrackIndex(
          [...project.clips, ...importedClips],
          desiredStart,
          sourceEndSeconds
        )
        const videoItems = [...project.clips, ...importedClips]
        const desiredTrackIndex =
          placement?.kind === "video"
            ? findNearestAvailableTrackIndex(
                videoItems,
                placement.trackIndex,
                desiredStart,
                sourceEndSeconds
              )
            : trackIndex
        const timelineStartSeconds = findNearestNonOverlappingStart(
          snapTimelineStart(desiredStart, sourceEndSeconds, [
            ...project.clips,
            ...project.musicTracks,
            ...importedClips,
            ...importedTracks,
          ]),
          sourceEndSeconds,
          videoItems.filter((item) => getTrackIndex(item) === desiredTrackIndex)
        )

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
        nextTimelineStart = timelineStartSeconds + sourceEndSeconds
        placedVideoOffset += sourceEndSeconds
      } else {
        const desiredStart =
          placement?.kind === "audio"
            ? placement.timelineStartSeconds + placedAudioOffset
            : 0
        const trackIndex = findAvailableTrackIndex(
          [...project.musicTracks, ...importedTracks],
          desiredStart,
          sourceEndSeconds
        )
        const audioItems = [...project.musicTracks, ...importedTracks]
        const desiredTrackIndex =
          placement?.kind === "audio"
            ? findNearestAvailableTrackIndex(
                audioItems,
                placement.trackIndex,
                desiredStart,
                sourceEndSeconds
              )
            : trackIndex
        const timelineStartSeconds = findNearestNonOverlappingStart(
          snapTimelineStart(desiredStart, sourceEndSeconds, [
            ...project.clips,
            ...project.musicTracks,
            ...importedClips,
            ...importedTracks,
          ]),
          sourceEndSeconds,
          audioItems.filter((item) => getTrackIndex(item) === desiredTrackIndex)
        )

        importedTracks.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          timelineStartSeconds,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          trackIndex: desiredTrackIndex,
          volume: 0.75,
        })
        placedAudioOffset += sourceEndSeconds
      }
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
          ? constrainTimelineItemPatch(clip, project.clips, patch, [
              ...project.clips,
              ...project.musicTracks,
            ])
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
          ? constrainTimelineItemPatch(track, project.musicTracks, patch, [
              ...project.clips,
              ...project.musicTracks,
            ])
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
    setSelection({ type: "clip", id: nextClip.id })
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
      <header className="flex h-14 min-w-0 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            render={<Link href="/projects" />}
            aria-label="Back to projects"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <Input
              className="h-8 border-transparent px-1 text-base font-medium shadow-none select-text"
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
          <Badge variant={missingAssets.length ? "destructive" : "outline"}>
            {missingAssets.length
              ? `${missingAssets.length} missing files`
              : "Files stay local"}
          </Badge>
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
          <Button variant="outline" onClick={importWithPicker}>
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <ExportDialog
            project={project}
            exportState={exportState}
            onExport={runExport}
            onCancelExport={() => exportState.controller?.abort()}
          />
          <ThemeToggle />
        </div>
      </header>

      <section
        className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3 pt-0"
        style={{ gridTemplateRows: "minmax(420px, 1fr) 218px" }}
        onDragOver={allowDrop}
        onDrop={importFromDrop}
      >
        <div
          className="grid min-h-[420px] min-w-0 gap-3 overflow-hidden"
          style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}
        >
          <InspectorPanel
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
          <PreviewStage
            project={project}
            runtimeAssets={runtimeAssets}
            playheadSeconds={playheadSeconds}
            isPlaying={isPlaying}
            onPlayChange={setIsPlaying}
            onPlayheadChange={setPlayheadSeconds}
          />
        </div>

        <Timeline
          project={project}
          runtimeAssets={runtimeAssets}
          selection={selection}
          playheadSeconds={playheadSeconds}
          zoom={timelineZoom}
          onSelect={setSelection}
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
  const sessionOnlyAssets = project.sourceAssets.filter(
    (asset) =>
      !asset.fileHandle &&
      !asset.fileBlob &&
      !missingAssets.some((missing) => missing.id === asset.id)
  )
  const supportsPersistentHandles =
    typeof window !== "undefined" && "showOpenFilePicker" in window

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-y-auto p-4 ${CARD_CLASS}`}
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">
            {selectedAsset ? selectedAsset.name : "Project details"}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {selectedAsset
              ? `${selectedAsset.type} · ${formatBytes(selectedAsset.sizeBytes)}`
              : "Edit decisions are stored locally. Media files are referenced from disk."}
          </p>
        </div>

        <Separator />

        {selectedClip ? (
          <div className="space-y-4">
            <RangeField
              label="Clip volume"
              value={selectedClip.volume}
              max={1}
              step={0.01}
              onChange={(value) =>
                onClipChange(selectedClip.id, { volume: value })
              }
            />
            <Button
              variant={selectedClip.muted ? "default" : "outline"}
              className="w-full"
              onClick={() =>
                onClipChange(selectedClip.id, { muted: !selectedClip.muted })
              }
            >
              {selectedClip.muted ? (
                <VolumeX data-icon="inline-start" />
              ) : (
                <Volume2 data-icon="inline-start" />
              )}
              {selectedClip.muted ? "Muted" : "Audio on"}
            </Button>
            <NumberField
              label="Source start"
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
        ) : selectedMusic ? (
          <div className="space-y-4">
            <RangeField
              label="Music volume"
              value={selectedMusic.volume}
              max={1}
              step={0.01}
              onChange={(value) =>
                onMusicChange(selectedMusic.id, { volume: value })
              }
            />
            <NumberField
              label="Timeline start"
              value={selectedMusic.timelineStartSeconds}
              onChange={(value) =>
                onMusicChange(selectedMusic.id, {
                  timelineStartSeconds: Math.max(0, value),
                })
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <Metric label="Duration" value={formatDuration(duration)} />
            <Metric label="Clips" value={String(project.clips.length)} />
            <Metric
              label="Music tracks"
              value={String(project.musicTracks.length)}
            />
            <Metric
              label="Export"
              value={`${project.exportSettings.width}x${project.exportSettings.height} WebM`}
            />
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Reconnect files</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Saved file handles are restored after reload when permission is
              still granted. If the browser asks again, approve access here.
            </p>
          </div>
          <Badge
            variant={supportsPersistentHandles ? "outline" : "destructive"}
          >
            {supportsPersistentHandles
              ? "Persistent file handles supported"
              : "This browser only supports session files"}
          </Badge>
          {missingAssets.length === 0 ? (
            <Badge variant="outline">All imported files connected</Badge>
          ) : (
            <div className="space-y-2">
              {missingSavedHandles.length > 0 ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={onRestoreSavedAccess}
                >
                  <FolderOpen data-icon="inline-start" />
                  Restore saved access
                </Button>
              ) : null}
              {missingAssets.map((asset) => (
                <ReconnectButton
                  key={asset.id}
                  asset={asset}
                  connected={false}
                  onReconnect={onReconnect}
                />
              ))}
            </div>
          )}
          {sessionOnlyAssets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                These files are connected now but need a browser-stored file or
                persistent handle to survive refresh.
              </p>
              {sessionOnlyAssets.map((asset) => (
                <ReconnectButton
                  key={asset.id}
                  asset={asset}
                  connected
                  onReconnect={onReconnect}
                />
              ))}
            </div>
          ) : null}
        </div>

        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          {status}
        </p>
      </div>
    </aside>
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
          <Button type="button">
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

        <div className="grid gap-3 rounded-md bg-muted/55 p-3 text-sm">
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
    <div className="flex items-center gap-2 rounded-md border bg-background p-2">
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

  return (
    <section
      className={`grid min-h-[420px] min-w-0 overflow-hidden ${CARD_CLASS}`}
      style={{ gridTemplateRows: "minmax(0, 1fr) auto" }}
    >
      <div className="grid min-h-0 place-items-center bg-card p-4">
        <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-md bg-card">
          {previewClips.map((clip) => {
            const runtimeAsset = runtimeAssets[clip.sourceAssetId]

            if (!runtimeAsset) {
              return null
            }

            return (
              <PreviewVideoLayer
                key={clip.id}
                clip={clip}
                runtimeAsset={runtimeAsset}
                playheadSeconds={playheadSeconds}
                isPlaying={isPlaying}
                isActive={activeClipIds.has(clip.id)}
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
            <div className="absolute inset-x-3 bottom-3 z-[2000] rounded-md border border-white/15 bg-black/80 p-3 text-xs leading-5 text-white">
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
              />
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            onClick={() => onPlayChange(!isPlaying)}
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
        <Badge variant="outline">Native media preview</Badge>
      </div>
    </section>
  )
}

function PreviewVideoLayer({
  clip,
  runtimeAsset,
  playheadSeconds,
  isPlaying,
  isActive,
  onIssue,
}: {
  clip: TimelineClip
  runtimeAsset: RuntimeAsset
  playheadSeconds: number
  isPlaying: boolean
  isActive: boolean
  onIssue: (issue: string | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const [isFrameReady, setIsFrameReady] = useState(false)

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

    player.volume = clip.muted ? 0 : clip.volume
    player.muted = clip.muted

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
        "absolute inset-0 block h-full w-full bg-card object-contain transition-opacity duration-75",
        isActive && isFrameReady ? "opacity-100" : "opacity-0",
      ].join(" ")}
      style={{ zIndex: getPreviewLayerZIndex(clip) }}
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
}: {
  track: MusicTrack
  runtimeAsset: RuntimeAsset
  playheadSeconds: number
  isPlaying: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)

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

    player.volume = track.volume

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
  }, [isPlaying, playheadSeconds, runtimeAsset.objectUrl, track])

  return <audio ref={audioRef} preload="auto" />
}

function Timeline({
  project,
  runtimeAssets,
  selection,
  playheadSeconds,
  zoom,
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
  const duration = Math.max(12, getProjectDuration(project) + 3)
  const width = Math.max(duration * zoom, 1200)
  const videoTrackCount = Math.max(2, getTrackCount(project.clips))
  const audioTrackCount = Math.max(2, getTrackCount(project.musicTracks))
  const audioTrackTop =
    VIDEO_TRACK_TOP + videoTrackCount * (TRACK_HEIGHT + TRACK_GAP) + 16
  const timelineHeight =
    audioTrackTop + audioTrackCount * (TRACK_HEIGHT + TRACK_GAP) + 12
  const tickInterval = getTimeTickInterval(zoom)
  const ticks = useMemo(() => {
    const count = Math.ceil(duration / tickInterval) + 1

    return Array.from({ length: count }, (_, index) => index * tickInterval)
  }, [duration, tickInterval])
  const timelineRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const durationRef = useRef(duration)
  const playheadSecondsRef = useRef(playheadSeconds)
  const [hoverSeconds, setHoverSeconds] = useState<number | null>(null)
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(
    null
  )
  const snapItems = useMemo(
    () => [...project.clips, ...project.musicTracks],
    [project.clips, project.musicTracks]
  )

  useEffect(() => {
    zoomRef.current = zoom
    durationRef.current = duration
    playheadSecondsRef.current = playheadSeconds
  }, [duration, playheadSeconds, zoom])

  useEffect(() => {
    const container = timelineRef.current

    if (!container) {
      return
    }

    const scrollContainer = container

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
        const nextZoom = clamp(currentZoom * zoomFactor, 1, 160)

        if (Math.abs(nextZoom - currentZoom) < 0.01) {
          return
        }

        onZoomChange(Number(nextZoom.toFixed(2)))

        requestAnimationFrame(() => {
          scrollContainer.scrollLeft = secondsAtCursor * nextZoom - cursorX
        })

        return
      }

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        scrollContainer.scrollLeft += event.deltaX
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
    const clampedZoom = clamp(nextZoom, 1, 160)

    if (!scrollContainer) {
      onZoomChange(clampedZoom)
      return
    }

    const anchorSeconds = playheadSecondsRef.current
    const anchorX = scrollContainer.clientWidth / 2

    onZoomChange(clampedZoom)

    requestAnimationFrame(() => {
      scrollContainer.scrollLeft = anchorSeconds * clampedZoom - anchorX
    })
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
    onPlayheadChange(getSecondsFromPointer(event))
  }

  function updateHover(event: PointerEvent<HTMLDivElement>) {
    setHoverSeconds(getSecondsFromPointer(event))
  }

  function updateDropPreview(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setDropPreview(getTimelineDropPreview(event, zoom, duration, audioTrackTop))
  }

  async function dropFilesOnTimeline(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const preview =
      dropPreview ??
      getTimelineDropPreview(event, zoom, duration, audioTrackTop)
    const dropped = await getDroppedLocalFiles(event.dataTransfer)

    setDropPreview(null)

    if (dropped.length > 0) {
      onDropFiles(dropped, preview.placement)
    }
  }

  return (
    <section
      className={`min-h-0 max-w-full min-w-0 overflow-hidden ${CARD_CLASS}`}
    >
      <div className="flex h-10 min-w-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">
            {formatDuration(getProjectDuration(project))}
          </Badge>
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
            value={[zoom]}
            min={1}
            max={160}
            step={0.25}
            onValueChange={(value) =>
              zoomAroundPlayhead(getSliderValue(value, zoom))
            }
          />
        </div>
      </div>

      <div
        className="grid h-[178px] min-w-0 overflow-y-auto"
        style={{
          gridTemplateColumns: `${TRACK_HEADER_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        <div className="relative" style={{ minHeight: timelineHeight }}>
          <div style={{ height: RULER_HEIGHT }} />
          {Array.from({ length: videoTrackCount }, (_, index) => (
            <TrackLabel
              key={`video-${index}`}
              icon={<Film className="size-4" />}
              label={`Video ${index + 1}`}
              top={getVideoTrackTop(index)}
            />
          ))}
          {Array.from({ length: audioTrackCount }, (_, index) => (
            <TrackLabel
              key={`audio-${index}`}
              icon={<FileAudio className="size-4" />}
              label={`Audio ${index + 1}`}
              top={getAudioTrackTop(index, audioTrackTop)}
            />
          ))}
        </div>
        <div
          ref={timelineRef}
          className="h-full w-full max-w-full min-w-0 [touch-action:pan-x] overflow-x-auto overflow-y-hidden overscroll-x-contain"
          style={{
            contain: "layout paint",
            minHeight: timelineHeight,
            scrollbarGutter: "stable",
          }}
          onPointerDown={seekFromPointer}
          onPointerMove={updateHover}
          onPointerLeave={() => setHoverSeconds(null)}
          onDragEnter={updateDropPreview}
          onDragOver={updateDropPreview}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setDropPreview(null)
            }
          }}
          onDrop={dropFilesOnTimeline}
        >
          <div
            className="relative min-h-full max-w-none"
            style={{ minHeight: timelineHeight, minWidth: width, width }}
          >
            {ticks.map((seconds) => (
              <div
                key={`grid-${seconds}`}
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/70"
                style={{ left: seconds * zoom }}
              />
            ))}
            <div className="sticky top-0 z-10" style={{ height: RULER_HEIGHT }}>
              {ticks.map((seconds) => (
                <div
                  key={seconds}
                  className="absolute top-0 h-full border-l px-1 pt-1 font-mono text-[10px] text-muted-foreground"
                  style={{ left: seconds * zoom }}
                >
                  {formatDuration(seconds)}
                </div>
              ))}
              {hoverSeconds === null ? null : (
                <div
                  className="absolute top-0 h-full w-px bg-primary/35"
                  style={{ left: hoverSeconds * zoom }}
                />
              )}
              <div
                className="absolute top-0 h-full w-px bg-primary"
                style={{ left: playheadSeconds * zoom }}
              />
            </div>
            <div
              className="absolute bottom-0 w-px bg-primary"
              style={{ top: RULER_HEIGHT, left: playheadSeconds * zoom }}
            />
            {hoverSeconds === null ? null : (
              <div
                className="pointer-events-none absolute bottom-0 w-px bg-primary/25"
                style={{ top: RULER_HEIGHT, left: hoverSeconds * zoom }}
              />
            )}
            {Array.from({ length: videoTrackCount }, (_, index) => (
              <TrackLane
                key={`video-lane-${index}`}
                top={getVideoTrackTop(index)}
              />
            ))}
            {Array.from({ length: audioTrackCount }, (_, index) => (
              <TrackLane
                key={`audio-lane-${index}`}
                top={getAudioTrackTop(index, audioTrackTop)}
              />
            ))}
            {dropPreview ? (
              <div
                className="pointer-events-none absolute z-20 rounded-md border border-dashed border-primary bg-primary/15 ring-2 ring-primary/20"
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
                  top={getVideoTrackTop(trackIndex)}
                  left={clip.timelineStartSeconds * zoom}
                  width={Math.max(28, getClipDuration(clip) * zoom)}
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
                      project.clips,
                      snapItems,
                      mode,
                      deltaSeconds,
                      deltaTracks,
                      zoom,
                      getVideoTrackTop
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
                  top={getAudioTrackTop(trackIndex, audioTrackTop)}
                  left={track.timelineStartSeconds * zoom}
                  width={Math.max(28, getClipDuration(track) * zoom)}
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
                      project.musicTracks,
                      snapItems,
                      mode,
                      deltaSeconds,
                      deltaTracks,
                      zoom,
                      (index) => getAudioTrackTop(index, audioTrackTop)
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
  } | null>(null)
  const previewRef = useRef<TimelineItemDragPreview | null>(null)
  const [preview, setPreview] = useState<TimelineItemDragPreview | null>(null)
  const stylePreview = preview ?? { top, left, width }

  function startDrag(
    event: PointerEvent<HTMLDivElement>,
    mode: TimelineDragMode
  ) {
    event.stopPropagation()
    onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, mode }
    const nextPreview = onDragPreview(mode, 0, 0)

    previewRef.current = nextPreview
    setPreview(nextPreview)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return
    }

    event.stopPropagation()
    const deltaSeconds = (event.clientX - dragRef.current.x) / zoom
    const deltaTracks =
      dragRef.current.mode === "move"
        ? Math.round(
            (event.clientY - dragRef.current.y) / (TRACK_HEIGHT + TRACK_GAP)
          )
        : 0
    const nextPreview = onDragPreview(
      dragRef.current.mode,
      deltaSeconds,
      deltaTracks
    )

    previewRef.current = nextPreview
    setPreview(nextPreview)
  }

  function endDrag() {
    if (previewRef.current) {
      onDragCommit(previewRef.current)
    }

    previewRef.current = null
    dragRef.current = null
    setPreview(null)
  }

  return (
    <div
      className={[
        "absolute overflow-hidden rounded-md border text-xs",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
        connected ? "" : "opacity-60",
        preview ? "z-30 opacity-80 ring-2 ring-primary/30" : "",
      ].join(" ")}
      style={{
        top: stylePreview.top,
        left: stylePreview.left,
        width: stylePreview.width,
        height: TRACK_HEIGHT,
      }}
      onPointerDown={(event) => startDrag(event, "move")}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="absolute top-0 left-0 h-full w-2 cursor-ew-resize bg-foreground/15"
        onPointerDown={(event) => startDrag(event, "start")}
      />
      <div className="flex h-full items-center justify-between gap-2 px-3">
        <span className="truncate">{label}</span>
        {muted ? <VolumeX className="size-3 shrink-0" /> : null}
      </div>
      <div
        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-foreground/15"
        onPointerDown={(event) => startDrag(event, "end")}
      />
    </div>
  )
}

function TrackLabel({
  icon,
  label,
  top,
}: {
  icon: ReactNode
  label: string
  top: number
}) {
  return (
    <div
      className="absolute left-5 z-20 grid size-4 place-items-center text-muted-foreground"
      style={{ top: top + (TRACK_HEIGHT - 16) / 2 }}
      aria-label={label}
      title={label}
    >
      {icon}
    </div>
  )
}

function TrackLane({ top }: { top: number }) {
  return (
    <div
      className="absolute inset-x-0 rounded-md"
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {Math.round(value * 100)}%
        </span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={max}
        step={step}
        onValueChange={(next) => onChange(getSliderValue(next, value))}
      />
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input
        className="select-text"
        type="number"
        min={0}
        step={0.1}
        value={Number(value.toFixed(2))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

type TimelineItemData = TimelineClip | MusicTrack
type TimelineDragMode = "move" | "start" | "end"
type TimelineDroppedFile = {
  file: File
  fileHandle?: FileSystemFileHandle
}
type TimelineDropPlacement = {
  kind: SourceAsset["type"]
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

function getVideoTrackTop(trackIndex: number) {
  return VIDEO_TRACK_TOP + trackIndex * (TRACK_HEIGHT + TRACK_GAP)
}

function getAudioTrackTop(trackIndex: number, audioTrackTop: number) {
  return audioTrackTop + trackIndex * (TRACK_HEIGHT + TRACK_GAP)
}

function getTimelineDropPreview(
  event: DragEvent<HTMLDivElement>,
  zoom: number,
  duration: number,
  audioTrackTop: number
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
  const isAudio = y >= audioTrackTop - TRACK_GAP
  const trackBaseTop = isAudio ? audioTrackTop : VIDEO_TRACK_TOP
  const trackIndex = Math.max(
    0,
    Math.round((y - trackBaseTop) / (TRACK_HEIGHT + TRACK_GAP))
  )
  const kind = isAudio ? "audio" : "video"

  return {
    top: isAudio
      ? getAudioTrackTop(trackIndex, audioTrackTop)
      : getVideoTrackTop(trackIndex),
    left: timelineStartSeconds * zoom,
    width: Math.max(72, 5 * zoom),
    placement: {
      kind,
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
  laneItems: T[],
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
    width: Math.max(28, getClipDuration(next) * zoom),
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
  items: T[],
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

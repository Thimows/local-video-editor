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
import type {
  CSSProperties,
  ChangeEvent,
  DragEvent,
  PointerEvent,
  ReactNode,
} from "react"
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
const RULER_HEIGHT = 32
const TRACK_HEIGHT = 56
const TRACK_GAP = 10
const VIDEO_TRACK_TOP = RULER_HEIGHT + 12
const SNAP_THRESHOLD_SECONDS = 0.35
const MIN_ITEM_DURATION_SECONDS = 0.2

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
    handles: Record<string, FileSystemFileHandle | undefined> = {}
  ) {
    if (!project) {
      return
    }

    const importedAssets: SourceAsset[] = []
    const importedClips: TimelineClip[] = []
    const importedTracks: MusicTrack[] = []
    const nextRuntimeAssets: Record<string, RuntimeAsset> = {}
    let nextTimelineStart = getProjectDuration(project)

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
      }
      const sourceEndSeconds = metadata.durationSeconds ?? 5

      importedAssets.push(asset)
      nextRuntimeAssets[asset.id] = createRuntimeAsset(file)

      if (type === "video") {
        const trackIndex = findAvailableTrackIndex(
          [...project.clips, ...importedClips],
          nextTimelineStart,
          sourceEndSeconds
        )

        importedClips.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          timelineStartSeconds: nextTimelineStart,
          trackIndex,
          muted: false,
          volume: 1,
        })
        nextTimelineStart += sourceEndSeconds
      } else {
        const trackIndex = findAvailableTrackIndex(
          [...project.musicTracks, ...importedTracks],
          0,
          sourceEndSeconds
        )

        importedTracks.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          timelineStartSeconds: 0,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          trackIndex,
          volume: 0.75,
        })
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
          : ". Some files need persistent reconnect for reload restore"
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
          ? constrainTimelineItemPatch(clip, project.clips, patch)
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
          ? constrainTimelineItemPatch(track, project.musicTracks, patch)
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
      <header className="flex h-14 min-w-0 shrink-0 items-center justify-between border-b px-3">
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Split clip"
                  onClick={splitSelectedClip}
                  disabled={!selectedClip}
                />
              }
            >
              <Scissors />
            </TooltipTrigger>
            <TooltipContent>Split selected clip</TooltipContent>
          </Tooltip>
          <Button onClick={runExport}>
            <Download data-icon="inline-start" />
            Export WebM
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <section
        className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{ gridTemplateRows: "minmax(420px, 1fr) 250px" }}
        onDragOver={allowDrop}
        onDrop={importFromDrop}
      >
        <div
          className="grid min-h-[420px] min-w-0 overflow-hidden"
          style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}
        >
          <InspectorPanel
            project={project}
            selectedAsset={selectedAsset}
            selectedClip={selectedClip}
            selectedMusic={selectedMusic}
            missingAssets={missingAssets}
            status={status}
            exportState={exportState}
            onClipChange={updateClip}
            onMusicChange={updateMusic}
            onReconnect={reconnectAsset}
            onRestoreSavedAccess={restoreSavedAccess}
            onCancelExport={() => exportState.controller?.abort()}
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
  exportState,
  onClipChange,
  onMusicChange,
  onReconnect,
  onRestoreSavedAccess,
  onCancelExport,
}: {
  project: Project
  selectedAsset: SourceAsset | null
  selectedClip: TimelineClip | null
  selectedMusic: MusicTrack | null
  missingAssets: SourceAsset[]
  status: string
  exportState: {
    progress: number
    message: string
    url?: string
    controller?: AbortController
  }
  onClipChange: (id: string, patch: Partial<TimelineClip>) => void
  onMusicChange: (id: string, patch: Partial<MusicTrack>) => void
  onReconnect: (
    assetId: string,
    file: File,
    fileHandle?: FileSystemFileHandle
  ) => void
  onRestoreSavedAccess: () => void
  onCancelExport: () => void
}) {
  const duration = getProjectDuration(project)
  const missingSavedHandles = missingAssets.filter((asset) => asset.fileHandle)
  const sessionOnlyAssets = project.sourceAssets.filter(
    (asset) =>
      !asset.fileHandle &&
      !missingAssets.some((missing) => missing.id === asset.id)
  )
  const supportsPersistentHandles =
    typeof window !== "undefined" && "showOpenFilePicker" in window

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-r bg-muted/25 p-3">
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
                These files are connected now but will not survive refresh until
                you reconnect them persistently.
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

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Export</h3>
            {exportState.controller ? (
              <Button size="sm" variant="outline" onClick={onCancelExport}>
                Cancel
              </Button>
            ) : null}
          </div>
          <Progress value={Math.round(exportState.progress * 100)}>
            <ProgressLabel>{exportState.message}</ProgressLabel>
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {Math.round(exportState.progress * 100)}%
            </span>
          </Progress>
          <p className="text-xs leading-5 text-muted-foreground">
            Current exporter creates local WebM files with MediaRecorder.
            Large-project streaming and more containers can replace this adapter
            later.
          </p>
          {exportState.url ? (
            <Button
              className="w-full"
              nativeButton={false}
              render={
                <a
                  href={exportState.url}
                  download={`${project.name || "export"}.webm`}
                />
              }
            >
              <Download data-icon="inline-start" />
              Download export
            </Button>
          ) : null}
        </div>

        <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">
          {status}
        </p>
      </div>
    </aside>
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
          {asset.fileHandle ? "persistent handle saved" : "temporary file only"}{" "}
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const playheadRef = useRef(playheadSeconds)
  const playbackClockRef = useRef<{
    playheadSeconds: number
    startedAt: number
  } | null>(null)
  const generatedPlayheadRef = useRef<number | null>(null)
  const [previewIssue, setPreviewIssue] = useState<string | null>(null)
  const sortedClips = useMemo(
    () =>
      [...project.clips].sort(
        (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
      ),
    [project.clips]
  )
  const clipAtPlayhead = findClipAtTime(sortedClips, playheadSeconds)
  const activeClip = clipAtPlayhead
  const runtimeAsset = activeClip
    ? runtimeAssets[activeClip.sourceAssetId]
    : undefined
  const hasPlayableClip = sortedClips.some(
    (clip) => runtimeAssets[clip.sourceAssetId]
  )
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

    const video = videoRef.current

    if (
      video &&
      activeClip &&
      runtimeAsset &&
      video.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      video.currentTime = getSourceTimeForPlayhead(activeClip, playheadSeconds)
    }
  }, [activeClip, isPlaying, playheadSeconds, runtimeAsset])

  useEffect(() => {
    const video = videoRef.current

    if (!video || !activeClip || !runtimeAsset) {
      return
    }

    if (isPlaying) {
      return
    }

    const player = video
    const clip = activeClip
    const asset = runtimeAsset
    const targetTime = getSourceTimeForPlayhead(clip, playheadSeconds)
    let cancelled = false

    async function syncVideo() {
      if (activeObjectUrlRef.current !== asset.objectUrl) {
        player.src = asset.objectUrl
        activeObjectUrlRef.current = asset.objectUrl
        await waitForVideoMetadata(player)
      }

      if (cancelled) {
        return
      }

      player.volume = clip.muted ? 0 : clip.volume

      if (Number.isFinite(targetTime)) {
        player.currentTime = targetTime
        await waitForVideoSeek(player)
      }

      if (player.videoWidth === 0 || player.videoHeight === 0) {
        setPreviewIssue(
          "The audio can play, but this browser is not exposing a decodable video track for this file."
        )
      } else {
        setPreviewIssue(null)
      }
    }

    syncVideo().catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [activeClip, isPlaying, playheadSeconds, runtimeAsset])

  useEffect(() => {
    const video = videoRef.current

    if (!video || !activeClip || !runtimeAsset) {
      if (isPlaying) {
        playbackClockRef.current = {
          playheadSeconds: playheadRef.current,
          startedAt: performance.now(),
        }
        let frame = 0
        let lastTimelineUpdate = 0

        function tickGap() {
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

          frame = requestAnimationFrame(tickGap)
        }

        frame = requestAnimationFrame(tickGap)

        return () => cancelAnimationFrame(frame)
      }
      return
    }

    const player = video
    const clip = activeClip
    const asset = runtimeAsset
    playbackClockRef.current = {
      playheadSeconds: playheadRef.current,
      startedAt: performance.now(),
    }
    let cancelled = false
    let frame = 0
    let lastTimelineUpdate = 0

    async function syncPlayback() {
      if (isPlaying) {
        if (activeObjectUrlRef.current !== asset.objectUrl) {
          player.src = asset.objectUrl
          activeObjectUrlRef.current = asset.objectUrl
          await waitForVideoMetadata(player)
        }

        if (cancelled) {
          return
        }

        player.volume = clip.muted ? 0 : clip.volume
        player.currentTime = getSourceTimeForPlayhead(clip, playheadRef.current)
        await waitForVideoSeek(player)
        setPreviewIssue(
          player.videoWidth === 0 || player.videoHeight === 0
            ? "The audio can play, but this browser is not exposing a decodable video track for this file."
            : null
        )
        await player.play().catch(() => undefined)
      } else {
        player.pause()
      }
    }

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

    syncPlayback()

    if (isPlaying) {
      frame = requestAnimationFrame(tick)
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [
    activeClip,
    isPlaying,
    onPlayChange,
    onPlayheadChange,
    projectDuration,
    runtimeAsset,
    sortedClips,
  ])

  return (
    <section
      className="grid min-h-[420px] min-w-0 overflow-hidden bg-black"
      style={{ gridTemplateRows: "minmax(0, 1fr) auto" }}
    >
      <div className="grid min-h-0 place-items-center bg-black p-4">
        <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-md bg-black">
          {runtimeAsset ? (
            <>
              <video
                ref={videoRef}
                src={runtimeAsset.objectUrl}
                className="absolute inset-0 block h-full w-full bg-black object-contain"
                playsInline
                preload="auto"
                onError={() =>
                  setPreviewIssue(
                    "This browser could not decode the selected video file."
                  )
                }
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  setPreviewIssue(
                    video.videoWidth === 0 || video.videoHeight === 0
                      ? "The audio can play, but this browser is not exposing a decodable video track for this file."
                      : null
                  )
                }}
              />
              {previewIssue ? (
                <div className="absolute inset-x-3 bottom-3 rounded-md border border-white/15 bg-black/80 p-3 text-xs leading-5 text-white">
                  {previewIssue}
                </div>
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-black text-center text-sm text-white/55">
              <div className="space-y-2">
                <Film className="mx-auto size-10" />
                <p>
                  {hasPlayableClip
                    ? "No clip at the playhead."
                    : "Import or reconnect a local video file to preview."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            onClick={() => onPlayChange(!isPlaying)}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasPlayableClip}
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

  return (
    <section className="min-h-0 max-w-full min-w-0 overflow-hidden border-t bg-card">
      <div className="flex h-11 min-w-0 items-center justify-between gap-3 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">
            {formatDuration(getProjectDuration(project))}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            Drag clips to move, drag edges to trim, click the ruler to scrub.
          </span>
        </div>
        <div className="flex w-56 shrink-0 items-center gap-2">
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
        className="grid h-[205px] min-w-0 overflow-y-auto"
        style={{
          gridTemplateColumns: `${TRACK_HEADER_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        <div
          className="relative border-r bg-muted/20"
          style={{ minHeight: timelineHeight }}
        >
          <div className="h-8 border-b bg-card/95" />
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
        >
          <div
            className="relative min-h-full max-w-none"
            style={{ minHeight: timelineHeight, minWidth: width, width }}
          >
            <div className="sticky top-0 z-10 h-8 border-b bg-card/95">
              <div
                className="absolute inset-0 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tick)-1px),color-mix(in_oklch,var(--border),transparent_20%)_calc(var(--tick)-1px),color-mix(in_oklch,var(--border),transparent_20%)_var(--tick))]"
                style={{ "--tick": `${Math.max(zoom, 8)}px` } as CSSProperties}
              />
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
              className="absolute top-8 bottom-0 w-px bg-primary"
              style={{ left: playheadSeconds * zoom }}
            />
            {hoverSeconds === null ? null : (
              <div
                className="pointer-events-none absolute top-8 bottom-0 w-px bg-primary/25"
                style={{ left: hoverSeconds * zoom }}
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
                  onMove={(deltaSeconds, deltaTracks) =>
                    onClipChange(clip.id, {
                      timelineStartSeconds: Math.max(
                        0,
                        clip.timelineStartSeconds + deltaSeconds
                      ),
                      trackIndex: Math.max(0, trackIndex + deltaTracks),
                    })
                  }
                  onTrimStart={(deltaSeconds) =>
                    onClipChange(clip.id, {
                      sourceStartSeconds: Math.min(
                        clip.sourceStartSeconds + deltaSeconds,
                        clip.sourceEndSeconds - 0.2
                      ),
                      timelineStartSeconds: Math.max(
                        0,
                        clip.timelineStartSeconds + deltaSeconds
                      ),
                    })
                  }
                  onTrimEnd={(deltaSeconds) =>
                    onClipChange(clip.id, {
                      sourceEndSeconds: Math.max(
                        clip.sourceStartSeconds + 0.2,
                        clip.sourceEndSeconds + deltaSeconds
                      ),
                    })
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
                  onMove={(deltaSeconds, deltaTracks) =>
                    onMusicChange(track.id, {
                      timelineStartSeconds: Math.max(
                        0,
                        track.timelineStartSeconds + deltaSeconds
                      ),
                      trackIndex: Math.max(0, trackIndex + deltaTracks),
                    })
                  }
                  onTrimStart={(deltaSeconds) =>
                    onMusicChange(track.id, {
                      sourceStartSeconds: Math.min(
                        track.sourceStartSeconds + deltaSeconds,
                        track.sourceEndSeconds - 0.2
                      ),
                      timelineStartSeconds: Math.max(
                        0,
                        track.timelineStartSeconds + deltaSeconds
                      ),
                    })
                  }
                  onTrimEnd={(deltaSeconds) =>
                    onMusicChange(track.id, {
                      sourceEndSeconds: Math.max(
                        track.sourceStartSeconds + 0.2,
                        track.sourceEndSeconds + deltaSeconds
                      ),
                    })
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
  onMove,
  onTrimStart,
  onTrimEnd,
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
  onMove: (deltaSeconds: number, deltaTracks: number) => void
  onTrimStart: (deltaSeconds: number) => void
  onTrimEnd: (deltaSeconds: number) => void
}) {
  const dragRef = useRef<{
    x: number
    y: number
    mode: "move" | "start" | "end"
  } | null>(null)

  function startDrag(
    event: PointerEvent<HTMLDivElement>,
    mode: "move" | "start" | "end"
  ) {
    event.stopPropagation()
    onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, mode }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return
    }

    event.stopPropagation()
    const deltaSeconds = (event.clientX - dragRef.current.x) / zoom
    const deltaTracks =
      dragRef.current.mode === "move"
        ? Math.trunc(
            (event.clientY - dragRef.current.y) / (TRACK_HEIGHT + TRACK_GAP)
          )
        : 0
    dragRef.current.x = event.clientX

    if (dragRef.current.mode === "move") {
      if (deltaTracks !== 0) {
        dragRef.current.y += deltaTracks * (TRACK_HEIGHT + TRACK_GAP)
      }
      onMove(deltaSeconds, deltaTracks)
    } else if (dragRef.current.mode === "start") {
      onTrimStart(deltaSeconds)
    } else {
      onTrimEnd(deltaSeconds)
    }
  }

  return (
    <div
      className={[
        "absolute overflow-hidden rounded-md border text-xs shadow-sm transition-[top]",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
        connected ? "" : "opacity-60",
      ].join(" ")}
      style={{ top, left, width, height: TRACK_HEIGHT }}
      onPointerDown={(event) => startDrag(event, "move")}
      onPointerMove={moveDrag}
      onPointerUp={() => {
        dragRef.current = null
      }}
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
      className="absolute left-2 z-20 grid size-9 place-items-center rounded-md border bg-background text-muted-foreground"
      style={{ top: top + (TRACK_HEIGHT - 36) / 2 }}
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
      className="absolute inset-x-0 rounded-md border-y bg-muted/10"
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
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

type TimelineItemData = TimelineClip | MusicTrack

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

function constrainTimelineItemPatch<T extends TimelineItemData>(
  item: T,
  items: T[],
  patch: Partial<T>
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
      laneItems
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
      ...laneItems.flatMap((laneItem) => [
        laneItem.timelineStartSeconds,
        laneItem.timelineStartSeconds + getClipDuration(laneItem),
      ]),
    ])
    const clampedStart = clamp(
      desiredStart,
      getPreviousItemEnd(laneItems, fixedEnd),
      Math.min(fixedEnd - MIN_ITEM_DURATION_SECONDS, maxEnd)
    )
    const duration = fixedEnd - clampedStart

    return {
      ...next,
      timelineStartSeconds: clampedStart,
      sourceStartSeconds: next.sourceEndSeconds - duration,
    }
  }

  if (isTrimEnd) {
    const start = next.timelineStartSeconds
    const maxEnd = getNextItemStart(laneItems, start) ?? Infinity
    const desiredEnd = snapPoint(start + getClipDuration(next), [
      ...laneItems.flatMap((laneItem) => [
        laneItem.timelineStartSeconds,
        laneItem.timelineStartSeconds + getClipDuration(laneItem),
      ]),
    ])
    const clampedEnd = clamp(
      desiredEnd,
      start + MIN_ITEM_DURATION_SECONDS,
      maxEnd
    )

    return {
      ...next,
      sourceEndSeconds: next.sourceStartSeconds + clampedEnd - start,
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
    return snappedStart
  }

  const snappedEnd = snapPoint(endSeconds, points)

  return snappedEnd === endSeconds ? startSeconds : snappedEnd - durationSeconds
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

  return Math.max(0, nearest)
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

  return (
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

function findClipAtTime(clips: TimelineClip[], seconds: number) {
  return clips
    .filter((clip) => {
      const start = clip.timelineStartSeconds
      const end = clip.timelineStartSeconds + getClipDuration(clip)

      return seconds >= start && seconds < end
    })
    .sort((a, b) => getTrackIndex(b) - getTrackIndex(a))[0]
}

function getSourceTimeForPlayhead(clip: TimelineClip, playheadSeconds: number) {
  const clipOffset = clamp(
    playheadSeconds - clip.timelineStartSeconds,
    0,
    getClipDuration(clip)
  )

  return clip.sourceStartSeconds + clipOffset
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      video.removeEventListener("loadedmetadata", onLoadedMetadata)
      video.removeEventListener("error", onError)
    }

    function onLoadedMetadata() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error("Could not load video metadata"))
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}

function waitForVideoSeek(video: HTMLVideoElement) {
  if (!video.seeking) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("error", onError)
    }

    function onSeeked() {
      cleanup()
      resolve()
    }

    function onError() {
      cleanup()
      reject(new Error("Could not seek video"))
    }

    video.addEventListener("seeked", onSeeked, { once: true })
    video.addEventListener("error", onError, { once: true })
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

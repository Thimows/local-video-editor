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

export function EditorClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id
  const [project, setProject] = useState<Project | null>(null)
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetMap>({})
  const [selection, setSelection] = useState<Selection>({ type: "project" })
  const [playheadSeconds, setPlayheadSeconds] = useState(0)
  const [timelineZoom, setTimelineZoom] = useState(64)
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
        importedClips.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          timelineStartSeconds: nextTimelineStart,
          muted: false,
          volume: 1,
        })
        nextTimelineStart += sourceEndSeconds
      } else {
        importedTracks.push({
          id: crypto.randomUUID(),
          sourceAssetId: asset.id,
          timelineStartSeconds: 0,
          sourceStartSeconds: 0,
          sourceEndSeconds,
          volume: 0.75,
        })
      }
    }

    if (importedAssets.length === 0) {
      setStatus("No supported local media files were selected")
      return
    }

    setRuntimeAssets((current) =>
      mergeRuntimeAssets(current, nextRuntimeAssets)
    )
    setProject({
      ...project,
      sourceAssets: [...project.sourceAssets, ...importedAssets],
      clips: [...project.clips, ...importedClips],
      musicTracks: [...project.musicTracks, ...importedTracks],
      updatedAt: Date.now(),
    })
    setStatus(
      `Imported ${importedAssets.length} local file${
        importedAssets.length === 1 ? "" : "s"
      }${
        importedAssets.every((asset) => asset.fileHandle)
          ? " with persistent handles"
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
        clip.id === id ? { ...clip, ...patch } : clip
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
        track.id === id ? { ...track, ...patch } : track
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
    setProject({
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
    })
    setStatus(
      `Reconnected ${asset.name}${
        fileHandle ? " with persistent access" : " for this session"
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
    <main className="flex h-svh min-h-[720px] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-3">
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
              className="h-8 border-transparent px-1 text-base font-medium shadow-none"
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
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_250px]"
        onDragOver={allowDrop}
        onDrop={importFromDrop}
      >
        <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
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
            selectedClip={selectedClip}
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
  onReconnect: (assetId: string, file: File) => void
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
  selectedClip,
  isPlaying,
  onPlayChange,
  onPlayheadChange,
}: {
  project: Project
  runtimeAssets: RuntimeAssetMap
  playheadSeconds: number
  selectedClip: TimelineClip | null
  isPlaying: boolean
  onPlayChange: (isPlaying: boolean) => void
  onPlayheadChange: (seconds: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeObjectUrlRef = useRef<string | null>(null)
  const playheadRef = useRef(playheadSeconds)
  const [previewIssue, setPreviewIssue] = useState<string | null>(null)
  const [previewInfo, setPreviewInfo] = useState("No video connected")
  const sortedClips = useMemo(
    () =>
      [...project.clips].sort(
        (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
      ),
    [project.clips]
  )
  const clipAtPlayhead = findClipAtTime(sortedClips, playheadSeconds)
  const activeClip = clipAtPlayhead ?? (isPlaying ? null : selectedClip)
  const runtimeAsset = activeClip
    ? runtimeAssets[activeClip.sourceAssetId]
    : undefined
  const hasPlayableClip = sortedClips.some(
    (clip) => runtimeAssets[clip.sourceAssetId]
  )

  useEffect(() => {
    playheadRef.current = playheadSeconds
  }, [playheadSeconds])

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
        drawPreviewFrame(player, canvasRef.current)
      }
      setPreviewInfo(getVideoDebugInfo(player))
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
        const nextPlayableClip = getPlayableClipAtOrAfter(
          sortedClips,
          playheadRef.current,
          runtimeAssets
        )

        if (nextPlayableClip) {
          onPlayheadChange(nextPlayableClip.timelineStartSeconds)
        } else {
          onPlayChange(false)
        }
      }
      return
    }

    const player = video
    const clip = activeClip
    const asset = runtimeAsset
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
        drawPreviewFrame(player, canvasRef.current)
        setPreviewInfo(getVideoDebugInfo(player))
        await player.play().catch(() => undefined)
      } else {
        player.pause()
      }
    }

    function tick() {
      if (player.currentTime >= clip.sourceEndSeconds) {
        const nextClip = getNextPlayableClip(sortedClips, clip, runtimeAssets)

        if (nextClip) {
          onPlayheadChange(nextClip.timelineStartSeconds)
        } else {
          onPlayChange(false)
        }
        return
      }

      const now = performance.now()
      drawPreviewFrame(player, canvasRef.current)

      if (now - lastTimelineUpdate > 33) {
        lastTimelineUpdate = now
        onPlayheadChange(
          clip.timelineStartSeconds +
            player.currentTime -
            clip.sourceStartSeconds
        )
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
    runtimeAsset,
    runtimeAssets,
    sortedClips,
  ])

  return (
    <section className="grid min-h-0 grid-rows-[1fr_auto] bg-background">
      <div className="grid place-items-center p-4">
        <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-lg border bg-black">
          {runtimeAsset ? (
            <>
              <canvas
                ref={canvasRef}
                className="h-full w-full bg-black"
                width={1920}
                height={1080}
              />
              <video
                ref={videoRef}
                src={runtimeAsset.objectUrl}
                className="pointer-events-none absolute top-2 left-2 size-1 opacity-0"
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
                  setPreviewInfo(getVideoDebugInfo(video))
                  drawPreviewFrame(video, canvasRef.current)
                }}
              />
              <div className="absolute top-3 left-3 rounded-md border border-white/15 bg-black/70 px-2 py-1 font-mono text-[11px] text-white/75">
                {previewInfo}
              </div>
              {previewIssue ? (
                <div className="absolute inset-x-3 bottom-3 rounded-md border border-white/15 bg-black/80 p-3 text-xs leading-5 text-white">
                  {previewIssue}
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-white/70">
              <div className="space-y-2">
                <Film className="mx-auto size-10" />
                <p>Import or reconnect a local video file to preview.</p>
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
            {formatDuration(getProjectDuration(project))}
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
  const width = Math.max(duration * zoom, 3600)
  const timelineRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const durationRef = useRef(duration)
  const [hoverSeconds, setHoverSeconds] = useState<number | null>(null)

  useEffect(() => {
    zoomRef.current = zoom
    durationRef.current = duration
  }, [duration, zoom])

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

        const secondsAtCursor = getTimelineSeconds(
          scrollContainer,
          event.clientX,
          currentZoom,
          currentDuration
        )
        const direction = event.deltaY > 0 ? -1 : 1
        const nextZoom = clamp(
          currentZoom + direction * Math.max(6, currentZoom * 0.14),
          24,
          260
        )

        onZoomChange(nextZoom)

        requestAnimationFrame(() => {
          scrollContainer.scrollLeft =
            secondsAtCursor * nextZoom -
            (event.clientX - scrollContainer.getBoundingClientRect().left)
        })

        return
      }

      const horizontalDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY

      if (horizontalDelta !== 0) {
        event.preventDefault()
        scrollContainer.scrollLeft += horizontalDelta
      }
    }

    scrollContainer.addEventListener("wheel", onWheel, { passive: false })

    return () => {
      scrollContainer.removeEventListener("wheel", onWheel)
    }
  }, [onZoomChange])

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
    <section className="min-h-0 border-t bg-card">
      <div className="flex h-11 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {formatDuration(getProjectDuration(project))}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Drag clips to move, drag edges to trim, click the ruler to scrub.
          </span>
        </div>
        <div className="flex w-56 items-center gap-2">
          <Label className="text-xs">Zoom</Label>
          <Slider
            value={[zoom]}
            min={32}
            max={520}
            step={4}
            onValueChange={(value) => onZoomChange(getSliderValue(value, zoom))}
          />
        </div>
      </div>

      <div
        ref={timelineRef}
        className="h-[205px] [touch-action:pan-x] overflow-auto overscroll-contain"
        onPointerDown={seekFromPointer}
        onPointerMove={updateHover}
        onPointerLeave={() => setHoverSeconds(null)}
      >
        <div className="relative min-h-full" style={{ width }}>
          <div className="sticky top-0 z-10 h-8 border-b bg-card/95">
            <div
              className="absolute inset-0 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tick)-1px),color-mix(in_oklch,var(--border),transparent_20%)_calc(var(--tick)-1px),color-mix(in_oklch,var(--border),transparent_20%)_var(--tick))]"
              style={{ "--tick": `${zoom}px` } as CSSProperties}
            />
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
          <TrackLabel
            icon={<Film className="size-3" />}
            label="Video"
            top={48}
          />
          <TrackLabel
            icon={<FileAudio className="size-3" />}
            label="Audio"
            top={126}
          />
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
          {project.clips.map((clip) => {
            const asset = project.sourceAssets.find(
              (item) => item.id === clip.sourceAssetId
            )
            const connected = Boolean(runtimeAssets[clip.sourceAssetId])

            return (
              <TimelineItem
                key={clip.id}
                top={48}
                left={clip.timelineStartSeconds * zoom}
                width={Math.max(28, getClipDuration(clip) * zoom)}
                selected={selection.type === "clip" && selection.id === clip.id}
                label={asset?.name ?? "Missing video"}
                muted={clip.muted}
                connected={connected}
                onSelect={() => onSelect({ type: "clip", id: clip.id })}
                onMove={(deltaSeconds) =>
                  onClipChange(clip.id, {
                    timelineStartSeconds: Math.max(
                      0,
                      clip.timelineStartSeconds + deltaSeconds
                    ),
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

            return (
              <TimelineItem
                key={track.id}
                top={126}
                left={track.timelineStartSeconds * zoom}
                width={Math.max(28, getClipDuration(track) * zoom)}
                selected={
                  selection.type === "music" && selection.id === track.id
                }
                label={asset?.name ?? "Missing audio"}
                muted={false}
                connected={connected}
                onSelect={() => onSelect({ type: "music", id: track.id })}
                onMove={(deltaSeconds) =>
                  onMusicChange(track.id, {
                    timelineStartSeconds: Math.max(
                      0,
                      track.timelineStartSeconds + deltaSeconds
                    ),
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
  onMove: (deltaSeconds: number) => void
  onTrimStart: (deltaSeconds: number) => void
  onTrimEnd: (deltaSeconds: number) => void
}) {
  const dragRef = useRef<{ x: number; mode: "move" | "start" | "end" } | null>(
    null
  )

  function startDrag(
    event: PointerEvent<HTMLDivElement>,
    mode: "move" | "start" | "end"
  ) {
    event.stopPropagation()
    onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, mode }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return
    }

    event.stopPropagation()
    const deltaSeconds = (event.clientX - dragRef.current.x) / zoom
    dragRef.current.x = event.clientX

    if (dragRef.current.mode === "move") {
      onMove(deltaSeconds)
    } else if (dragRef.current.mode === "start") {
      onTrimStart(deltaSeconds)
    } else {
      onTrimEnd(deltaSeconds)
    }
  }

  return (
    <div
      className={[
        "absolute h-12 overflow-hidden rounded-md border text-xs shadow-sm",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
        connected ? "" : "opacity-60",
      ].join(" ")}
      style={{ top, left, width }}
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
      className="sticky left-0 z-20 ml-2 flex w-20 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
      style={{ top }}
    >
      {icon}
      {label}
    </div>
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

function findClipAtTime(clips: TimelineClip[], seconds: number) {
  return clips.find((clip) => {
    const start = clip.timelineStartSeconds
    const end = clip.timelineStartSeconds + getClipDuration(clip)

    return seconds >= start && seconds <= end
  })
}

function getNextPlayableClip(
  clips: TimelineClip[],
  currentClip: TimelineClip,
  runtimeAssets: RuntimeAssetMap
) {
  const currentIndex = clips.findIndex((clip) => clip.id === currentClip.id)

  return clips
    .slice(currentIndex + 1)
    .find((clip) => runtimeAssets[clip.sourceAssetId])
}

function getPlayableClipAtOrAfter(
  clips: TimelineClip[],
  seconds: number,
  runtimeAssets: RuntimeAssetMap
) {
  return clips.find((clip) => {
    if (!runtimeAssets[clip.sourceAssetId]) {
      return false
    }

    return clip.timelineStartSeconds + getClipDuration(clip) >= seconds
  })
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

function drawPreviewFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement | null
) {
  if (!canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return
  }

  const context = canvas.getContext("2d")

  if (!context) {
    return
  }

  context.fillStyle = "#000"
  context.fillRect(0, 0, canvas.width, canvas.height)

  const videoRatio = video.videoWidth / video.videoHeight
  const canvasRatio = canvas.width / canvas.height
  const drawWidth =
    videoRatio > canvasRatio ? canvas.width : canvas.height * videoRatio
  const drawHeight =
    videoRatio > canvasRatio ? canvas.width / videoRatio : canvas.height
  const x = (canvas.width - drawWidth) / 2
  const y = (canvas.height - drawHeight) / 2

  context.drawImage(video, x, y, drawWidth, drawHeight)
}

function getVideoDebugInfo(video: HTMLVideoElement) {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return `no video frame · ready ${video.readyState}`
  }

  return `${video.videoWidth}x${video.videoHeight} · ready ${video.readyState}`
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

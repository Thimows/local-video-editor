import type { Project, RuntimeAssetMap, SourceAssetType } from "./types"

export type MediaMetadata = {
  durationSeconds?: number
  width?: number
  height?: number
}

export type FileRestoreDiagnostic = {
  id: string
  name: string
  hasFileHandle: boolean
  hasFileHandleGetFile: boolean
  handleName?: string
  hasFileBlob: boolean
  fileBlobSize?: number
  initialPermission?: PermissionState | "unavailable" | "error"
  requestedPermission?: PermissionState | "not-requested" | "unavailable" | "error"
  restoredVia?: "handle" | "blob-fallback" | "none"
  restoredFile?: {
    name: string
    size: number
    type: string
    lastModified: number
  }
  error?: {
    name?: string
    message?: string
  }
  errorName?: string
  errorMessage?: string
}

export function getFileKind(file: File): SourceAssetType | null {
  if (file.type.startsWith("video/")) {
    return "video"
  }

  if (file.type.startsWith("audio/")) {
    return "audio"
  }

  return null
}

export function readMediaMetadata(
  file: File,
  type: SourceAssetType
): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement(type === "video" ? "video" : "audio")

    element.preload = "metadata"
    element.src = url

    element.onloadedmetadata = () => {
      resolve({
        durationSeconds: Number.isFinite(element.duration)
          ? element.duration
          : undefined,
        width:
          element instanceof HTMLVideoElement ? element.videoWidth : undefined,
        height:
          element instanceof HTMLVideoElement ? element.videoHeight : undefined,
      })
      URL.revokeObjectURL(url)
    }

    element.onerror = () => {
      resolve({})
      URL.revokeObjectURL(url)
    }
  })
}

export async function chooseLocalFiles(accept: string) {
  const showOpenFilePicker = window.showOpenFilePicker

  if (showOpenFilePicker) {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [getPickerType(accept)],
    })

    return Promise.all(
      handles.map(async (handle) => {
        await requestFileHandleReadPermission(handle)

        return {
          file: await handle.getFile(),
          fileHandle: handle,
        }
      })
    )
  }

  return []
}

function getPickerType(accept: string): FilePickerAcceptType {
  if (accept.includes("video") && accept.includes("audio")) {
    return {
      description: "Media files",
      accept: {
        "video/*": [".mp4", ".mov", ".m4v", ".webm"],
        "audio/*": [".mp3", ".m4a", ".wav", ".webm", ".ogg"],
      },
    }
  }

  if (accept.includes("video")) {
    return {
      description: "Video files",
      accept: {
        "video/*": [".mp4", ".mov", ".m4v", ".webm"],
      },
    }
  }

  return {
    description: "Audio files",
    accept: {
      "audio/*": [".mp3", ".m4a", ".wav", ".webm", ".ogg"],
    },
  }
}

export async function getDroppedLocalFiles(dataTransfer: DataTransfer) {
  const droppedFiles: LocalFileSelection[] = []

  if (dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") {
        continue
      }

      const handle = item.getAsFileSystemHandle
        ? await item.getAsFileSystemHandle()
        : null

      if (handle?.getFile) {
        await requestFileHandleReadPermission(handle)
        droppedFiles.push({
          file: await handle.getFile(),
          fileHandle: handle,
        })
        continue
      }

      const file = item.getAsFile()

      if (file) {
        droppedFiles.push({ file })
      }
    }
  }

  if (droppedFiles.length > 0) {
    return droppedFiles
  }

  return Array.from(dataTransfer.files).map((file): LocalFileSelection => ({
    file,
  }))
}

async function requestFileHandleReadPermission(handle: FileSystemFileHandle) {
  if (!handle.requestPermission) {
    return
  }

  const currentPermission = handle.queryPermission
    ? await handle.queryPermission({ mode: "read" }).catch(() => "prompt")
    : "prompt"

  if (currentPermission === "granted") {
    return
  }

  await handle.requestPermission({ mode: "read" }).catch(() => undefined)
}

type LocalFileSelection = {
  file: File
  fileHandle?: FileSystemFileHandle
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return false
  }

  return navigator.storage.persist()
}

export function createRuntimeAsset(file: File) {
  return {
    file,
    objectUrl: URL.createObjectURL(file),
  }
}

export async function restoreProjectFileHandles(
  project: Project,
  requestPermission = false
) {
  const runtimeAssets: RuntimeAssetMap = {}
  const diagnostics: FileRestoreDiagnostic[] = []
  const entries = project.sourceAssets.map((asset) => {
    const handle = asset.fileHandle
    const diagnostic: FileRestoreDiagnostic = {
      id: asset.id,
      name: asset.name,
      hasFileHandle: Boolean(handle),
      hasFileHandleGetFile: Boolean(handle?.getFile),
      handleName: handle?.name,
      hasFileBlob: Boolean(asset.fileBlob),
      fileBlobSize: asset.fileBlob?.size,
      requestedPermission: "not-requested",
      restoredVia: "none",
    }

    diagnostics.push(diagnostic)

    return { asset, diagnostic, handle }
  })
  let restoredCount = 0
  let permissionNeededCount = 0
  let unavailableCount = 0

  if (requestPermission) {
    const permissionRequests = entries.map(async ({ diagnostic, handle }) => {
      if (!handle?.getFile) {
        return
      }

      if (!handle.requestPermission) {
        diagnostic.requestedPermission = "unavailable"
        return
      }

      try {
        diagnostic.requestedPermission = await handle.requestPermission({
          mode: "read",
        })
      } catch (reason) {
        diagnostic.requestedPermission = "error"
        setFileRestoreDiagnosticError(diagnostic, reason)
      }
    })

    await Promise.all(permissionRequests)
  }

  for (const { asset, diagnostic, handle } of entries) {
    if (!handle?.getFile) {
      if (asset.fileBlob) {
        runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
        restoredCount += 1
        diagnostic.restoredVia = "blob-fallback"
        diagnostic.restoredFile = getFileDebugInfo(asset.fileBlob)
      } else {
        unavailableCount += 1
      }
      continue
    }

    try {
      diagnostic.initialPermission ??=
        await queryFileHandleReadPermission(handle)
      const permission = getDiagnosticPermission(diagnostic)

      if (permission !== "granted") {
        if (asset.fileBlob) {
          runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
          restoredCount += 1
          diagnostic.restoredVia = "blob-fallback"
          diagnostic.restoredFile = getFileDebugInfo(asset.fileBlob)
        } else {
          permissionNeededCount += 1
        }
        continue
      }

      const file = await handle.getFile()

      runtimeAssets[asset.id] = createRuntimeAsset(file)
      restoredCount += 1
      diagnostic.restoredVia = "handle"
      diagnostic.restoredFile = getFileDebugInfo(file)
    } catch (reason) {
      setFileRestoreDiagnosticError(diagnostic, reason)

      if (asset.fileBlob) {
        runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
        restoredCount += 1
        diagnostic.restoredVia = "blob-fallback"
        diagnostic.restoredFile = getFileDebugInfo(asset.fileBlob)
      } else {
        unavailableCount += 1
      }
    }
  }

  return {
    runtimeAssets,
    restoredCount,
    permissionNeededCount,
    unavailableCount,
    diagnostics,
  }
}

async function queryFileHandleReadPermission(handle: FileSystemFileHandle) {
  if (!handle.queryPermission) {
    return "granted" satisfies PermissionState
  }

  return handle
    .queryPermission({ mode: "read" })
    .catch((): "error" => "error")
}

function getDiagnosticPermission(diagnostic: FileRestoreDiagnostic) {
  if (
    diagnostic.requestedPermission &&
    diagnostic.requestedPermission !== "not-requested" &&
    diagnostic.requestedPermission !== "unavailable" &&
    diagnostic.requestedPermission !== "error"
  ) {
    return diagnostic.requestedPermission
  }

  return diagnostic.initialPermission
}

function setFileRestoreDiagnosticError(
  diagnostic: FileRestoreDiagnostic,
  reason: unknown
) {
  diagnostic.error =
    reason instanceof Error
      ? { name: reason.name, message: reason.message }
      : { message: String(reason) }
  diagnostic.errorName = diagnostic.error.name
  diagnostic.errorMessage = diagnostic.error.message
}

function getFileDebugInfo(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
}

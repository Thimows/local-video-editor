import type { Project, RuntimeAssetMap, SourceAssetType } from "./types"

export type MediaMetadata = {
  durationSeconds?: number
  width?: number
  height?: number
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
      handles.map(async (handle) => ({
        file: await handle.getFile(),
        fileHandle: handle,
      }))
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
  let restoredCount = 0
  let permissionNeededCount = 0
  let unavailableCount = 0

  for (const asset of project.sourceAssets) {
    const handle = asset.fileHandle

    if (!handle?.getFile) {
      if (asset.fileBlob) {
        runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
        restoredCount += 1
      } else {
        unavailableCount += 1
      }
      continue
    }

    try {
      const currentPermission = handle.queryPermission
        ? await handle.queryPermission({ mode: "read" })
        : "granted"
      const permission =
        currentPermission === "granted" || !requestPermission
          ? currentPermission
          : handle.requestPermission
            ? await handle.requestPermission({ mode: "read" })
            : currentPermission

      if (permission !== "granted") {
        if (asset.fileBlob) {
          runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
          restoredCount += 1
        } else {
          permissionNeededCount += 1
        }
        continue
      }

      const file = await handle.getFile()

      runtimeAssets[asset.id] = createRuntimeAsset(file)
      restoredCount += 1
    } catch {
      if (asset.fileBlob) {
        runtimeAssets[asset.id] = createRuntimeAsset(asset.fileBlob)
        restoredCount += 1
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
  }
}

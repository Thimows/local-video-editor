type FilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

type OpenFilePickerOptions = {
  multiple?: boolean
  types?: FilePickerAcceptType[]
}

type LocalVideoEditorProxyDebugEntry = {
  assetId: string
  assetName: string
  cacheKey?: string
  durationSeconds?: number
  elapsedMs?: number
  errorMessage?: string
  errorName?: string
  outputSizeBytes?: number
  phase: string
  progress?: number
  processedTimeSeconds?: number
  scale: 0.5
  segmentIndex?: number
  sourceEndSeconds?: number
  sourceSizeBytes: number
  sourceStartSeconds?: number
  timestamp: string
}

interface Window {
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions
  ) => Promise<FileSystemFileHandle[]>
  stepform?: {
    open: (id: string) => void
  }
  __LOCAL_VIDEO_EDITOR_FILE_DEBUG__?: unknown
  __LOCAL_VIDEO_EDITOR_PROXY_DEBUG__?: {
    active: Record<string, LocalVideoEditorProxyDebugEntry>
    history: LocalVideoEditorProxyDebugEntry[]
  }
}

interface FileSystemFileHandle {
  readonly name: string
  createWritable?: () => Promise<FileSystemWritableFileStream>
  getFile(): Promise<File>
  queryPermission?: (descriptor?: {
    mode?: "read" | "readwrite"
  }) => Promise<PermissionState>
  requestPermission?: (descriptor?: {
    mode?: "read" | "readwrite"
  }) => Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemDirectoryHandle>
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemFileHandle>
  removeEntry: (
    name: string,
    options?: { recursive?: boolean }
  ) => Promise<void>
}

interface FileSystemWritableFileStream
  extends WritableStream<import("mediabunny").StreamTargetChunk> {
  readonly __fileSystemWritableFileStreamBrand?: never
}

interface StorageManager {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemFileHandle | null>
}

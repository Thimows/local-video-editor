type FilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

type OpenFilePickerOptions = {
  multiple?: boolean
  types?: FilePickerAcceptType[]
}

interface Window {
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions
  ) => Promise<FileSystemFileHandle[]>
  __LOCAL_VIDEO_EDITOR_FILE_DEBUG__?: unknown
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

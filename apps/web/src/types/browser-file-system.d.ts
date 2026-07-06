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
}

interface FileSystemFileHandle {
  readonly name: string
  getFile(): Promise<File>
  queryPermission?: (descriptor?: {
    mode?: "read" | "readwrite"
  }) => Promise<PermissionState>
  requestPermission?: (descriptor?: {
    mode?: "read" | "readwrite"
  }) => Promise<PermissionState>
}

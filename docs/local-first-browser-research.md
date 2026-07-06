# Local-first browser research

This app should behave like an installed local editor while staying inside the
browser sandbox. The practical architecture is a layered local model:

- Store project edit decisions and `FileSystemFileHandle`s in IndexedDB.
- Restore handles on project load with `queryPermission({ mode: "read" })`.
- Ask again with `requestPermission({ mode: "read" })` from a user gesture when
  the browser requires it.
- Use `showOpenFilePicker()` for imports where supported.
- Use `DataTransferItem.getAsFileSystemHandle()` for drag/drop imports where
  supported, so dropped files can persist across reloads too.
- Use `navigator.storage.persist()` to reduce the chance of browser eviction for
  local project metadata and OPFS working files.
- Use OPFS for temporary render chunks, generated cache data, thumbnails,
  waveforms, and later export intermediates.
- Keep source media as local files/handles. Do not copy full source media into
  IndexedDB or React state.

## Export direction

The current WebM export is a browser-native MVP. The longer-term local export
engine should move to a worker pipeline:

1. File handles / Blob slices as source readers.
2. Container demuxer for MP4/WebM.
3. WebCodecs decoders/encoders where supported.
4. Web Audio or AudioData mixer.
5. Muxer that writes progressively to OPFS or a user-selected writable file.
6. Download fallback for browsers without writable file streams.

WebCodecs is the right primitive for modern local media processing, but it does
not demux or mux containers by itself. A real export engine needs explicit
demux/mux libraries around it.

## Sources checked

- MDN File System API:
  https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN `DataTransferItem.getAsFileSystemHandle()`:
  https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle
- MDN `StorageManager.persist()`:
  https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- Chrome File System Access API:
  https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- MDN WebCodecs API:
  https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN PWA offline/background operation:
  https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation

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
- Keep source media as local files/handles. Eligible file blobs may be kept in
  IndexedDB as a fallback where local file handles cannot be restored. Files larger than the persistence limit remain
  dependent on the original files and permissions.

## Current export pipeline

The editor exports MP4 (H.264/AAC) or WebM (VP9/Opus), subject to the browser's
available encoders. The implementation in `apps/web/src/lib/editor/render-engine/`
uses Mediabunny for decoding, encoding, and muxing, Canvas for video composition,
and Web Audio for audio mixing.

Output streams to temporary OPFS files where available, with an in-memory buffer
fallback. Successful exports become downloadable files and temporary resources
are cleaned up when no longer needed. Segmented preview proxies are generated
and cached separately for editor playback. Waveform generation uses a worker.

WebCodecs supplies codec primitives, while Mediabunny handles the container
operations around them. Media processing runs locally in the browser.

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

import type { Project, ProjectSummary, ProjectUndoHistoryRecord } from "./types"

const DB_NAME = "local-video-editor"
const DB_VERSION = 2
const PROJECT_STORE = "projects"
const PROJECT_UNDO_HISTORY_STORE = "projectUndoHistory"
const MAX_PERSISTED_FILE_BLOB_BYTES = 1024 * 1024 * 1024

function ensureBrowser() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("IndexedDB is not available in this browser.")
  }
}

function openDatabase(): Promise<IDBDatabase> {
  ensureBrowser()

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" })
      }

      if (!db.objectStoreNames.contains(PROJECT_UNDO_HISTORY_STORE)) {
        db.createObjectStore(PROJECT_UNDO_HISTORY_STORE, {
          keyPath: "projectId",
        })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return withNamedStore(PROJECT_STORE, mode, callback)
}

async function withNamedStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = callback(store)
    let result: T | undefined

    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => reject(request.error)
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = ((await withStore("readonly", (store) => store.getAll())) ??
    []) as Project[]

  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sourceAssetCount: project.sourceAssets.length,
      clipCount: project.clips.length,
      musicTrackCount: project.musicTracks.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string) {
  const project = ((await withStore("readonly", (store) => store.get(id))) ??
    null) as Project | null

  return project ? normalizeProjectSourceAssets(project) : null
}

export async function saveProject(project: Project) {
  await withStore("readwrite", (store) =>
    store.put(normalizeProjectForStorage(project))
  )
}

export async function deleteProject(id: string) {
  await withStore("readwrite", (store) => store.delete(id))
  await deleteProjectUndoHistory(id)
}

export async function getProjectUndoHistory(projectId: string) {
  const history =
    ((await withNamedStore(
      PROJECT_UNDO_HISTORY_STORE,
      "readonly",
      (store) => store.get(projectId)
    )) as ProjectUndoHistoryRecord | undefined) ?? null

  return history
}

export async function saveProjectUndoHistory(
  history: ProjectUndoHistoryRecord
) {
  await withNamedStore(PROJECT_UNDO_HISTORY_STORE, "readwrite", (store) =>
    store.put({
      ...history,
      updatedAt: Date.now(),
    })
  )
}

export async function deleteProjectUndoHistory(projectId: string) {
  await withNamedStore(PROJECT_UNDO_HISTORY_STORE, "readwrite", (store) =>
    store.delete(projectId)
  )
}

function normalizeProjectForStorage(project: Project): Project {
  return {
    ...normalizeProjectSourceAssets(project),
    updatedAt: Date.now(),
  }
}

function normalizeProjectSourceAssets(project: Project): Project {
  return {
    ...project,
    sourceAssets: project.sourceAssets.map((asset) => ({
      ...asset,
      fileBlob:
        asset.fileBlob && asset.fileBlob.size <= MAX_PERSISTED_FILE_BLOB_BYTES
          ? asset.fileBlob
          : undefined,
    })),
  }
}

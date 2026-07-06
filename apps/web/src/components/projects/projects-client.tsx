"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Film, FolderPlus, HardDrive, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import { createEmptyProject, formatDuration } from "@/lib/editor/project"
import { deleteProject, listProjects, saveProject } from "@/lib/editor/db"
import type { ProjectSummary } from "@/lib/editor/types"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

export function ProjectsClient() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [name, setName] = useState("Untitled project")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refreshProjects()
  }, [])

  async function refreshProjects() {
    try {
      setIsLoading(true)
      setProjects(await listProjects())
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load projects."
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function createProject() {
    const project = createEmptyProject(name.trim() || "Untitled project")
    await saveProject(project)
    router.push(`/projects/${project.id}`)
  }

  async function removeProject(id: string) {
    await deleteProject(id)
    await refreshProjects()
  }

  const totalAssets = useMemo(
    () =>
      projects.reduce((count, project) => count + project.sourceAssetCount, 0),
    [projects]
  )

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="size-4" />
          </span>
          Local Video Editor
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Local metadata</Badge>
          <ThemeToggle />
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8">
        <div className="grid gap-5 md:grid-cols-[1fr_22rem] md:items-end">
          <div className="space-y-3">
            <Badge variant="secondary" className="w-fit">
              {projects.length} projects · {totalAssets} local assets
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-normal">
                Projects
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Project metadata is saved in IndexedDB. Source videos and audio
                stay as local file handles when the browser supports it, so they
                can be restored after reload without uploading anything.
              </p>
            </div>
          </div>

          <form
            className="grid gap-2 rounded-lg border bg-card p-3"
            onSubmit={(event) => {
              event.preventDefault()
              createProject()
            }}
          >
            <label className="text-sm font-medium" htmlFor="project-name">
              New project
            </label>
            <div className="flex gap-2">
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" size="icon" aria-label="Create project">
                <FolderPlus />
              </Button>
            </div>
          </form>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3">
          {isLoading ? (
            <ProjectPlaceholder />
          ) : projects.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <div className="max-w-sm space-y-3">
                <HardDrive className="mx-auto size-8 text-muted-foreground" />
                <h2 className="text-lg font-medium">No projects yet</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Create a project, import local media, and the timeline
                  decisions will persist on this device.
                </p>
              </div>
            </div>
          ) : (
            projects.map((project) => (
              <article
                key={project.id}
                className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-medium">
                      {project.name}
                    </h2>
                    <Badge variant="outline">
                      Updated{" "}
                      {formatDuration((Date.now() - project.updatedAt) / 1000)}{" "}
                      ago
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {project.clipCount} clips · {project.musicTrackCount} music
                    tracks · {project.sourceAssetCount} source assets
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Delete project"
                    onClick={() => removeProject(project.id)}
                  >
                    <Trash2 />
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/projects/${project.id}`} />}
                  >
                    Open
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  )
}

function ProjectPlaceholder() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-24 rounded-lg border bg-muted/40" />
      ))}
    </div>
  )
}

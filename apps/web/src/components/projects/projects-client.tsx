"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconChevronRight as ChevronRight,
  IconCirclePlusFilled as Plus,
  IconDots as Dots,
  IconDatabaseFilled as HardDrive,
  IconHelpCircleFilled as HelpCircle,
  IconTrashFilled as Trash,
  IconVideoFilled as Film,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { type FormEvent, useEffect, useState } from "react"

import { AppSettingsMenu } from "@/components/app-settings-menu"
import { createEmptyProject } from "@/lib/editor/project"
import { deleteProject, listProjects, saveProject } from "@/lib/editor/db"
import type { ProjectSummary } from "@/lib/editor/types"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from "@workspace/ui/components/ui/dropdown"
import { MenuItem } from "@workspace/ui/components/ui/menu-item"
import { Tooltip } from "@workspace/ui/components/ui/tooltip"

export function ProjectsClient() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [name, setName] = useState("")
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [pendingDeleteProject, setPendingDeleteProject] =
    useState<ProjectSummary | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
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

  async function createProject(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    try {
      setIsCreating(true)
      const project = createEmptyProject(name.trim() || "Untitled project")
      await saveProject(project)
      setIsCreateDialogOpen(false)
      router.push(`/projects/${project.id}`)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create project."
      )
    } finally {
      setIsCreating(false)
    }
  }

  async function confirmDeleteProject() {
    if (!pendingDeleteProject) return

    try {
      setIsDeleting(true)
      await deleteProject(pendingDeleteProject.id)
      setPendingDeleteProject(null)
      await refreshProjects()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not delete project."
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <main className="flex h-svh min-h-[520px] w-full flex-col overflow-hidden bg-background p-3 pt-0 text-foreground">
      <header className="flex h-11 w-full shrink-0 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Film className="size-4" />
          </span>
          Local Video Editor
        </Link>
        <div className="flex items-center gap-2">
          <AppSettingsMenu tooltip="Settings" />
          <CreateProjectDialog
            name={name}
            open={isCreateDialogOpen}
            isCreating={isCreating}
            onNameChange={setName}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={createProject}
          />
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl bg-card">
        <div className="h-full overflow-y-auto px-4 pb-3 pt-8">
          <div className="mx-auto grid w-full max-w-4xl gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl font-semibold tracking-normal">
                  Projects
                </h1>
                <Tooltip
                  content={
                    "Source media stays local. Project metadata and edit decisions are saved in the browser."
                  }
                >
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-active/80 hover:text-foreground"
                    aria-label="Project storage info"
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {projects.length} {projects.length === 1 ? "project" : "projects"}{" "}
                saved on this device.
              </p>
            </div>

            {error ? (
              <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3">
              {isLoading ? (
                <ProjectPlaceholder />
              ) : projects.length === 0 ? (
                <div className="grid min-h-72 place-items-center rounded-xl bg-background p-8 text-center">
                  <div className="max-w-sm space-y-3">
                    <HardDrive className="mx-auto size-8 text-muted-foreground" />
                    <h2 className="text-lg font-medium">No projects yet</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Create a project, import local media, and the timeline
                      decisions will persist on this device.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setIsCreateDialogOpen(true)}
                    >
                      <Plus data-icon="inline-start" />
                      New project
                    </Button>
                  </div>
                </div>
              ) : (
                projects.map((project) => (
                  <article
                    key={project.id}
                    className="grid gap-3 rounded-xl bg-background px-4 py-4 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <h2 className="truncate text-sm font-medium">
                        {project.name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {project.clipCount} clips · {project.musicTrackCount}{" "}
                        music tracks · updated{" "}
                        {formatDistanceToNow(new Date(project.updatedAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <ProjectActionsMenu
                        onDelete={() => setPendingDeleteProject(project)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/projects/${project.id}`} />}
                        nativeButton={false}
                      >
                        Open
                        <ChevronRight data-icon="inline-end" />
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <DeleteProjectDialog
        project={pendingDeleteProject}
        isDeleting={isDeleting}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDeleteProject(null)
        }}
        onConfirm={confirmDeleteProject}
      />
    </main>
  )
}

function ProjectPlaceholder() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-24 rounded-xl bg-background" />
      ))}
    </div>
  )
}

function ProjectActionsMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <Tooltip content="Project actions">
        <span className="inline-flex">
          <DropdownTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Project actions"
              >
                <Dots />
              </Button>
            }
          />
        </span>
      </Tooltip>
      <DropdownContent align="end" className="z-[5010] w-40">
        <MenuItem index={0} icon={Trash} label="Delete" onSelect={onDelete} />
      </DropdownContent>
    </DropdownMenu>
  )
}

function DeleteProjectDialog({
  project,
  isDeleting,
  onOpenChange,
  onConfirm,
}: {
  project: ProjectSummary | null
  isDeleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="grid gap-4">
          <div className="grid gap-1.5 pr-8">
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This removes {project?.name ? `"${project.name}"` : "this project"}{" "}
              from this browser. Source media files stay on your device.
            </DialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={isDeleting}
              onClick={onConfirm}
            >
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateProjectDialog({
  name,
  open,
  isCreating,
  onNameChange,
  onOpenChange,
  onSubmit,
}: {
  name: string
  open: boolean
  isCreating: boolean
  onNameChange: (name: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Plus data-icon="inline-start" />
            New project
          </Button>
        }
      />
      <DialogContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-1.5 pr-8">
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Name the project before opening the editor.
            </DialogDescription>
          </div>
          <div className="grid gap-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="project-name"
            >
              Project name
            </label>
            <Input
              id="project-name"
              autoFocus
              placeholder="Untitled project"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isCreating}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import type { Metadata } from "next"

import { ProjectsClient } from "@/components/projects/projects-client"

export const metadata: Metadata = {
  title: "Projects | Local Video Editor",
  description:
    "Create, open, and manage local video editing projects in your browser. Source media stays on your computer, while project metadata and edit decisions are saved locally.",
  alternates: {
    canonical: "/projects",
  },
  openGraph: {
    title: "Local Video Editor Projects",
    description:
      "Create, open, and manage local-first browser video editing projects without uploading source media.",
    type: "website",
    url: "/projects",
  },
  twitter: {
    card: "summary_large_image",
    title: "Local Video Editor Projects",
    description:
      "Create, open, and manage local-first browser video editing projects without uploading source media.",
  },
}

type ProjectsPageProps = {
  searchParams: Promise<{
    new?: string | string[]
    create?: string | string[]
  }>
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams
  const newValue = Array.isArray(params.new) ? params.new[0] : params.new
  const createValue = Array.isArray(params.create)
    ? params.create[0]
    : params.create

  return (
    <ProjectsClient
      autoOpenCreateDialog={newValue === "1" || createValue === "1"}
    />
  )
}

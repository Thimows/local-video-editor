import { ProjectsClient } from "@/components/projects/projects-client"

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

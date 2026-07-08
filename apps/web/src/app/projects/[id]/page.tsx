import type { Metadata } from "next"

import { EditorClient } from "@/components/editor/editor-client"

export const metadata: Metadata = {
  title: "Video Editor Workspace | Local Video Editor",
  description:
    "Edit a local-first video project in the browser with timeline editing, private preview playback, and local export without uploading source media.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function ProjectPage() {
  return <EditorClient />
}

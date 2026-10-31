import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
  {
    // Fluid Functionalism registry components are installed as vendored UI
    // sources. Keep them typechecked where imported, but do not lint their
    // internal demo-library implementation details on every app check.
    ignores: [
      "src/components/ui/dropdown.tsx",
      "src/components/ui/menu-item.tsx",
      "src/components/ui/slider.tsx",
      "src/components/ui/tabs-subtle.tsx",
      "src/components/ui/tooltip.tsx",
      "src/lib/shape-context.tsx",
    ],
  },
  ...config,
]

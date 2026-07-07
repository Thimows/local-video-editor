import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
  {
    // Fluid Functionalism registry components are installed as vendored UI
    // sources. Keep them typechecked where imported, but do not lint their
    // internal demo-library implementation details on every app check.
    ignores: [
      "src/components/ask-user-questions.tsx",
      "src/components/chat-message.tsx",
      "src/components/color-picker.tsx",
      "src/components/file-thumbnail.tsx",
      "src/components/input-copy.tsx",
      "src/components/input-message.tsx",
      "src/components/ui/accordion.tsx",
      "src/components/ui/checkbox-group.tsx",
      "src/components/ui/dialog.tsx",
      "src/components/ui/dropdown.tsx",
      "src/components/ui/menu-item.tsx",
      "src/components/ui/mobile-drawer.tsx",
      "src/components/ui/radio-group.tsx",
      "src/components/ui/scroll-area.tsx",
      "src/components/ui/select.tsx",
      "src/components/ui/slider.tsx",
      "src/components/ui/switch.tsx",
      "src/components/ui/tabs.tsx",
      "src/components/ui/tabs-subtle.tsx",
      "src/components/ui/thinking-steps.tsx",
      "src/components/ui/tooltip.tsx",
      "src/hooks/use-merge-split.tsx",
      "src/lib/icon-context.tsx",
      "src/lib/icon-map.tsx",
      "src/lib/shape-context.tsx",
    ],
  },
  ...config,
]

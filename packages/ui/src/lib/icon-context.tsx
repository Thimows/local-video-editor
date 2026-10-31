"use client"

import {
  iconMap,
  type IconComponent,
  type IconName,
} from "@workspace/ui/lib/icon-map"

export type { IconComponent, IconName } from "@workspace/ui/lib/icon-map"

// Shared components resolve icons from the same Tabler map without a provider.
export function useIcon(name: IconName): IconComponent {
  return iconMap[name]
}

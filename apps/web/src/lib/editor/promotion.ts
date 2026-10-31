// Replace the placeholder content, then set enabled to true to show the editor card.
// Keep icon paths local to apps/web/public.
export const EDITOR_PROMOTION = {
  enabled: false,
  id: "placeholder",
  name: "Your promotion",
  url: "https://example.com",
  lightIcon: "/landing/brands/promotion-placeholder.svg",
  darkIcon: "/landing/brands/promotion-placeholder.svg",
  taglines: [
    { id: "placeholder", text: "A space for a future sponsor or project." },
  ],
} as const

// Update this promotion's content, then set enabled to true to show the editor card.
// Keep icon paths local to apps/web/public.
export const EDITOR_PROMOTION = {
  enabled: false,
  id: "stepform",
  name: "Stepform",
  url: "https://stepform.ai/?ref=local-video-editor&utm_source=localvideoeditor.com&utm_medium=editor_promo&utm_campaign=local_video_editor",
  lightIcon: "/landing/brands/stepform-icon-black.svg",
  darkIcon: "/landing/brands/stepform-icon-white.svg",
  taglines: [
    { id: "ai_lead_funnels", text: "Build multi-step lead funnels with AI" },
    { id: "video_voice_responses", text: "Collect video and voice responses" },
    {
      id: "partial_response_capture",
      text: "Capture partial responses automatically",
    },
    {
      id: "structured_response_data",
      text: "Turn form responses into structured data",
    },
    {
      id: "automatic_lead_enrichment",
      text: "Enrich every new lead automatically",
    },
    {
      id: "smart_conditional_routing",
      text: "Route leads with smart conditional logic",
    },
    { id: "ai_chat_builder", text: "Build polished forms by chatting with AI" },
    { id: "visual_canvas_builder", text: "Create forms on a visual canvas" },
    { id: "response_pipeline", text: "Manage every response in your pipeline" },
    { id: "form_follow_up", text: "Automate follow-up from every form" },
  ],
} as const

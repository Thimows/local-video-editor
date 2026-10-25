# Local Video Editor

A simple, local-first video editor that runs entirely in the browser. It is
designed for quickly importing, arranging, trimming, previewing, and exporting
video and audio without uploading source files to a server.

## What it can do

- Import local video and audio files with the browser file picker or drag and drop.
- Arrange and trim clips on a multi-track timeline.
- Adjust clip volume, scale, and position.
- Add and mix separate music tracks.
- Preview edits using local media and generated preview proxies.
- Export MP4 or WebM locally with configurable resolution, frame rate, and compression.
- Save projects and undo history in the browser.
- Continue working offline after the application has been loaded.

## Local-first architecture

There is no application backend, account system, or cloud media pipeline. Source
media remains on the user's device.

- Project data, file handles, eligible browser-local file blobs, settings, and
  undo history are stored in IndexedDB.
- The File System Access API is used to reconnect local files where supported.
- Generated preview proxies and temporary export files use the Origin Private
  File System (OPFS).
- Preview and export processing happens in the browser with WebCodecs, Canvas,
  Web Audio, and Mediabunny.
- A service worker supports the offline-first experience.

Chromium-based browsers provide the best support for the required browser APIs.
Projects are local to the browser profile in which they were created.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript 6
- Tailwind CSS 4
- Mediabunny for media conversion, encoding, decoding, and muxing
- IndexedDB and OPFS for browser-local persistence
- Turborepo with npm workspaces

Node.js 24.22.1 LTS and npm 12.2.1 are required.

## Runtime and setup


Use Node.js 24.22.1 LTS and npm 12.2.1. The Node version is pinned in
`.nvmrc` and `.node-version`; `package.json` restricts the project to Node 24
and records the npm version. With nvm:

```bash
nvm install
nvm use
npm install --global npm@12.2.1
npm ci
```

Deployment environments should use Node 24.x. Keep `@types/node` on major 24
to match the runtime. ESLint stays on major 9 because `eslint-plugin-react`
does not support ESLint 10 yet. TypeScript stays on major 6 because
`typescript-eslint` does not support TypeScript 7 yet.

## Getting started

```bash
npm install
npm run dev
```

The web application lives in `apps/web`. No environment variables are required
for local development. Optional analytics variables are documented in
`apps/web/.env.example`; analytics remain disabled when no project token is set.

Useful commands:

```bash
npm run typecheck
npm run lint
npm run check
npm run build
```

Use `npm run typecheck` or `npm run lint` for targeted changes. `npm run check`
runs both across the workspace and is better suited to larger changes.

## Where to start

### Application and editor

- `apps/web/src/app/page.tsx`: landing page and entry point.
- `apps/web/src/app/projects/page.tsx`: local project list.
- `apps/web/src/app/projects/[id]/page.tsx`: editor route.
- `apps/web/src/components/editor/editor-client.tsx`: main editor UI, state,
  timeline interactions, preview coordination, and export workflow.

### Media and persistence

- `apps/web/src/lib/editor/types.ts`: core project, asset, timeline, and export types.
- `apps/web/src/lib/editor/db.ts`: IndexedDB projects, settings, and undo history.
- `apps/web/src/lib/editor/media.ts`: importing files, permissions, metadata, and
  restoring local file handles.
- `apps/web/src/lib/editor/preview-proxy.ts`: segmented local preview proxies.
- `apps/web/src/lib/editor/waveform.ts`: waveform generation and caching.
- `apps/web/src/lib/editor/render-engine/`: local video composition, audio mixing,
  encoding, muxing, and export output.
- `docs/local-first-browser-research.md`: architectural background and relevant
  browser APIs.

### Shared workspace packages

- `packages/ui`: shared UI components, styles, icons, and interaction primitives.
- `packages/eslint-config`: shared lint configuration.
- `packages/typescript-config`: shared TypeScript configuration.

## Notes for coding agents

Read `AGENTS.md` before making changes. This repository uses a newer Next.js
version whose bundled documentation should be consulted for framework-specific
work.

The central product constraint is local-first operation. Avoid introducing file
uploads, server-side media processing, or mandatory accounts unless the product
direction explicitly changes. Browser media APIs vary by codec and platform, so
keep unsupported-browser and unsupported-codec failure paths clear to users.

For editor behavior, begin with `editor-client.tsx`, then follow calls into
`src/lib/editor`. Keep project persistence, runtime object URLs, preview proxies,
and export cleanup in mind when changing media lifecycles.

## Optional Stepform and analytics integration

The editor promotion is disabled, and the landing-page Stepform credit has been
removed. The project still includes an optional Stepform feedback popup. The popup
is loaded in `apps/web/src/app/layout.tsx` and opened from the application
settings menu. PostHog integration is optional and does nothing unless a public
project token is configured.

## Editor promotion

The editor sidebar ad is disabled by default. To show a new promotion, update
`apps/web/src/lib/editor/promotion.ts` with the brand ID, name, destination URL,
light/dark icons, and taglines, then set `enabled` to `true`. Icon paths should
point to files in `apps/web/public`. Rebuild and deploy to apply the change.
Set `enabled` back to `false` to hide the card without leaving an empty slot.

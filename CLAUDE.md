# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (Next.js 16 + Turbopack) at localhost:3000
pnpm build        # Production build (standalone output for non-Vercel)
pnpm start        # Start production server
pnpm lint         # ESLint
pnpm check        # Prettier check
pnpm format       # Prettier auto-fix
```

There is no test suite. CI runs `prettier --check`, `eslint`, and `tsc --noEmit`.

Workspace packages (`packages/mathml2omml`, `packages/pptxgenjs`) are built automatically via `postinstall`.

## Architecture

Next.js 16 App Router application. React 19, TypeScript 5, Tailwind CSS 4, pnpm workspaces.

### Generation Pipeline (lib/generation/)

Two-stage pipeline that turns user requirements into a full classroom:

**Stage 1 — Outline Generation** (`outline-generator.ts`): Takes free-form requirements + optional PDF content → produces `SceneOutline[]` with types `slide | quiz | interactive | pbl`. Uses file-based markdown prompt templates under `lib/generation/prompts/templates/` with `{{snippet:name}}` composition and `{{variable}}` interpolation.

**Stage 2 — Scene Content + Actions** (`scene-generator.ts`, `scene-builder.ts`): Runs all scenes in parallel. For each outline: (1) `generateSceneContent()` produces slide elements, quiz questions, interactive HTML, or PBL content; (2) `generateSceneActions()` produces the action sequence (speech, whiteboard draws, spotlights, etc.).

`pipeline-runner.ts` orchestrates both stages with progress callbacks.

### Multi-Agent Orchestration (lib/orchestration/)

LangGraph `StateGraph` with two nodes: `director` → `agent_generate`, looping back to `director`.

- **Director node** (`director-graph.ts`): Decides which agent speaks next. Single-agent mode uses pure code logic; multi-agent uses LLM-based decision. Outputs `next_agent`, `USER`, or `END`.
- **Agent generate node**: Builds structured prompts, bridges Vercel AI SDK to LangChain via `AISdkLangGraphAdapter`, streams SSE events (`agent_start`, `text_delta`, `action`, `agent_end`). Uses incremental JSON parsing via `partial-json`.
- **Stateless design**: Zero server state between requests. All history, director state, and agent configs travel in `StatelessChatRequest`.

Agent registry (`lib/orchestration/registry/`): Zustand store with localStorage persistence. Ships 6 default agents; generated agents stored in IndexedDB per stage.

### Playback Engine (lib/playback/)

State machine (`engine.ts`) with modes: `idle → playing ⇄ paused`, plus `live` mode for real-time chat.

Consumes `Scene.actions[]` sequentially: speech (TTS audio or browser Web Speech with Chrome 15s workaround), spotlight/laser (fire-and-forget with 5s auto-clear), discussion (proactive card → live mode), whiteboard (synchronous with animation delays). Supports pause/resume, user interrupts, and snapshot persistence.

`derived-state.ts` exports `computePlaybackView()` — a pure function deriving UI state from ~15 raw variables.

### Action Engine (lib/action/)

`ActionEngine` class — unified execution layer for both streaming and playback paths:
- **Fire-and-forget**: `spotlight`, `laser`
- **Synchronous**: All whiteboard actions (`wb_open/draw_text/draw_shape/draw_chart/draw_latex/draw_table/draw_line/clear/delete/close`), `speech`, `play_video`, `discussion`

Action types defined in `lib/types/action.ts` as a discriminated union with categories `FIRE_AND_FORGET_ACTIONS` and `SYNC_ACTIONS`.

### State Management (Zustand)

All stores use `createSelectors()` wrapper enabling `store.use.xxx()` syntax.

| Store | Persistence | Purpose |
|-------|-------------|---------|
| `useStageStore` | IndexedDB (Dexie, debounced 500ms) | Stage/scene/chat data, generation tracking |
| `useCanvasStore` | None | Editor UI state, viewport, toolbar, effects |
| `useSettingsStore` | localStorage | Provider configs, model selection, media toggles, locale |
| `useAgentRegistry` | localStorage | Agent configurations |
| `useSnapshotStore` | None | Undo/redo history |

### Provider System

**Client**: `useSettingsStore` holds `providersConfig: Record<ProviderId, ProviderSettings>`. On mount, `ServerProvidersInit` fetches `GET /api/server-providers` and merges server flags.

**Server**: `lib/server/provider-config.ts` loads from YAML (`server-providers.yml`) then env vars (env overrides YAML per-field). `resolveApiKey/resolveBaseUrl/resolveProxy` resolve client key > server key > empty.

**Model creation**: `lib/ai/providers.ts` → `getModel()` switches on `ProviderType` (`openai | anthropic | google`) to create `LanguageModel` via `@ai-sdk/*` SDKs. OpenAI-compatible providers (DeepSeek, Qwen, Kimi, GLM, SiliconFlow, Doubao, openai-compatible) use the `openai` adapter with a custom fetch wrapper for vendor-specific thinking params.

**Model resolution for API routes**: `lib/server/resolve-model.ts` reads `x-model`, `x-api-key`, `x-base-url` headers.

### Key Types (lib/types/)

- `Stage` → `Scene[]` → `SceneContent` (union of slide/quiz/interactive/pbl) + `Action[]`
- `Action` — discriminated union of 15+ action types
- Slide elements: `PPTTextElement`, `PPTImageElement`, `PPTShapeElement`, `PPTLineElement`, `PPTChartElement`, `PPTTableElement`, `PPTLatexElement`, `PPTVideoElement`
- `ProviderId = BuiltInProviderId | 'custom-${string}'`, `ProviderType = 'openai' | 'anthropic' | 'google'`

### API Routes (app/api/)

Main endpoints: `/api/chat` (SSE streaming multi-agent), `/api/generate/scene-outlines-stream`, `/api/generate/scene-content`, `/api/generate/scene-actions`, `/api/generate-classroom` (async job + polling), `/api/generate/tts`, `/api/generate/image`, `/api/generate/video`, `/api/quiz-grade`, `/api/parse-pdf`, `/api/web-search`, `/api/transcription`, `/api/pbl/chat` (MCP tools), `/api/verify-model`.

All routes have 300s max duration (vercel.json).

### Workspace Packages (packages/)

- **mathml2omml**: MathML → Office Math Markup Language conversion (for PPTX LaTeX export)
- **pptxgenjs**: PowerPoint PPTX generation (forked from gitbrent/PptxGenJS)

Both built with Rollup, referenced as `workspace:*`, transpiled via `next.config.ts`.

### i18n (lib/i18n/)

Two locales: `zh-CN` (default), `en-US`. Simple key-value lookup via `translate(locale, key)`. React hook: `useI18n`. Translations split across domain files: `common`, `stage`, `chat`, `generation`, `settings`.

## Configuration

- `@/*` path alias maps to project root
- shadcn/ui with `radix-vega` style, RSC enabled, Tailwind v4
- Prettier: 100 char width, 2-space indent, single quotes, trailing commas
- ESLint ignores `packages/**`, `.claude/**`, `.worktrees/**`

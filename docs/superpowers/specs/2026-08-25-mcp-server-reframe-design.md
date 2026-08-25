# MCP Server Reframe — Design Spec

**Date:** 2026-08-25
**Status:** Approved for planning
**Branch base:** `origin/main` (after PR #6 cleanup merges)

## Context

Today the app is a NestJS **REST API** that is a *client* of Swiggy's Food MCP
server. The ranking engine (`SuggestionsService` + `AccountProfileService` +
`RankingService`/`ReorderRankingService`) is the product; REST is just one
doorway to it. To make the agent composable — callable by Claude and other
agents — we add a second doorway: an **MCP server** that exposes the same engine
as tools.

The app therefore becomes **both sides of MCP at once**: an MCP *server* upstream
(to agents, over stdio) and, unchanged, an MCP *client* downstream (to Swiggy,
over streamable-HTTP + OAuth).

### Decisions locked during brainstorming

1. **Transport:** local **stdio**, single user (the authenticated Swiggy
   session). Claude Desktop / Claude Code launches the server as a subprocess.
   Not remote/multi-user.
2. **Login UX:** an **`authenticate` MCP tool** drives the one-time Swiggy
   browser login from inside the MCP session.
3. **Structure:** **Approach A** — a new stdio entrypoint over the *shared*
   service core; the existing REST app is left intact as an alternate doorway.
4. **`userId`:** dropped from every tool signature; the server keys feedback to a
   single fixed local id internally (Mongo schema unchanged).
5. **MongoDB:** made **optional** — feedback persistence degrades gracefully so
   suggestions/cart work with no Mongo.

## Goals

- Expose the ranking engine as a local stdio MCP server with a clean tool surface.
- One-time Swiggy login via an `authenticate` tool, with **tokens persisted to
  disk** so a fresh stdio process survives restarts within Swiggy's 5-day token
  window.
- Keep mock-vs-real swappability: the full tool surface works offline in mock mode.
- Zero regressions to the existing REST app and its tests.

## Non-goals (remain follow-ups)

- Ordering — `place_food_order` stays out of scope ("conclude at cart").
- Remote/multi-user HTTP transport, per-session isolation, hosting.
- Learned ranking weights, cold-start onboarding Q&A, variant/add-on handling.
- Swapping the feedback datastore off MongoDB.

## Architecture

```
Claude / agent
      │  (MCP, stdio, JSON-RPC)
      ▼
┌─────────────────────────────────────────────┐
│  src/mcp-server/main.ts   (NEW entrypoint)   │
│  NestFactory.createApplicationContext(       │
│      AppModule, { logger: false })           │
│  → resolves existing providers from DI:      │
│      SuggestionsService                       │
│      McpSessionFactory / OAuthStateStore     │
│      SWIGGY_MCP_CLIENT (getAddresses)        │
│  → McpServer + StdioServerTransport          │
└─────────────────────────────────────────────┘
      │  (unchanged service calls)
      ▼
  SuggestionsService ── SwiggyMcpClient (mock | real)
                              │  (real: streamable-HTTP + OAuth)
                              ▼
                        Swiggy Food MCP
```

- **No new business logic.** Tool handlers are thin adapters over existing
  service methods — the same calls the REST controller makes today.
- `createApplicationContext` starts **no HTTP listener**. The REST app
  (`src/main.ts`) is untouched and still runnable.

### Critical stdio constraint

stdout carries the JSON-RPC stream. Therefore:
- Nest logger disabled (`{ logger: false }`).
- Every diagnostic/`console.*` in the MCP path writes to **stderr**.
- No stray stdout writes anywhere on the server path.

## Tool surface

All inputs validated with zod. No `userId` field on any tool.

| Tool | Input | Returns | Wraps |
|---|---|---|---|
| `authenticate` | — | `{ authenticated: boolean, message: string }` | OAuth flow (see below); no-op if a valid token already exists |
| `get_suggestions` | `{ addressId?: string }` | `{ reorder: ReorderSuggestion[], discover: RankedSuggestion[] }` | `SuggestionsService.getTopSuggestions(FIXED_ID, addressId)` |
| `surprise_cart` | `{ addressId?: string }` | `{ picked, cart }` | `SuggestionsService.surpriseToCart(FIXED_ID, addressId)` |
| `list_addresses` | — | `SwiggyAddress[]` | `SWIGGY_MCP_CLIENT.getAddresses()` |
| `accept_suggestion` | `{ restaurantId: string, itemIds: string[] }` | `{ recorded: boolean, note?: string }` | `SuggestionsService.acceptSuggestion(FIXED_ID, …)` |
| `skip_suggestion` | `{ restaurantId: string }` | `{ recorded: boolean, note?: string }` | `SuggestionsService.skipSuggestion(FIXED_ID, …)` |

`FIXED_ID` = `ConfigService.get('DEFAULT_USER_ID')` (default `dj`). The Swiggy
identity is the OAuth session; `FIXED_ID` only partitions the local feedback store.

Each tool result is returned as MCP `content` (JSON serialized in a text block);
`isError: true` is set on the failure paths below.

## Auth: `authenticate` tool + token persistence

### The `authenticate` tool (new helper `src/mcp-server/authenticate.ts`)

Reuses the existing `McpSessionFactory` primitives (no reimplementation of the
OAuth/PKCE/DCR flow, which the SDK + `SwiggyOAuthProvider` already own):

1. If `store.isAuthenticated()` → return `{ authenticated: true, message: 'already authenticated' }`.
2. In **mock mode** (`USE_MOCK_MCP=true`) → return success no-op (no Swiggy needed).
3. `const url = await sessions.beginAuth()` — SDK drives discovery + DCR + PKCE and
   yields the Swiggy authorization URL; `store.state` is set for CSRF.
4. Start a **temporary** HTTP listener bound to the redirect-URI host/port
   (`SWIGGY_OAUTH_REDIRECT_URI`, e.g. `http://localhost:3000/oauth/callback`),
   serving only that one path.
5. Open the browser to `url` (best-effort `open`/`xdg-open`/`start` via
   `child_process`); also include `url` in a progress/log line on stderr and in
   the eventual result so the user can click it manually.
6. On callback: validate `state` (must equal `store.state`, single-use — mirrors
   `oauth.controller.callback`), then `await sessions.completeAuth(code)`.
7. Tear down the temporary listener. Return `{ authenticated: true, message }`.
8. Timeout (e.g. 3 min) → tear down, return an error result telling the user to
   retry `authenticate`.

The listener lives **only** for the duration of a login; the server has no
always-on HTTP surface otherwise.

### Persistent `OAuthStateStore`

`OAuthStateStore` gains disk persistence so a freshly-launched stdio process
reuses a still-valid token instead of forcing re-login every session:

- **Persisted:** `clientInfo` (DCR registration) and `tokens`.
- **Transient (in-memory only):** `codeVerifier`, `pendingAuthUrl`, `state`.
- **Path:** `SWIGGY_TOKEN_STORE_PATH` env, default `~/.smart-order-agent/oauth.json`.
- **Perms:** file created mode `0600`; parent dir `0700`.
- **Load:** on construction (best-effort; corrupt/missing file → start unauthenticated).
- **Write:** whenever `tokens` or `clientInfo` is set (the SDK calls
  `saveTokens`/`saveClientInformation` via `SwiggyOAuthProvider`).
- **Delete:** on `clear()` / token invalidation.

Tokens are a Swiggy access credential; `0600` local-file storage is the baseline.
Encryption-at-rest is a possible later hardening, out of scope here.

## Feedback identity + graceful Mongo degradation

In **real mode**, order history comes from Swiggy (`get_food_orders` via
`AccountProfileService`); Mongo is used **only** for skip/accept feedback
(`rejectedRestaurantIds` and recording). So Mongo being down only costs the
skip-penalty signal.

- `PreferencesService.getProfile` — wrap the Mongo reads; on failure return a
  profile with empty `rejectedRestaurantIds` (and empty counts), so ranking falls
  back to price-fit/recency. `get_suggestions`/`surprise_cart` fully functional.
- `PreferencesService.recordFeedback` — on failure return a soft result; the
  `accept_suggestion`/`skip_suggestion` tools surface
  `{ recorded: false, note: 'feedback not persisted (store offline)' }`.
- Mongoose connection configured **non-fatal**: a missing/unreachable Mongo must
  not crash or hang the stdio bootstrap.

Mock mode already needs no Mongo for suggestions; this makes real mode equally
robust to a missing store.

## Error handling

- **Not authenticated (real mode):** Swiggy-touching tools (`get_suggestions`,
  `surprise_cart`, `list_addresses`) catch `UnauthorizedException` /
  `UnauthorizedError` and return `isError: true` with:
  *"Not authenticated with Swiggy — call the `authenticate` tool first."*
- **Mock mode:** entire tool surface works offline; `authenticate` is a success
  no-op.
- **Cart/customization rejections** (`surprise_cart`): existing behavior — the
  service surfaces the error; the tool returns it as an error result, never a
  wrong cart.

## Testing

Unit tests (Jest, existing harness), no live network:

1. **Tool handlers** against a fake service layer:
   - each tool maps service output → the documented result shape;
   - not-authenticated path returns the auth-error result (`isError`);
   - feedback-offline path returns the degraded `{ recorded: false, note }`.
2. **Persistent store:** save tokens → construct a new instance pointed at the
   same temp path → `isAuthenticated()` true and `clientInfo` restored;
   `clear()` deletes the file; corrupt file → starts unauthenticated.
3. **Mock end-to-end-ish:** wire the real `SuggestionsService` with the existing
   `MockSwiggyMcpClient` and assert `get_suggestions` / `surprise_cart` tool
   outputs (reuses existing mock fixtures).
4. **Regression:** existing REST + service tests stay green (services untouched).

Diagnostics-on-stderr and no-stdout-noise are verified by asserting the stdio
transport path writes nothing to stdout outside JSON-RPC (lightweight check /
manual smoke).

## New dependencies, files, scripts

**Dependencies:**
- `zod` — `McpServer` tool input schemas.
- Browser open — a ~3-line `child_process` helper (`open`/`xdg-open`/`start`);
  no new dependency.
- `@modelcontextprotocol/sdk` — already present (server + stdio transport).

**New files:**
- `src/mcp-server/main.ts` — stdio entrypoint (headless Nest context + McpServer).
- `src/mcp-server/tools.ts` — tool registration/handlers.
- `src/mcp-server/authenticate.ts` — one-time login helper (temp callback listener).
- `src/mcp-server/*.spec.ts` — tool + auth tests.

**Modified files:**
- `src/mcp/oauth/oauth-state.store.ts` — disk persistence.
- `src/preferences/preferences.service.ts` — graceful degradation.
- `src/app.module.ts` — non-fatal Mongoose connection.
- `.env.example` — `SWIGGY_TOKEN_STORE_PATH` (optional).
- `package.json` — `"mcp": "ts-node src/mcp-server/main.ts"` (and built variant).
- `README.md` — "Use it as an MCP server" section + Claude Desktop config snippet.

**Claude Desktop config snippet (README):**
```json
{
  "mcpServers": {
    "smart-order-agent": {
      "command": "node",
      "args": ["/abs/path/to/dist/mcp-server/main.js"],
      "env": { "USE_MOCK_MCP": "false" }
    }
  }
}
```

## Rollout

1. Persistent `OAuthStateStore` + tests.
2. Graceful Mongo degradation + tests.
3. `authenticate` helper + tests.
4. Tool registration + stdio entrypoint + tests.
5. `package.json` script, `.env.example`, README section.
6. Manual smoke: mock mode (no Swiggy/Mongo), then real mode (authenticate → tools).
7. `graphify update .`

After this lands and both `authenticate`→tools and mock-mode smoke pass, we
re-evaluate the Swiggy production-access request (hosting + data/privacy
declaration are the remaining gap there, not the app's behavior).

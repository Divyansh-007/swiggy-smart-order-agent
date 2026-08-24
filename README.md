# Smart Order Agent

Ranks Swiggy Food options against your own order history so you get a
top-5 shortlist instead of scrolling for an hour deciding what to eat.

Built for the [Swiggy Builders program](https://mcp.swiggy.com/builders). It talks
to the **real Swiggy Food MCP server** over OAuth 2.1 + PKCE — or a drop-in mock
so it runs fully offline. The two are interchangeable behind one interface
(`src/mcp/mcp-client.interface.ts`); flip `USE_MOCK_MCP` to switch.

## How it works

1. `PreferencesService` builds a lightweight profile from your order history in
   MongoDB — cuisine frequency, average order value, time-of-day patterns, and
   recently-skipped restaurants.
2. `SuggestionsService` resolves your Swiggy delivery address, searches the Food
   MCP server for your top cuisines (widening to a broad "popular" search when
   the pool is thin), and merges the candidates.
3. `RankingService` scores each candidate against your profile:
   frequency + time-of-day match + price fit − repeat-fatigue penalty −
   recent-rejection penalty, plus a small rating tie-breaker. One of the 5 slots
   is reserved for an "explore" pick — new to you, but in a cuisine you already
   like. Every suggestion carries a one-line "why".
4. You accept or skip via the API (feedback feeds back into future ranking).

The deterministic ranking engine is the point — this is recommender-system
reasoning over your context, not an LLM tool-dispatch loop.

## Run it locally

```bash
cp .env.example .env
npm install

# needs a local MongoDB, e.g.:  docker run -d -p 27017:27017 --name mongo mongo:7
npm run seed        # loads sample order history for userId "dj"
npm run start:dev   # http://localhost:3000
```

### Mock mode (default — no Swiggy account needed)

`USE_MOCK_MCP=true` (the default) serves canned restaurants, so the whole
pipeline runs offline:

```bash
curl "http://localhost:3000/suggestions?userId=dj"
```

Returns a top-5 shortlist ranked against the seeded history, each with a reason.

### Real Swiggy mode

Set `USE_MOCK_MCP=false`, start the app, then complete the one-time browser login
(OAuth 2.1 + PKCE with phone + OTP):

```
open http://localhost:3000/oauth/login       # phone + OTP in the browser
curl  http://localhost:3000/oauth/status      # {"authenticated":true}
curl "http://localhost:3000/suggestions?userId=dj"   # ranked over REAL nearby restaurants
```

Auth uses the MCP SDK's native `OAuthClientProvider`, so **Dynamic Client
Registration, `.well-known` discovery, and PKCE are handled by the SDK** — there
is no static client id/secret to configure. Access tokens last 5 days (no refresh
token in Swiggy v1.0); re-run `/oauth/login` when a call returns 401.

## Endpoints

- `GET /suggestions?userId=&addressId=` — top-5 ranked suggestions with reasons.
  `addressId` is optional (defaults to your first saved Swiggy address).
- `POST /suggestions/accept` — `{ userId, restaurantId, itemIds }`. Records
  positive feedback. **Does not place an order yet** — see the roadmap.
- `POST /suggestions/skip` — `{ userId, restaurantId }`. Records negative feedback.
- `GET /oauth/login|callback|status` — the OAuth browser bridge.

## Two notions of "user" (important)

There are two independent identities in this app, currently **decoupled**:

- **`userId`** (e.g. `dj`, from `DEFAULT_USER_ID`) — the key for the local
  preference store (order history + feedback in MongoDB) that ranking scores
  against. It is just a string partition key passed as `?userId=`; there is no
  local auth.
- **The Swiggy OAuth session** — the real authenticated Swiggy account (you, via
  phone + OTP) that supplies live restaurant data through MCP.

So `userId=dj` chooses *whose seeded taste* to rank, while the OAuth session
supplies *the live restaurants*. Fine for a single-user local demo; a production
version would bind them (map the authenticated Swiggy user to their own
preference record instead of a fixed `dj`).

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `USE_MOCK_MCP` | `true` = offline mock; `false` = real Swiggy MCP |
| `SWIGGY_MCP_BASE_URL` | `https://mcp.swiggy.com` |
| `SWIGGY_OAUTH_REDIRECT_URI` | `http://localhost:3000/oauth/callback` (exact-match) |
| `ALLOW_REAL_ORDERS` | reserved for the ordering roadmap (default `false`) |
| `DEFAULT_USER_ID` | demo preference-store user id (default `dj`) |
| `PORT` | HTTP port (default `3000`) |

## Known simplifications (good next steps)

- **`userId` vs Swiggy identity are not linked yet** (see above) — production would
  key preferences off the authenticated Swiggy user.
- Frequency score is overall cuisine frequency, not conditioned on time slot
  (doesn't yet learn "south Indian *for breakfast*" as distinct from "south Indian
  in general"). Worth splitting `cuisineCounts` by time slot.
- Ranking weights are hand-picked, not learned. A real version could fit them from
  accept/skip feedback over time.
- Cold-start (brand-new user, no history) falls back to rating + price-fit only —
  works, but not personalized. A short onboarding Q&A would fix it.
- Response adapters (`src/mcp/real/swiggy-response.adapter.ts`) are reconciled
  against captured live payloads; broaden coverage as more Swiggy fields are used.

## Roadmap — ordering (not built yet)

Placing a real order is deliberately deferred (it spends real money and is
non-idempotent). The interface already exposes `buildCart`/`placeOrder`, and the
plan (`docs/superpowers/plans/`) specs the full cart journey
(`update_food_cart` → `get_food_cart` → `place_food_order`) **double-gated** by
`ALLOW_REAL_ORDERS=true` **and** an explicit `confirm:true`, with a ₹1000 cap and a
non-idempotency guard.

## Architecture note

`SwiggyMcpClient` (`src/mcp/mcp-client.interface.ts`) is the only contract the rest
of the app depends on. `McpModule` picks `MockSwiggyMcpClient` or
`RealSwiggyMcpClient` (streamable-HTTP + the OAuth session) based on
`USE_MOCK_MCP`. Ranking, preferences, and the controller never touch MCP transport
details — so mock and real are fully swappable.

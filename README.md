# Smart Order Agent

A local **MCP server** that reads your **real Swiggy order history** and hands any
agent — Claude included — two short lists: the usuals worth re-ordering and new
places worth trying, instead of scrolling for an hour deciding what to eat.

Built for the [Swiggy Builders program](https://mcp.swiggy.com/builders). It's an
**MCP server on the front** (tools any MCP client can call) sitting on an **MCP
client underneath** — talking to the **real Swiggy Food MCP server** over
OAuth 2.1 + PKCE, or a drop-in mock so it runs fully offline. The two are
interchangeable behind one interface (`src/mcp/mcp-client.interface.ts`); flip
`USE_MOCK_MCP` to switch. (A REST API over the same engine is also available —
[see below](#also-available-a-rest-api).)

## How it works

The `get_suggestions` tool returns two ranked top-5 lists — **`reorder`** and
**`discover`**:

1. `AccountProfileService` builds a profile from your **real Swiggy order history**
   (`get_food_orders`) — per-restaurant order frequency, recency, average order
   value, time-of-day patterns, and the exact items to re-add — merged with local
   skip feedback. (In mock mode, synthetic history stands in.)
2. **`reorder`** — `ReorderRankingService` ranks the restaurants you actually order
   from (frequency + recency + price-fit − rejection penalty). Each pick carries the
   precise items to re-add to your cart.
3. **`discover`** — a hybrid search for *new* places: your frequent past **dish names**
   (pulled from those order items) plus a meal-time "popular" search, merged, with
   your known restaurants excluded, then scored by `RankingService` (price-fit +
   rating + an explore slot). Every suggestion carries a one-line "why".
4. You accept or skip (via the `accept_suggestion` / `skip_suggestion` tools) and
   the feedback feeds back into future ranking.

The deterministic ranking is the point — recommender-system reasoning over your
real order history, not an LLM tool-dispatch loop.

> Note: Swiggy's `get_food_order_details` doesn't expose per-order **cuisine** live,
> so `discover` personalizes by your past **dishes** rather than cuisine tags.

## Quickstart — connect it as an MCP server

The agent runs as a local **stdio MCP server**, so Claude (or any MCP client) can
call it as tools:

```bash
npm install
npm run build
# then point your MCP client at dist/mcp-server/main.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "smart-order-agent": {
      "command": "node",
      "args": ["/abs/path/to/smart-order-agent/dist/mcp-server/main.js"],
      "env": { "USE_MOCK_MCP": "false" }
    }
  }
}
```

| Tool | What it does |
|---|---|
| `authenticate` | One-time Swiggy login (phone + OTP in the browser). No-op if already signed in. |
| `get_suggestions` | Two ranked top-5 lists — `{ reorder, discover }` — from your order history. `addressId` optional. |
| `surprise_cart` | Randomly picks one suggestion and adds a single item to your **real Swiggy cart**. Stops at the cart. |
| `list_addresses` | Your saved Swiggy delivery addresses. |
| `accept_suggestion` | Records positive feedback (tunes future ranking). |
| `skip_suggestion` | Records negative feedback (tunes future ranking). |

- **Mock mode** (`USE_MOCK_MCP=true`, the default): the full tool surface works
  offline — no Swiggy account, no MongoDB. Great for trying the tools out.
- **Real mode** (`USE_MOCK_MCP=false`): call `authenticate` once (browser phone +
  OTP); the token is cached at `~/.smart-order-agent/oauth.json` and reused across
  restarts for ~5 days. `surprise_cart` **stops at the cart** — no order is placed.
- Feedback (`accept`/`skip`) uses MongoDB when available and degrades to a no-op
  notice when it isn't; suggestions and cart work either way.

Auth uses the MCP SDK's native `OAuthClientProvider`, so **Dynamic Client
Registration, `.well-known` discovery, and PKCE are handled by the SDK** — there is
no static client id/secret to configure. Access tokens last 5 days (no refresh
token in Swiggy v1.0); call `authenticate` again when a call returns 401.

## Also available: a REST API

The same engine is exposed over HTTP if you'd rather `curl` it than wire up an MCP
client.

```bash
cp .env.example .env
npm install

# optional: local MongoDB for accept/skip feedback
#   docker run -d -p 27017:27017 --name mongo mongo:7
npm run seed        # loads sample order history for userId "dj"
npm run start:dev   # http://localhost:3000
```

**Mock mode** (default — no Swiggy account needed):

```bash
curl "http://localhost:3000/suggestions?userId=dj"
```

**Real Swiggy mode** — set `USE_MOCK_MCP=false`, start the app, then complete the
one-time browser login:

```
open http://localhost:3000/oauth/login       # phone + OTP in the browser
curl  http://localhost:3000/oauth/status      # {"authenticated":true}
curl "http://localhost:3000/suggestions?userId=dj"
```

Endpoints:

- `GET /suggestions?userId=&addressId=` — `{ reorder, discover }`, two top-5 lists
  with reasons. `reorder` entries carry `items: [{ menuItemId, name, quantity }]`
  (the exact items to re-add). `addressId` is optional (defaults to your first
  saved Swiggy address).
- `POST /suggestions/surprise-cart` — `{ userId, addressId? }`. **"Surprise me":**
  randomly picks one suggestion (reorder *or* discover), adds **one item (qty 1)**
  to your **real Swiggy cart**, and returns `{ picked, cart }` (the cart carries a
  live `toPay`). It **stops at the cart** — no order is placed. You tap pay in the
  Swiggy app. (For a discover pick, it fetches the restaurant's menu and chooses an
  in-stock item without required variants/add-ons.)
- `POST /suggestions/accept` — `{ userId, restaurantId, itemIds }`. Records
  positive feedback.
- `POST /suggestions/skip` — `{ userId, restaurantId }`. Records negative feedback.
- `GET /oauth/login|callback|status` — the OAuth browser bridge.

## Two notions of "user" (important)

There are two identities in this app, still **partly decoupled**:

- **The Swiggy OAuth session** — the real authenticated Swiggy account (you, via
  phone + OTP). In real mode this supplies both the live restaurants **and your
  actual order history** (`get_food_orders`) that the ranking is built from.
- **`userId`** (e.g. `dj`, from `DEFAULT_USER_ID`) — a string partition key for the
  local **feedback** store (accept/skip) in MongoDB. Over MCP the server supplies it
  automatically; over REST it's passed as `?userId=`. There is no local auth.

So the order history is the authenticated account's real orders, but the local
skip/accept feedback is still keyed by a separate `userId`. Binding them fully
(feedback keyed to the Swiggy user) is the remaining production step.

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string (optional — feedback degrades gracefully without it) |
| `USE_MOCK_MCP` | `true` = offline mock; `false` = real Swiggy MCP |
| `SWIGGY_MCP_BASE_URL` | `https://mcp.swiggy.com` |
| `SWIGGY_OAUTH_REDIRECT_URI` | `http://localhost:3000/oauth/callback` (exact-match) |
| `SWIGGY_TOKEN_STORE_PATH` | where the MCP server caches the OAuth token (default `~/.smart-order-agent/oauth.json`) |
| `DEFAULT_USER_ID` | demo preference-store user id (default `dj`) |
| `PORT` | HTTP / OAuth-callback port (default `3000`) |

## Known simplifications (good next steps)

- **Local feedback isn't keyed to the Swiggy user yet** (see above) — production would
  key accept/skip off the authenticated Swiggy account.
- **`discover` personalizes by dish, not cuisine** — Swiggy's `get_food_order_details`
  returns no per-order cuisine live, so cuisine-based discovery isn't possible;
  dish-name search is the workaround. Mapping restaurants → cuisines via
  `search_restaurants` is a possible enrichment.
- Ranking weights are hand-picked, not learned. A real version could fit them from
  accept/skip feedback over time.
- Cold-start (no order history) falls back to a meal-time "popular" search — works,
  but not personalized. A short onboarding Q&A would fix it.
- Response adapters (`src/mcp/real/*.adapter.ts`) are reconciled against captured
  live payloads; broaden coverage as more Swiggy fields are used.
- **`surprise_cart` adds a single un-customized item** — it *prefers* an in-stock
  item with no required variants/add-ons and adds a bare `{menu_item_id, quantity}`.
  If a picked restaurant has only customizable items it falls back to one, which the
  cart API may reject (surfaced as an error, never a wrong cart). Handling required
  customizations is a follow-up.

## Conclude at cart (shipped)

`surprise_cart` (and its REST twin `POST /suggestions/surprise-cart`) **fills your
Swiggy cart and stops** — it never places an order. Building the cart
(`update_food_cart` → `get_food_cart`) spends nothing; **placing** an order
(`place_food_order` + payment) is deliberately out of scope, so there's no
real-money step. Verified end-to-end against live Swiggy (a discover pick → menu →
cart with a real `toPay`).

## Architecture note

`SwiggyMcpClient` (`src/mcp/mcp-client.interface.ts`) is the only contract the rest
of the app depends on. `McpModule` picks `MockSwiggyMcpClient` or
`RealSwiggyMcpClient` (streamable-HTTP + the OAuth session) based on `USE_MOCK_MCP`.
Both front doors — the MCP server (`src/mcp-server/`) and the REST controller — sit
on the same ranking/preferences services and never touch MCP transport details, so
mock and real are fully swappable and the two entrypoints stay in lockstep.

# Smart Order Agent

Looks at your **real Swiggy order history** and hands you two short lists — the
usuals worth re-ordering and new places worth trying — instead of scrolling for
an hour deciding what to eat.

Built for the [Swiggy Builders program](https://mcp.swiggy.com/builders). It talks
to the **real Swiggy Food MCP server** over OAuth 2.1 + PKCE — or a drop-in mock
so it runs fully offline. The two are interchangeable behind one interface
(`src/mcp/mcp-client.interface.ts`); flip `USE_MOCK_MCP` to switch.

## How it works

`GET /suggestions` returns two ranked top-5 lists — **`reorder`** and **`discover`**:

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
4. You accept or skip via the API (feedback feeds back into future ranking).

The deterministic ranking is the point — recommender-system reasoning over your
real order history, not an LLM tool-dispatch loop.

> Note: Swiggy's `get_food_order_details` doesn't expose per-order **cuisine** live,
> so `discover` personalizes by your past **dishes** rather than cuisine tags.

## Run it locally

```bash
cp .env.example .env
npm install

# needs a local MongoDB, e.g.:  docker run -d -p 27017:27017 --name mongo mongo:7
npm run seed        # loads sample order history for userId "dj"
npm run start:dev   # http://localhost:3000
```

### Mock mode (default — no Swiggy account needed)

`USE_MOCK_MCP=true` (the default) serves synthetic history + restaurants, so the
whole pipeline runs offline:

```bash
curl "http://localhost:3000/suggestions?userId=dj"
```

Returns `{ reorder: [...], discover: [...] }` ranked against the synthetic
history, each entry with a reason.

### Real Swiggy mode

Set `USE_MOCK_MCP=false`, start the app, then complete the one-time browser login
(OAuth 2.1 + PKCE with phone + OTP):

```
open http://localhost:3000/oauth/login       # phone + OTP in the browser
curl  http://localhost:3000/oauth/status      # {"authenticated":true}
curl "http://localhost:3000/suggestions?userId=dj"   # reorder + discover from YOUR real orders
```

Auth uses the MCP SDK's native `OAuthClientProvider`, so **Dynamic Client
Registration, `.well-known` discovery, and PKCE are handled by the SDK** — there
is no static client id/secret to configure. Access tokens last 5 days (no refresh
token in Swiggy v1.0); re-run `/oauth/login` when a call returns 401.

## Endpoints

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
  phone + OTP). In real mode this now supplies both the live restaurants **and your
  actual order history** (`get_food_orders`) that the ranking is built from.
- **`userId`** (e.g. `dj`, from `DEFAULT_USER_ID`) — a string partition key for the
  local **feedback** store (accept/skip) in MongoDB, passed as `?userId=`. There is
  no local auth.

So the order history is now the authenticated account's real orders, but the local
skip/accept feedback is still keyed by a separate `userId`. Binding them fully
(feedback keyed to the Swiggy user) is the remaining production step.

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
- **`surprise-cart` adds a single un-customized item** — it *prefers* an in-stock
  item with no required variants/add-ons and adds a bare `{menu_item_id, quantity}`.
  If a picked restaurant has only customizable items it falls back to one, which the
  cart API may reject (surfaced as an error, never a wrong cart). Handling required
  customizations is a follow-up.

## Conclude at cart (shipped)

`POST /suggestions/surprise-cart` **fills your Swiggy cart and stops** — it never
places an order. Building the cart (`update_food_cart` → `get_food_cart`) spends
nothing; **placing** an order (`place_food_order` + payment) is deliberately out of
scope, so there's no real-money step. Verified end-to-end against live Swiggy
(a discover pick → menu → cart with a real `toPay`).

## Architecture note

`SwiggyMcpClient` (`src/mcp/mcp-client.interface.ts`) is the only contract the rest
of the app depends on. `McpModule` picks `MockSwiggyMcpClient` or
`RealSwiggyMcpClient` (streamable-HTTP + the OAuth session) based on
`USE_MOCK_MCP`. Ranking, preferences, and the controller never touch MCP transport
details — so mock and real are fully swappable.

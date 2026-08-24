# Smart Order Agent

Ranks live Swiggy Food options against your own order history so you get a
top-5 shortlist instead of scrolling for an hour deciding what to eat.

Built for the Swiggy Builders program (mcp.swiggy.com/builders) — currently
wired against a **mocked** Swiggy MCP client so it runs fully offline. Swap
`MockSwiggyMcpClient` for a real client once you have MCP access; nothing
else in the app needs to change (see `src/mcp/mcp-client.interface.ts`).

## How it works

1. `PreferencesService` builds a lightweight profile from your order history
   in MongoDB — cuisine frequency, average order value, time-of-day patterns,
   and recently-skipped restaurants.
2. `SuggestionsService` calls the Swiggy Food MCP server (mocked for now) to
   get currently open, deliverable restaurants.
3. `RankingService` scores each candidate against your profile:
   frequency + time-of-day match + price fit − repeat-fatigue penalty −
   recent-rejection penalty, plus a small rating tie-breaker. One of the 5
   slots is reserved for an "explore" pick — new to you, but in a cuisine
   you already like.
4. You accept (places the order via MCP) or skip (recorded as negative
   signal, down-ranks similar options next time) via the API.

## Run it locally

```bash
cp .env.example .env
npm install

# needs a local MongoDB — brew services start mongodb-community, or docker run -p 27017:27017 mongo
npm run seed        # loads sample order history for userId "dj"
npm run start:dev   # http://localhost:3000
```

Then:

```bash
curl "http://localhost:3000/suggestions?userId=dj&lat=28.6&lng=77.2"
```

## Endpoints

- `GET /suggestions?userId=&lat=&lng=` — top 5 ranked suggestions with reasons
- `POST /suggestions/accept` — `{ userId, restaurantId, itemIds }`, places the order
- `POST /suggestions/skip` — `{ userId, restaurantId }`, records negative feedback

## Known simplifications (v1 — good next steps)

- Frequency score is overall cuisine frequency, not conditioned on time slot
  (e.g. it doesn't yet learn "south Indian specifically for breakfast" as a
  distinct signal from "south Indian in general"). Worth splitting
  `cuisineCounts` by time slot for v2.
- Ranking weights are hand-picked, not learned. Fine for a demo; a real
  version could fit weights from accept/skip feedback over time.
- No location/delivery-zone filtering logic yet — passes lat/lng straight
  through to the MCP search call and trusts it to filter.
- Cold-start (brand-new user, no order history) isn't handled — profile
  comes back empty and ranking falls back to rating + price-fit only, which
  works but isn't personalized yet. A short onboarding Q&A would fix this.

## Swapping in real Swiggy MCP

Once you have localhost/prod access:

1. Implement `SwiggyMcpClient` (see `src/mcp/mcp-client.interface.ts`) against
   the real MCP endpoint — OAuth 2.1 + PKCE, streamable HTTP, JSON-RPC.
2. In `src/mcp/mcp.module.ts`, replace `useClass: MockSwiggyMcpClient` with
   your real client (inject `ConfigService` for credentials).
3. Everything downstream (ranking, preferences, controller) is unchanged.

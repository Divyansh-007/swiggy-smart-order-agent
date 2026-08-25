# History-Driven Suggestions (Reorder + Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `/suggestions` from the user's **real Swiggy account order history** (via `get_food_orders`) instead of the seeded Mongo store, returning two ranked top-5 lists in one response: **reorder** (your usual restaurants, each carrying the exact items to re-add) and **discover** (cuisine-personalized new picks via the existing ranking engine, now fed by real cuisines).

**Architecture:** Add read-only account-history methods to the `SwiggyMcpClient` seam (`getOrderHistory`, `getRestaurantCuisines`). A new profile builder turns real orders into the existing `PreferenceProfile` (extended with restaurant-level data + reorder items). Reorder ranks distinct past restaurants; Discovery reuses today's cuisine-search + `RankingService.rank` flow. The mock returns synthetic history so everything still runs offline. Cart-fill (acting on a pick) is a **separate follow-up plan** — this plan stops at producing the two lists.

**Tech Stack:** NestJS 10, TypeScript 5.5, Mongoose 8 + MongoDB, `@modelcontextprotocol/sdk` 1.30.0, Jest.

**Spec:** This conversation (the vision: "top-5 from my real order history + location; the agent decides what I'll want"). External contract verified during planning:
- `.../docs/reference/food/get_food_orders.md` — history payload + `actions[].reorderMeta.orderItems`
- `.../docs/reference/food/get_food_order_details.md` — `restaurant_cuisine[]`
- Prior integration lives in `docs/superpowers/plans/2026-08-24-real-swiggy-mcp-integration.md` (merged).

## Global Constraints

- **Read-only only.** This plan calls only read-only tools (`get_food_orders`, `get_food_order_details`, plus the existing `get_addresses`/`search_restaurants`). No cart or order mutation. `place_food_order` is never touched.
- **Real payloads over docs.** Swiggy docs have already misled us once (`costForTwo` was a string). Task 1 captures the LIVE `get_food_orders` / `get_food_order_details` payloads and pins the real field shapes; adapters are written against captured JSON, not doc guesses. `get_food_orders` requires `addressId`.
- **PII discipline.** The real payload carries the user's name/address/phone and real order data. Test fixtures use synthetic values that mirror the STRUCTURE only. Never commit real PII to the (public) repo. Never log tokens or full payloads.
- **Bound enrichment calls.** Cuisine comes from `get_food_order_details` (one call per order). Enrich at most the **N=10** most-recent distinct restaurants; never fan out across the whole history.
- **`USE_MOCK_MCP` still works.** Mock mode returns synthetic history so the two-list flow runs offline and remains the default + test double.
- **Interface is the only contract.** Ranking/preferences/controller depend only on `SwiggyMcpClient` + domain types, never on MCP transport details.
- **Auth failures stay 401.** Real-mode calls that hit an expired session surface as HTTP 401 → `/oauth/login` (existing `RealSwiggyMcpClient` behavior — do not regress it).

---

## File Structure

**Create:**
- `src/mcp/real/order-history.adapter.ts` — pure `toAccountOrders(data)` and `cuisinesFromOrderDetails(data)`.
- `src/mcp/real/order-history.adapter.spec.ts` — tests against captured (synthetic-PII) shapes.
- `src/suggestions/account-profile.service.ts` — `AccountProfileService.build(userId, addressId)` → `AccountProfile` from real orders + Mongo feedback.
- `src/suggestions/account-profile.service.spec.ts`.
- `src/ranking/reorder-ranking.service.ts` — `ReorderRankingService.rank(profile, slot, topN)` → `ReorderSuggestion[]`.
- `src/ranking/reorder-ranking.service.spec.ts`.

**Modify:**
- `src/mcp/mcp-client.interface.ts` — add `ReorderItem`, `AccountOrder`, `getOrderHistory`, `getRestaurantCuisines`.
- `src/mcp/mock-swiggy-mcp.client.ts` — implement the two new methods with synthetic history.
- `src/mcp/mock-swiggy-mcp.client.spec.ts` — cover them.
- `src/mcp/real/real-swiggy-mcp.client.ts` — implement the two new methods (through the existing `call()`/`unwrap()`).
- `src/mcp/real/real-swiggy-mcp.client.spec.ts` — cover them.
- `src/mcp/real/debug.controller.ts` — add `get_food_orders`, `get_food_order_details` to the read-only allow-list (for live capture).
- `src/suggestions/suggestions.service.ts` — source the profile from `AccountProfileService`; return `{ reorder, discover }`.
- `src/suggestions/suggestions.controller.ts` — shape the combined response.
- `src/suggestions/suggestions.service.spec.ts` — update for the new return shape.
- `src/ranking/ranking.module.ts` / `src/suggestions/suggestions.module.ts` — wire the new providers.
- `README.md` — document the two lists + the account-history source.

---

## Task 1: Capture live payloads + widen the read-only debug allow-list

**Files:**
- Modify: `src/mcp/real/debug.controller.ts`

**Interfaces:**
- Produces: confirmed real shapes for `get_food_orders` and `get_food_order_details`, captured to scratch files, and documented in the task report as the authority for Task 3's adapters.

> This is a verification gate. The live capture needs a human OAuth session (phone+OTP) — the implementer performs the allow-list change + verification it compiles/boots; the actual capture curls are run by the human and pasted back, OR the implementer captures them if a live session is already authenticated. Do not guess the shapes — Task 3's adapters are written against what this task captures.

- [ ] **Step 1: Add the two read-only history tools to the allow-list**

In `debug.controller.ts`, extend `CAPTURE_TOOLS`:

```ts
const CAPTURE_TOOLS = new Set(['get_addresses', 'search_restaurants', 'get_food_orders', 'get_food_order_details']);
```

Leave the `USE_MOCK_MCP !== 'false'` guard and the `place_food_order`-blocking behavior unchanged. `/raw` must still 403 any tool not in this set. (These four are all read-only — no cart/order mutation is reachable.)

- [ ] **Step 2: Verify guard + compile**

Run: `npx tsc --noEmit` (clean). Boot real mode (`USE_MOCK_MCP=false node dist/main.js` after `npm run build`); `curl -s -i "http://localhost:3000/debug/mcp/raw?tool=place_food_order"` → still 403; `curl -s -i "http://localhost:3000/debug/mcp/raw?tool=get_food_orders&addressId=<id>"` → 200 if authenticated, else 401. Paste outcomes.

- [ ] **Step 3: Capture live payloads (needs an authenticated session)**

```
curl -s "http://localhost:3000/debug/mcp/raw?tool=get_food_orders&addressId=<id>"           > /tmp/get_food_orders.json
# take an orderId from that, then:
curl -s "http://localhost:3000/debug/mcp/raw?tool=get_food_order_details&orderId=<orderId>"  > /tmp/get_food_order_details.json
```

Record in the report, for `get_food_orders`: the envelope (is it under `structuredContent`? does it wrap `{success,data}` or `{data:{data:...}}`?), and the EXACT keys/types of each order — especially `orderTotal` (string format e.g. `"₹340"`?), `orderedTime` (format?), and the path to reorder items (`actions[].reorderMeta.orderItems[]` with `menu_item_id` vs `item_id`, `name`, `quantity`). For `get_food_order_details`: confirm `restaurant_cuisine: string[]` and its path. **This captured shape is the authority for Task 3.**

- [ ] **Step 4: Commit**

```bash
git add src/mcp/real/debug.controller.ts
git commit -m "test(debug): allow-list read-only order-history tools for live capture"
```

---

## Task 2: Interface + domain types + mock history

**Files:**
- Modify: `src/mcp/mcp-client.interface.ts`, `src/mcp/mock-swiggy-mcp.client.ts`
- Test: `src/mcp/mock-swiggy-mcp.client.spec.ts`

**Interfaces:**
- Produces (added to `SwiggyMcpClient`):

```ts
export interface ReorderItem {
  menuItemId: string;
  name: string;
  quantity: number;
}

export interface AccountOrder {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  orderTotal: number;      // rupees, parsed from Swiggy's string
  orderedAt: Date;         // parsed from orderedTime
  isActiveOrder: boolean;
  reorderItems: ReorderItem[]; // exact items to re-add ([] if the order has no reorder action)
}

export interface SwiggyMcpClient {
  // ...existing...
  getOrderHistory(addressId: string): Promise<AccountOrder[]>;        // get_food_orders (newest-first)
  getRestaurantCuisines(orderId: string): Promise<string[]>;          // get_food_order_details -> restaurant_cuisine[]
}
```

- [ ] **Step 1: Write the failing mock test**

```ts
// mock-swiggy-mcp.client.spec.ts (add)
it('returns synthetic order history newest-first with reorder items', async () => {
  const c = new MockSwiggyMcpClient();
  const orders = await c.getOrderHistory('addr_home');
  expect(orders.length).toBeGreaterThan(1);
  expect(orders[0].orderedAt.getTime()).toBeGreaterThanOrEqual(orders[1].orderedAt.getTime());
  expect(orders[0].reorderItems[0].menuItemId).toBeTruthy();
});
it('returns cuisines for an order', async () => {
  const c = new MockSwiggyMcpClient();
  expect(await c.getRestaurantCuisines('mock-ord-1')).toContain('biryani');
});
```

- [ ] **Step 2: Add the types to the interface** (block above).

- [ ] **Step 3: Implement in the mock** — synthetic history whose restaurants/cuisines line up with `MOCK_RESTAURANTS` (so Discovery search still finds them). Include per-restaurant `reorderItems`, descending `orderedAt`, and a `restaurantId → cuisines` map for `getRestaurantCuisines`. Newest-first.

- [ ] **Step 4: Run mock spec** (`npx jest src/mcp/mock-swiggy-mcp.client.spec.ts`) → pass. `npx tsc --noEmit` — errors now CONFINED to `real-swiggy-mcp.client.ts` (missing new methods, fixed in Task 4) — confirm confinement.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-client.interface.ts src/mcp/mock-swiggy-mcp.client.ts src/mcp/mock-swiggy-mcp.client.spec.ts
git commit -m "feat(mcp): account order-history contract + synthetic mock history"
```

---

## Task 3: Order-history adapters (reconciled to live shapes)

**Files:**
- Create: `src/mcp/real/order-history.adapter.ts`, `src/mcp/real/order-history.adapter.spec.ts`

**Interfaces:**
- Consumes: the shapes captured in Task 1.
- Produces:
  - `toAccountOrders(data: unknown): AccountOrder[]`
  - `cuisinesFromOrderDetails(data: unknown): string[]`

> Write these against the Task 1 captured JSON. The block below is the STARTING point from the documented schema; adjust field picks to match what Task 1 actually saw. Reuse the money/parsing helper approach already proven in `swiggy-response.adapter.ts` (Swiggy sends money as strings).

- [ ] **Step 1: Write failing tests** with fixtures mirroring the captured structure (synthetic PII), e.g. an order with `orderTotal: "₹340"`, an `orderedTime` string, and `actions:[{reorderMeta:{orderItems:[{menu_item_id:'m1',name:'Chicken Biryani',quantity:1}]}}]`; assert `toAccountOrders` yields `{ orderTotal: 340, reorderItems:[{menuItemId:'m1',name:'Chicken Biryani',quantity:1}], ... }` and `orderedAt instanceof Date`. For details, a payload with `order.restaurant_cuisine:['Biryani','North Indian']` → `cuisinesFromOrderDetails` returns `['biryani','north_indian']` (snake-cased, matching the restaurant adapter's `snake()`).

- [ ] **Step 2: Run → fail** (`npx jest src/mcp/real/order-history.adapter.spec.ts`).

- [ ] **Step 3: Implement**

```ts
// order-history.adapter.ts
import { AccountOrder, ReorderItem } from '../mcp-client.interface';

function snake(s: string): string { return s.toLowerCase().trim().replace(/\s+/g, '_'); }
function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const m = v.replace(/,/g, '').match(/\d+/); return m ? Number(m[0]) : 0; }
  return 0;
}
function parseDate(v: unknown): Date {
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? new Date(0) : d;
}
function reorderItemsOf(order: any): ReorderItem[] {
  const action = (order.actions ?? []).find((a: any) => a?.reorderMeta?.orderItems?.length);
  const items = action?.reorderMeta?.orderItems ?? [];
  return items
    .map((i: any) => ({
      menuItemId: i.menu_item_id ?? i.item_id ?? '',
      name: i.name ?? '',
      quantity: Number(i.quantity ?? 1),
    }))
    .filter((i: ReorderItem) => i.menuItemId);
}

export function toAccountOrders(data: unknown): AccountOrder[] {
  const arr = (data as any)?.orders ?? (Array.isArray(data) ? data : []);
  return arr.map((o: any) => ({
    orderId: o.orderId ?? o.order_id,
    restaurantId: o.restaurantId ?? o.restaurant_id,
    restaurantName: o.restaurantName ?? o.restaurant_name ?? '',
    orderTotal: parseAmount(o.orderTotal ?? o.order_total),
    orderedAt: parseDate(o.orderedTime ?? o.order_time),
    isActiveOrder: !!o.isActiveOrder,
    reorderItems: reorderItemsOf(o),
  }));
}

export function cuisinesFromOrderDetails(data: unknown): string[] {
  const cuisines = (data as any)?.order?.restaurant_cuisine ?? (data as any)?.restaurant_cuisine ?? [];
  return (cuisines as string[]).map(snake);
}
```

- [ ] **Step 4: Run → pass. Commit.**

```bash
git add src/mcp/real/order-history.adapter.ts src/mcp/real/order-history.adapter.spec.ts
git commit -m "feat(mcp): adapters for account order history + cuisines (reconciled to live)"
```

---

## Task 4: Real client methods

**Files:**
- Modify: `src/mcp/real/real-swiggy-mcp.client.ts`, `src/mcp/real/real-swiggy-mcp.client.spec.ts`

**Interfaces:**
- Consumes: `call()`/`unwrap()` (existing), Task 3 adapters.
- Produces: `getOrderHistory`, `getRestaurantCuisines` on `RealSwiggyMcpClient`.

- [ ] **Step 1: Write failing tests** using the existing fake-session pattern in this spec: a fake `callTool` returning a success envelope whose `structuredContent` (or whatever Task 1 confirmed) carries an `orders` array → assert `getOrderHistory('a')` returns mapped `AccountOrder[]`; a details envelope → `getRestaurantCuisines('o1')` returns snake-cased cuisines.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```ts
import { toAccountOrders, cuisinesFromOrderDetails } from './order-history.adapter';

async getOrderHistory(addressId: string): Promise<AccountOrder[]> {
  return toAccountOrders(await this.call('get_food_orders', { addressId }));
}
async getRestaurantCuisines(orderId: string): Promise<string[]> {
  return cuisinesFromOrderDetails(await this.call('get_food_order_details', { orderId }));
}
```

- [ ] **Step 4: Run → pass. `npx tsc --noEmit` fully clean now. Commit.**

```bash
git add src/mcp/real/real-swiggy-mcp.client.ts src/mcp/real/real-swiggy-mcp.client.spec.ts
git commit -m "feat(mcp): real client getOrderHistory + getRestaurantCuisines"
```

---

## Task 5: Account profile builder

**Files:**
- Create: `src/suggestions/account-profile.service.ts`, `src/suggestions/account-profile.service.spec.ts`

**Interfaces:**
- Consumes: `SwiggyMcpClient` (`getOrderHistory`, `getRestaurantCuisines`), `PreferencesService` (feedback only), `PreferenceProfile`.
- Produces:

```ts
export interface RestaurantMeta {
  restaurantId: string;
  name: string;
  count: number;
  lastOrderedAt: Date;
  avgValue: number;
  reorderItems: ReorderItem[]; // from the most-recent order at this restaurant
}
export interface AccountProfile extends PreferenceProfile {
  restaurants: RestaurantMeta[]; // distinct, for reorder ranking
}
@Injectable()
export class AccountProfileService {
  build(userId: string, addressId: string): Promise<AccountProfile>;
}
```

- `build()`: fetch `getOrderHistory(addressId)`; group by `restaurantId` → `RestaurantMeta` (count, most-recent `orderedAt` + its `reorderItems`, avg `orderTotal`); compute `avgOrderValue`, `timeSlotCounts` (from each order's `orderedAt` hour, reuse the existing `timeSlotFor` logic), `recentRestaurantIds` (distinct, newest-first), and `cuisineCounts` by enriching the **≤10 most-recent distinct restaurants** via `getRestaurantCuisines` (one detail call each; weight each restaurant's cuisines by its order `count`). `rejectedRestaurantIds` comes from `PreferencesService` skip feedback (unchanged).

- [ ] **Step 1: Write failing tests** with a fake mcp client returning a fixed `AccountOrder[]` (2 restaurants, one ordered twice) and fake cuisines; assert `restaurants` has correct counts + `reorderItems`, `cuisineCounts` reflects the enriched cuisines weighted by count, `avgOrderValue` is the mean, and `recentRestaurantIds` is newest-first distinct.

- [ ] **Step 2: Run → fail. Step 3: Implement (per spec above). Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/suggestions/account-profile.service.ts src/suggestions/account-profile.service.spec.ts
git commit -m "feat(suggestions): build preference profile from real account order history"
```

---

## Task 6: Reorder ranking

**Files:**
- Create: `src/ranking/reorder-ranking.service.ts`, `src/ranking/reorder-ranking.service.spec.ts`

**Interfaces:**
- Consumes: `AccountProfile` (Task 5), `RestaurantMeta`.
- Produces:

```ts
export interface ReorderSuggestion {
  restaurantId: string;
  name: string;
  items: ReorderItem[];
  score: number;
  reason: string; // e.g. "Ordered 4× — your go-to; last time 6 days ago"
}
@Injectable()
export class ReorderRankingService {
  rank(profile: AccountProfile, currentTimeSlot: string, topN = 5): ReorderSuggestion[];
}
```

- Score each `RestaurantMeta`: `w1*frequency (count/maxCount) + w2*recencyBoost (newer = higher) + w3*priceFit (|avgValue - profile.avgOrderValue|) - w4*rejectionPenalty (restaurantId in rejectedRestaurantIds)`. Sort desc, take `topN`. Skip restaurants with empty `reorderItems` (can't reorder them) unless it leaves < topN, then include with an empty-items note. `reason` explains the top signal.

- [ ] **Step 1: Write failing tests**: a profile with restaurant A (count 4, recent) and B (count 1, old) → A ranks first; a rejected restaurant is down-ranked; `items` carries A's reorderItems. **Step 2: fail. Step 3: implement. Step 4: pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ranking/reorder-ranking.service.ts src/ranking/reorder-ranking.service.spec.ts
git commit -m "feat(ranking): reorder ranking over account restaurant history"
```

---

## Task 7: Wire the combined `{ reorder, discover }` endpoint (HYBRID dish-name Discovery)

> **Design update (post live-capture):** `get_food_order_details` returns EMPTY structuredContent live — there is NO per-order cuisine available. Discovery therefore does NOT use cuisine. Instead it is a **hybrid**: (1) the user's past **dish names** (from `reorderItems[].name`, already in the profile) as `search_restaurants` queries, plus (2) a **meal-time "popular" search** — merged, with the user's KNOWN restaurants excluded (those are the reorder list), then ranked. Also REMOVE the now-dead `getRestaurantCuisines` enrichment from `AccountProfileService` (it costs ≤10 wasted calls and returns nothing live); `cuisineCounts` from account history is left empty.

**Files:**
- Modify: `src/suggestions/suggestions.service.ts`, `src/suggestions/suggestions.controller.ts`, `src/suggestions/suggestions.service.spec.ts`, `src/suggestions/suggestions.module.ts`, `src/ranking/ranking.module.ts`, `src/suggestions/account-profile.service.ts` (+ its spec — drop the enrichment).

**Interfaces:**
- Consumes: `AccountProfileService`, `ReorderRankingService`, existing `RankingService`, `SwiggyMcpClient`.
- Produces: `getTopSuggestions(userId, addressId?)` → `{ reorder: ReorderSuggestion[]; discover: RankedSuggestion[] }`.

**Dish-keyword extraction** (helper in the suggestions service): collect `name` from every `profile.restaurants[].reorderItems`; clean each — lowercase, strip trailing size/qty noise (parentheticals like `(350-450 GM)`, trailing unit tokens like `50 GM`, `x2`), collapse whitespace; count frequency; take the **top 3 distinct** non-empty keywords.

`getTopSuggestions`:
- resolve `addressId` (given, else first from `getAddresses()`; if none → `{ reorder: [], discover: [] }`).
- Build `AccountProfile` via `AccountProfileService`.
- **Reorder** = `ReorderRankingService.rank(profile, slot, 5)`.
- **Discover**: queries = top-3 dish keywords ∪ `{ MEAL_DEFAULT_QUERY[slot] }` (reuse the existing meal-time default map). `searchRestaurants({ addressId, query })` per query; merge/de-dupe by `restaurantId`; **EXCLUDE** any restaurant whose `restaurantId` is in `profile.recentRestaurantIds` (Discovery = NEW places, not your usuals). If the merged pool is still < 5, widen with a `'popular'` search (also excluding known). `RankingService.rank(candidates, profile, slot, 5)`. (cuisineCounts is empty from account history — ranking leans on price-fit from `avgOrderValue` + rating + the explore slot, which is fine.)
- Return both lists.
- Register `AccountProfileService` in `SuggestionsModule` and `ReorderRankingService` in `RankingModule` (export it), import into `SuggestionsModule`.
- Controller GET maps to `{ reorder: [...], discover: [...] }` — reorder items exposed as `{ menuItemId, name, quantity }`, discover as today's shape.

- [ ] **Step 1: Trim `AccountProfileService`** — remove the `getRestaurantCuisines` enrichment loop (dead live); leave `cuisineCounts` as `{}` (or drop its population), keep `restaurants`/`avgOrderValue`/`timeSlotCounts`/`recentRestaurantIds`/`rejectedRestaurantIds`. Update its spec to not assert cuisine enrichment.
- [ ] **Step 2: Update the service spec** — fake mcp returns history (with reorderItems names) + restaurants; a fake `searchRestaurants` that branches on `query` (returns dish-relevant restaurants for a dish keyword, a fuller set for `'popular'`); assert the response has non-empty `reorder` (items present) and `discover` (≤5), and that a restaurant already in history is NOT in `discover`. **Step 3: fail. Step 4: implement dish-keyword helper + service + controller + module wiring. Step 5:** `npx jest && npx tsc --noEmit` clean.
- [ ] **Step 6: Boot check (mock mode):** `curl -s "http://localhost:3000/suggestions?userId=dj"` → JSON with `reorder` (≤5, items present) and `discover` (≤5, none overlapping the reorder restaurants). Paste it.
- [ ] **Step 7: Commit**

```bash
git add src/suggestions src/ranking/ranking.module.ts
git commit -m "feat(suggestions): reorder + hybrid dish-name/popular discovery from account history"
```

---

## Task 8: README + honest limitations

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update** the API section for the `{ reorder, discover }` response; explain that the profile now comes from the real Swiggy account (`get_food_orders`) in real mode (mock history in mock mode); note the ≤10-restaurant cuisine-enrichment bound; move the resolved "userId vs account history" item forward and note the remaining gap (userId↔Swiggy identity still not bound — see prior README note); add "next: fill cart from a pick (separate plan)".
- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: reorder + discovery lists from real account history"
```

---

## Self-Review

**1. Spec coverage**
- Profile from real account history → Tasks 2, 4, 5. ✅
- Reorder top-5 (with items) → Tasks 2 (reorderItems), 6, 7. ✅
- Discovery top-5 from real cuisines → Tasks 5 (cuisineCounts via enrichment), 7. ✅
- Combined single endpoint → Task 7. ✅
- Live-shape reconciliation before building on payloads → Task 1 (capture) feeds Task 3 (adapters). ✅
- Bound enrichment (≤10) → Task 5. ✅
- Read-only only; no cart/order mutation → Global Constraints + Task 1 allow-list is read-only tools only. ✅
- Mock still works / default → Tasks 2, 7 (mock history), boot checks. ✅
- Cart-fill explicitly deferred → Architecture note + Task 8. ✅

**2. Placeholder scan** — Adapters (Task 3) and the real client (Task 4) are the payload-shape-dependent spots; both are written against Task 1's captured JSON with a documented starting point and defensive parsing — a reconciliation step, not a TODO. Everything else has concrete code or a concrete per-field spec.

**3. Type consistency** — `ReorderItem { menuItemId, name, quantity }` and `AccountOrder` are defined in Task 2 and used identically in Tasks 3–7. `AccountProfile extends PreferenceProfile` adds `restaurants: RestaurantMeta[]`; `ReorderRankingService.rank` consumes it and emits `ReorderSuggestion { restaurantId, name, items, score, reason }`, matched by the controller in Task 7. `getOrderHistory(addressId)` / `getRestaurantCuisines(orderId)` signatures are identical across interface, mock, real client, and profile builder.

**Known residual risk (call at execution):** `get_food_orders`'s exact envelope and the reorder-item field names (`menu_item_id` vs `item_id`), plus `orderedTime`'s date format, are pinned in Task 1 and consumed in Task 3 — resolve empirically from the captured JSON, not from this plan's documented starting point.

# Surprise-To-Cart (Conclude at Cart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "surprise me" action: `POST /suggestions/surprise-cart` randomly picks one suggestion (from **either** the `reorder` or `discover` list), adds **one item at quantity 1** to the user's real Swiggy cart (`update_food_cart` → `get_food_cart`), and returns the cart summary. It **stops at the cart** — no `place_food_order`, no payment, no money movement. The user taps pay in the Swiggy app.

**Architecture:** Extend the existing `SwiggyMcpClient` seam with the correctly-shaped cart tools (the current `buildCart` is wrong vs the live API) and a menu-lookup tool (needed to turn a discover *restaurant* into an orderable item). A new `SuggestionsService.surpriseToCart` composes: resolve address → get `{reorder, discover}` → random-pick → resolve one item → add to cart. The mock covers the whole flow offline; a single live verification reconciles the mutating call against the real API.

**Tech Stack:** NestJS 10, TypeScript 5.5, Mongoose 8 + MongoDB, `@modelcontextprotocol/sdk` 1.30.0, Jest.

**Spec:** This conversation. External contracts verified during planning:
- `update_food_cart` (MUTATING): args `{ restaurantId, cartItems: object[], addressId, restaurantName? }`; response `data.data.{ cart_id, restaurant, items[], item_count, pricing{item_total, delivery_charge, taxes_and_charges, to_pay}, offers }`.
- `get_food_cart` (read-only): args `{ addressId, restaurantName? }`; same cart payload under `data.data`.
- `get_restaurant_menu` (read-only): args `{ addressId, restaurantId, page?, pageSize? }`; response `data.categories[].items[]` = `{ id, name, price?, inStock?, isVeg?, isBestseller?, hasVariants?, hasAddons? }`.
- Reorder items already carry Swiggy's `itemId` (used as `menu_item_id`) — see `docs/superpowers/plans/2026-08-24-history-driven-suggestions.md`.

## Global Constraints

- **Conclude at cart. `place_food_order` is NEVER called.** No payment tools, no `ALLOW_REAL_ORDERS` gate needed (nothing is purchased). The existing unused `placeOrder` method stays unwired.
- **The cart mutation is user-initiated and consented.** `surprise-cart` runs only on an explicit `POST` by the user. The live verification (Task 4) will add exactly one item to the user's real Swiggy cart — the user has consented to this. Never auto-fill the cart outside an explicit request.
- **Real payloads over docs.** `update_food_cart`/`get_food_cart`/`get_restaurant_menu` response parsing is written against the documented schema with defensive fallbacks, then reconciled against LIVE payloads in Task 4 (the docs have misled us twice — `costForTwo`, `itemId`).
- **Prefer simple items.** When picking an item to add, prefer an **in-stock** item **without required variants/addons** (`hasVariants`/`hasAddons` false), so a bare `{ menu_item_id, quantity: 1 }` succeeds without customization. This applies to discover-menu items; reorder items use Swiggy's own reorder id as-is.
- **Randomness behind a seam.** The random pick must be injectable/overridable so tests are deterministic (e.g. a `pick<T>(arr: T[]): T` function defaulting to `Math.random`, replaceable in tests).
- **`USE_MOCK_MCP` still works.** Mock implements the new cart + menu methods with synthetic data so the whole flow runs offline and stays the default + test double.
- **Interface is the only contract.** Ranking/suggestions/controller depend only on `SwiggyMcpClient` + domain types.
- **PII / secrets.** Test fixtures synthetic. Never log tokens or full payloads.
- **graphify hook note (for implementers):** this project has a graphify `PreToolUse` hook that may block the first raw file `Read` per session until a `graphify query` runs. If blocked, run `graphify query "cart"` once (or `export GRAPHIFY_HOOK_STRICT=0`) and continue.

---

## File Structure

**Create:**
- `src/mcp/real/cart.adapter.ts` — pure `toCartSummary(data)` and `toMenuItems(data)`.
- `src/mcp/real/cart.adapter.spec.ts`.

**Modify:**
- `src/mcp/mcp-client.interface.ts` — fix `BuildCartParams`/`CartSummary`; add `CartItemInput`, `MenuItem`; add `getRestaurantMenu`; correct `buildCart`.
- `src/mcp/real/real-swiggy-mcp.client.ts` — correct `buildCart` (real args + adapter); add `getRestaurantMenu`.
- `src/mcp/real/real-swiggy-mcp.client.spec.ts` — cover both.
- `src/mcp/mock-swiggy-mcp.client.ts` — new `buildCart` shape + `getRestaurantMenu` (synthetic menu).
- `src/mcp/mock-swiggy-mcp.client.spec.ts` — cover them.
- `src/mcp/real/debug.controller.ts` — add read-only `get_food_cart`, `get_restaurant_menu` to the allow-list (NOT `update_food_cart` — it mutates; the endpoint handles that).
- `src/suggestions/suggestions.service.ts` — add `surpriseToCart(userId, addressId?)`.
- `src/suggestions/suggestions.controller.ts` — add `POST /suggestions/surprise-cart`.
- `src/suggestions/suggestions.service.spec.ts` — cover both pick paths deterministically.
- `README.md` — document surprise-cart + conclude-at-cart.

---

## Task 1: Cart contract reconciliation (interface + client + mock + adapter)

**Files:** interface, real client (+spec), mock (+spec), `cart.adapter.ts` (+spec).

**Interfaces (produce):**
```ts
export interface CartItemInput { menuItemId: string; quantity: number; }
export interface BuildCartParams {
  restaurantId: string;
  addressId: string;                 // REQUIRED by update_food_cart/get_food_cart
  items: CartItemInput[];
  restaurantName?: string;
}
export interface CartSummary {
  restaurantId: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
  itemTotal: number;
  toPay: number;                     // pricing.to_pay — the live payable total
}
// SwiggyMcpClient: buildCart(params: BuildCartParams): Promise<CartSummary>   (signature changes: adds addressId, items shape)
```

- [ ] **Step 1: Write failing adapter test** (`cart.adapter.spec.ts`) — fixture mirrors `{ data: { data: { restaurant:{id,name}, items:[{menu_item_id,name,quantity,final_price}], pricing:{item_total, to_pay} } } }`; assert `toCartSummary` yields `{ restaurantId, restaurantName, items:[{name,quantity,price}], itemTotal, toPay }`. (Note: the real client's `unwrap()` returns the inner `data` object, so `toCartSummary` receives the object holding `data.data` OR `data` — write it to handle `raw.data ?? raw` defensively.)

- [ ] **Step 2: Implement `cart.adapter.ts`** — `toCartSummary(data)`:
```ts
export function toCartSummary(data: unknown): CartSummary {
  const c = (data as any)?.data ?? data ?? {};
  const items = (c.items ?? []).map((i: any) => ({
    name: i.name, quantity: Number(i.quantity ?? 1),
    price: Number(i.final_price ?? i.total ?? i.subtotal ?? 0),
  }));
  const pricing = c.pricing ?? {};
  return {
    restaurantId: c.restaurant?.id ?? '',
    restaurantName: c.restaurant?.name ?? '',
    items,
    itemTotal: Number(pricing.item_total ?? 0),
    toPay: Number(pricing.to_pay ?? pricing.item_total ?? 0),
  };
}
```
(Leave `toMenuItems` for Task 2 — or stub it now; the brief for Task 2 defines it.)

- [ ] **Step 3: Fix `RealSwiggyMcpClient.buildCart`**:
```ts
async buildCart(params: BuildCartParams): Promise<CartSummary> {
  await this.call('update_food_cart', {
    restaurantId: params.restaurantId,
    addressId: params.addressId,
    cartItems: params.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity })),
    ...(params.restaurantName ? { restaurantName: params.restaurantName } : {}),
  });
  const cart = await this.call('get_food_cart', {
    addressId: params.addressId,
    ...(params.restaurantName ? { restaurantName: params.restaurantName } : {}),
  });
  return toCartSummary(cart);
}
```

- [ ] **Step 4: Update the mock `buildCart`** to the new `BuildCartParams` and return a `CartSummary` (synthetic: echo the items with a fake price, compute itemTotal/toPay). Update the mock spec.

- [ ] **Step 5: Real-client spec** — a fake `callTool` that records the two calls; assert `update_food_cart` got `{ restaurantId, addressId, cartItems:[{menu_item_id, quantity}] }` and `get_food_cart` got `{ addressId }`, and the returned `CartSummary` maps correctly.

- [ ] **Step 6: Run `npx tsc --noEmit` + `npx jest`** (any consumer of the old `buildCart` signature — grep; only the interface/mock/real use it today, no service caller yet) → clean. **Commit** `feat(mcp): correct cart-tool contracts (addressId + cartItems) + cart adapter`.

---

## Task 2: Restaurant menu tool (for discover picks)

**Files:** interface, real client (+spec), mock (+spec), `cart.adapter.ts` `toMenuItems` (+spec).

**Interfaces (produce):**
```ts
export interface MenuItem {
  menuItemId: string; name: string; price: number;
  inStock: boolean; isVeg?: boolean; hasVariants: boolean; hasAddons: boolean;
}
// SwiggyMcpClient: getRestaurantMenu(restaurantId: string, addressId: string): Promise<MenuItem[]>
```

- [ ] **Step 1: Failing test for `toMenuItems`** — fixture `{ categories: [{ items: [{ id, name, price, inStock, isVeg, hasVariants, hasAddons }] }] }` → flat `MenuItem[]`; `inStock` derived from `Number(inStock) > 0` (Swiggy sends `inStock` as a number). Include an out-of-stock and a hasVariants item to prove flags carry.

- [ ] **Step 2: Implement `toMenuItems`** — flatten `data.categories[].items[]`, map `id→menuItemId`, `Number(price)`, `inStock: Number(i.inStock ?? 1) > 0`, `hasVariants: !!i.hasVariants`, `hasAddons: !!i.hasAddons`.

- [ ] **Step 3: Real client `getRestaurantMenu`**:
```ts
async getRestaurantMenu(restaurantId: string, addressId: string): Promise<MenuItem[]> {
  return toMenuItems(await this.call('get_restaurant_menu', { restaurantId, addressId }));
}
```

- [ ] **Step 4: Mock `getRestaurantMenu`** — synthetic menu per restaurantId (a few in-stock simple items + at least one hasVariants/out-of-stock so the picker's filter is exercised). Update mock spec.

- [ ] **Step 5: `npx tsc --noEmit` + `npx jest`** clean. **Commit** `feat(mcp): getRestaurantMenu for turning a discover restaurant into an orderable item`.

---

## Task 3: `surpriseToCart` service + endpoint

**Files:** `suggestions.service.ts`, `suggestions.controller.ts`, `suggestions.service.spec.ts`.

**Interfaces (produce):**
```ts
// SuggestionsService
async surpriseToCart(userId: string, addressId?: string, picker?: <T>(a: T[]) => T): Promise<{
  picked: { list: 'reorder' | 'discover'; restaurantId: string; restaurantName: string; item: { menuItemId: string; name: string } };
  cart: CartSummary;
}>
```

- `surpriseToCart`:
  1. Resolve `addressId` (given, else first from `getAddresses()`); if none → throw `BadRequestException('No saved Swiggy address')`.
  2. `const { reorder, discover } = await this.getTopSuggestions(userId, addressId)`.
  3. Build a combined pool tagged by list: `[...reorder.map(r=>({list:'reorder', s:r})), ...discover.map(d=>({list:'discover', s:d}))]`. If empty → throw `BadRequestException('No suggestions to pick from')`.
  4. `const chosen = (picker ?? pick)(pool)` — `pick` = `arr[Math.floor(Math.random()*arr.length)]`.
  5. Resolve ONE item (qty 1):
     - `reorder`: from the pick's `items` (ReorderSuggestion carries `items: ReorderItem[]`), `(picker ?? pick)(items)` → `{ menuItemId, name }`. If the pick has no items, fall through to the discover path using its restaurantId.
     - `discover`: `const menu = await this.mcpClient.getRestaurantMenu(restaurantId, addressId)`; filter to `inStock && !hasVariants && !hasAddons`; if none, relax to `inStock`; `(picker ?? pick)(candidates)` → `{ menuItemId, name }`. If the menu is empty → throw `BadRequestException('Picked restaurant has no orderable items — try again')`.
  6. `const cart = await this.mcpClient.buildCart({ restaurantId, addressId, items: [{ menuItemId, quantity: 1 }], restaurantName })`.
  7. Return `{ picked: { list, restaurantId, restaurantName, item }, cart }`.
- Reorder/Discover suggestion shapes: `ReorderSuggestion { restaurantId, name, items }`; `RankedSuggestion { restaurant: RestaurantResult, ... }` — read `restaurant.restaurantId`/`restaurant.name` for discover. Normalize both to `{ restaurantId, restaurantName }` when building the pool.

- [ ] **Step 1: Failing service test** — inject a fake mcp (getAddresses, getOrderHistory→reorder items, searchRestaurants→discover restaurants, getRestaurantMenu→a couple items, buildCart→echoes a CartSummary), fake prefs, real ranking/profile services; pass a **deterministic `picker`** (e.g. always index 0). Two cases: (a) picker lands on a reorder suggestion → `buildCart` called with that reorder item's id, `picked.list==='reorder'`; (b) force picker to land on a discover suggestion → `getRestaurantMenu` called, an in-stock simple item chosen, `picked.list==='discover'`. Assert `cart` is returned and `place_food_order`/`placeOrder` is NEVER called (spy).

- [ ] **Step 2: fail → Step 3: implement service `surpriseToCart` + the `pick` helper. Step 4: pass.**

- [ ] **Step 5: Controller** — `@Post('surprise-cart') surpriseCart(@Body() body: { userId: string; addressId?: string })` → `suggestionsService.surpriseToCart(body.userId, body.addressId)`; return the `{ picked, cart }` shape (map cart items for the response).

- [ ] **Step 6: `npx tsc --noEmit` + `npx jest` clean. Boot mock mode** (`npm run build && node dist/main.js`), `curl -s -X POST localhost:3000/suggestions/surprise-cart -H 'content-type: application/json' -d '{"userId":"dj"}'` → JSON with `picked` (list/restaurant/item) + `cart` (items incl. the picked one, qty 1, a `toPay`). Paste it. Stop app. **Commit** `feat(suggestions): surprise-cart — random pick from suggestions, add 1 to cart`.

---

## Task 4: Live verification + reconciliation (real mutation — user consented)

**Files:** `src/mcp/real/debug.controller.ts` (allow-list read-only cart/menu tools); reconcile `cart.adapter.ts` if live differs.

> The user consented to adding one item to their real Swiggy cart. This task runs against a live authenticated session (fresh phone+OTP — the in-memory token doesn't survive restarts). The controller coordinates the human login; the mutation happens through the `surprise-cart` endpoint (not `/raw`).

- [ ] **Step 1: Extend debug allow-list** — add `get_food_cart`, `get_restaurant_menu` (both read-only) to `CAPTURE_TOOLS`. Do NOT add `update_food_cart` (mutating) — the endpoint performs the mutation. tsc + jest clean. Commit.
- [ ] **Step 2: Human login** — `USE_MOCK_MCP=false npm run build && node dist/main.js`; user completes `/oauth/login`; confirm `/oauth/status` authenticated.
- [ ] **Step 3: Live surprise-cart** — `curl -s -X POST localhost:3000/suggestions/surprise-cart -H 'content-type: application/json' -d '{"userId":"dj"}'`. This ADDS ONE ITEM to the real cart. Capture the response + any server error.
- [ ] **Step 4: Reconcile** — if `update_food_cart`/`get_food_cart` shapes differ from `toCartSummary`'s assumptions (e.g. `data.data` nesting, `to_pay` path, item fields), fix `cart.adapter.ts` + the request mapping and its fixtures; re-run jest. Confirm via `/debug/mcp/raw?tool=get_food_cart&addressId=<id>` (read-only) that the item is in the cart. Verify the reorder `itemId` was accepted as `menu_item_id` (if a reorder pick), and that a discover simple item was accepted. Commit any reconciliation.
- [ ] **Step 5: Report** the live cart JSON (item added, to_pay). Note any item types that failed (e.g. variant-required) as a known limitation.

---

## Task 5: README + roadmap

- [ ] **Step 1: README** — document `POST /suggestions/surprise-cart` (random pick from reorder/discover → 1 item to cart → returns cart with `toPay`; you tap pay in Swiggy). Move "conclude at cart" from roadmap to a shipped feature; note it stops before `place_food_order` (no payment) by design, and the variant-required-item limitation. Commit.

---

## Self-Review

**1. Spec coverage:** random pick from either list → T3. Add 1 qty to cart → T1 (buildCart) + T3. Correct cart contracts (addressId/cartItems) → T1. Discover→item via menu → T2 + T3. No place_food_order → Global Constraints + T3 spy. Live mutation (consented) → T4. Mock offline → T1/T2/T3. ✅

**2. Placeholder scan:** cart/menu adapters (T1/T2) and the cart request mapping are the payload-shape-dependent spots — written against the documented schema with defensive fallbacks, reconciled live in T4. Everything else is concrete.

**3. Type consistency:** `CartItemInput{menuItemId,quantity}`, `BuildCartParams{restaurantId,addressId,items,restaurantName?}`, `CartSummary{restaurantId,restaurantName,items,itemTotal,toPay}`, `MenuItem{menuItemId,name,price,inStock,isVeg?,hasVariants,hasAddons}` used identically across interface (T1/T2), mock, real client, adapter, and service (T3). `surpriseToCart(userId, addressId?, picker?)` matches its spec + controller call. `getRestaurantMenu(restaurantId, addressId)` identical across interface/mock/real/service.

**Known residual risk:** the exact `update_food_cart` `cartItems` element shape for items WITH required variants/addons is not fully specified; this plan handles bare `{menu_item_id, quantity}` items (preferring simple items) and defers variant-required items as a documented limitation, pinned in T4 against live behavior.

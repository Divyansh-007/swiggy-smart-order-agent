# Real Swiggy MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MockSwiggyMcpClient` with a real, OAuth-authenticated Swiggy **Food** MCP client so `/suggestions` ranks real nearby restaurants for the signed-in user, and orders are built (and optionally placed) through the documented cart journey — without changing the ranking engine.

**Architecture:** Keep the deterministic NestJS orchestrator + rule-based ranking engine as the product's differentiator. The Swiggy Food MCP server becomes the data/action layer behind the existing `SwiggyMcpClient` seam. A raw `@modelcontextprotocol/sdk` client speaks streamable-HTTP JSON-RPC to `https://mcp.swiggy.com/food`. **Auth is done the idiomatic MCP way: we implement the SDK's `OAuthClientProvider` and let the transport run Dynamic Client Registration, `.well-known` discovery, and PKCE automatically** (Option B from the build-an-agent doc) — chosen deliberately because this is a Swiggy Builders showcase and the "proper MCP" path is the point. No LLM tool-dispatch loop — we call tools deterministically.

**Tech Stack:** NestJS 10, TypeScript 5.5, Mongoose 8 + MongoDB, `@modelcontextprotocol/sdk` (streamable-HTTP client + `OAuthClientProvider`/`auth` module), Jest + ts-jest for unit tests.

**Sequencing:** Local demo first (Phases 1–3: real, authenticated read path ranking real restaurants — this is what the demo video shows). Ordering with real money (Phase 4) and production-access application are explicitly "further steps," done after the local demo lands.

**Spec:** This conversation is the spec of record (no separate design doc). The authoritative external contract is the Swiggy Builders docs, verified during planning:
- Auth: `https://mcp.swiggy.com/builders/docs/start/authenticate.md`
- Frameworks / raw client: `https://mcp.swiggy.com/builders/docs/start/developer/build-an-agent.md`
- Tools: `.../docs/reference/food/{get_addresses,search_restaurants,get_restaurant_menu,update_food_cart,fetch_food_coupons,apply_food_coupon,get_food_cart,place_food_order,track_food_order}.md`
- Order journey: `.../docs/build/recipes/order-food.md`

## Global Constraints

- **No static API key.** Auth is OAuth 2.1 + PKCE with Dynamic Client Registration (RFC 7591). There is **no `client_id`/`client_secret` to configure** — remove those env vars. **The SDK's `OAuthClientProvider` performs DCR and discovery for us**; we persist only what its callbacks hand us (client information + tokens + code verifier), in memory.
- **Access token lifetime: 5 days. No refresh token in v1.0.** On `401` (or JSON-RPC error `-32001`), the SDK raises `UnauthorizedError`; re-run the full authorization flow (redirect the user through `/oauth/login` again). Do not assume a cached success.
- **Never log tokens** to disk/stdout in plaintext. All OAuth state lives in memory only (an `OAuthStateStore` backing the provider), never persisted to disk, never returned in an HTTP response body.
- **Redirect URI must exact-match** an allowlisted value. Use `http://localhost:3000/oauth/callback` (localhost is the one non-HTTPS exception allowed for dev).
- **Endpoint:** `POST https://mcp.swiggy.com/food`. Every call carries `Authorization: Bearer <token>`.
- **Ordering is real money.** `place_food_order` places a real order and is **not idempotent**. It MUST be gated behind (a) an explicit per-request `confirm: true`, and (b) an env flag `ALLOW_REAL_ORDERS=true`. Default behavior builds the cart and returns a summary **without placing**. Hard **₹1000 cart cap** (Builders Club v1). On a 5xx from `place_food_order`, check `get_food_orders` before any retry.
- **Only recommend restaurants with `availabilityStatus === "OPEN"`.** (Replaces the mock's `isOpen` boolean.)
- **The `SwiggyMcpClient` interface is the only contract the rest of the app depends on.** Ranking, preferences, and the controller must not import anything MCP-transport-specific.
- **Keep `USE_MOCK_MCP` working.** The mock stays the default and the test double; the real client is opt-in via `USE_MOCK_MCP=false`.

---

## File Structure

**Create:**
- `src/mcp/oauth/oauth-state.store.ts` — in-memory store backing the provider: client information (from DCR), tokens, PKCE code verifier, and the pending authorization URL. Has `isAuthenticated()`.
- `src/mcp/oauth/swiggy-oauth.provider.ts` — implements the SDK's `OAuthClientProvider` interface (clientMetadata, redirectUrl, client-info + token + verifier persistence, `redirectToAuthorization`). The SDK drives DCR/discovery/PKCE through it.
- `src/mcp/oauth/oauth.controller.ts` — `GET /oauth/login` (kick off `auth()` → 302 to Swiggy), `GET /oauth/callback` (`transport.finishAuth(code)`), `GET /oauth/status`.
- `src/mcp/real/swiggy-response.adapter.ts` — pure functions mapping raw tool JSON → domain types (`RestaurantResult`, `SwiggyAddress`).
- `src/mcp/real/real-swiggy-mcp.client.ts` — implements `SwiggyMcpClient` over `@modelcontextprotocol/sdk` with 401 re-auth.
- `src/mcp/real/mcp-session.factory.ts` — creates/holds the MCP `Client` + `StreamableHTTPClientTransport` wired with the `OAuthClientProvider`; exposes the transport so the callback route can call `finishAuth`.
- `src/mcp/real/debug.controller.ts` — dev-only route to capture raw live tool payloads (guarded; removed before production).
- `scripts/introspect-sdk-auth.ts` — throwaway script to pin the installed SDK's OAuth export surface.
- Jest test files alongside (`*.spec.ts`) as listed per task.

**Modify:**
- `src/mcp/mcp-client.interface.ts` — new domain types + method signatures.
- `src/mcp/mock-swiggy-mcp.client.ts` — conform to new interface (rename dir target: move under `src/mcp/mock/`? No — leave in place to minimize churn; just update contents).
- `src/mcp/mcp.module.ts` — factory selects Mock vs Real on `USE_MOCK_MCP`; register OAuth providers + controller.
- `src/suggestions/suggestions.service.ts` — resolve `addressId` via `getAddresses()`, drive cart-based ordering.
- `src/suggestions/suggestions.controller.ts` — accept `addressId` (optional) and a `confirm` flag on the order path.
- `src/app.module.ts` — evaluate `MONGO_URI` lazily via `MongooseModule.forRootAsync` so `.env` is honored.
- `.env.example` and `.env` — drop `SWIGGY_MCP_CLIENT_ID/SECRET`; add `SWIGGY_MCP_BASE_URL`, `SWIGGY_OAUTH_REDIRECT_URI`, `ALLOW_REAL_ORDERS`.
- `package.json` — add `@modelcontextprotocol/sdk`; add `jest`, `ts-jest`, `@types/jest`; add `test` + `smoke:mcp` scripts.

---

## Phase 1 — Prerequisites & test harness

### Task 1.1: Runtime prerequisites (Mongo + deps + test runner)

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`

**Interfaces:**
- Produces: `npm test` runs Jest over `src/**/*.spec.ts`; `@modelcontextprotocol/sdk` importable.

- [ ] **Step 1: Confirm a local MongoDB is reachable** (the app and seed both need it). Either install and start it, or use `mongodb-memory-server` for dev.

```bash
# Option A: system Mongo
brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community
# verify
nc -z localhost 27017 && echo "mongo up"
```

- [ ] **Step 2: Add dependencies**

```bash
npm install @modelcontextprotocol/sdk
npm install -D jest ts-jest @types/jest
```

- [ ] **Step 3: Add Jest config**

```js
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testRegex: '.*\\.spec\\.ts$',
};
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
"test": "jest",
"introspect:sdk": "ts-node scripts/introspect-sdk-auth.ts"
```

- [ ] **Step 5: Verify the harness runs (no tests yet is fine)**

Run: `npx jest --passWithNoTests`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json jest.config.js
git commit -m "chore: add MCP SDK, jest harness, and order/oauth env scaffolding"
```

### Task 1.2: Fix `.env` loading and env schema

**Files:**
- Modify: `src/app.module.ts`
- Modify: `.env.example`, `.env`

**Interfaces:**
- Produces: `MONGO_URI` and all Swiggy env vars are read *after* `ConfigModule` loads `.env`.

- [ ] **Step 1: Replace eager `forRoot` with `forRootAsync`** in `src/app.module.ts` so the URI is read from `ConfigService`, not from `process.env` at array-build time.

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SuggestionsModule } from './suggestions/suggestions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI') ?? 'mongodb://localhost:27017/smart-order-agent',
      }),
    }),
    SuggestionsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Rewrite `.env.example`**

```
# Mongo
MONGO_URI=mongodb://localhost:27017/smart-order-agent

# Swiggy MCP (OAuth 2.1 + PKCE — no client secret; DCR handles client identity)
SWIGGY_MCP_BASE_URL=https://mcp.swiggy.com
SWIGGY_OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback
USE_MOCK_MCP=true

# Ordering safety: real orders are placed ONLY when this is true AND the request sends confirm:true
ALLOW_REAL_ORDERS=false

# App
PORT=3000
DEFAULT_USER_ID=dj
```

- [ ] **Step 3: Mirror the same keys into `.env`** (keep `USE_MOCK_MCP=true`, `ALLOW_REAL_ORDERS=false`).

- [ ] **Step 4: Verify app still boots against Mongo with the mock**

Run: `npm run seed && npm run start` then `curl "http://localhost:3000/suggestions?userId=dj&lat=28.6&lng=77.2"`
Expected: 5 suggestions returned (mock path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts .env.example .env
git commit -m "fix: read Mongo URI + Swiggy config after ConfigModule loads .env"
```

---

## Phase 2 — OAuth via the SDK's `OAuthClientProvider` (idiomatic MCP)

> **Approach (Option B):** We do NOT hand-roll PKCE, DCR, or the token exchange. We implement the MCP SDK's `OAuthClientProvider` and let `StreamableHTTPClientTransport` run discovery (`.well-known`), Dynamic Client Registration (`/auth/register`), PKCE, and the code exchange. Our code only (a) persists the provider's state in memory and (b) bridges the browser redirect through two HTTP routes. This is the "proper MCP" path the Builders showcase should demonstrate.

### Task 2.1: Env schema + pin the SDK auth surface

**Files:**
- Modify: `.env.example`, `.env` (redirect URI still required for the provider)
- Create: `scripts/introspect-sdk-auth.ts` (throwaway, committed for reference)

**Interfaces:**
- Produces: confirmed import paths + method names for `OAuthClientProvider`, `StreamableHTTPClientTransport` (with `authProvider` option + `finishAuth`), and `UnauthorizedError`, pinned to the installed SDK version.

> The `@modelcontextprotocol/sdk` OAuth surface has shifted across versions. Before writing the provider, confirm the exact shape from the installed package rather than trusting this plan's memory of it. Everything below targets the modern surface: `OAuthClientProvider` from `@modelcontextprotocol/sdk/client/auth.js`, transport option `authProvider`, and `transport.finishAuth(code)`.

- [ ] **Step 1: Ensure redirect URI env exists** (already added in Task 1.2 — verify `SWIGGY_OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback` is present in `.env` and `.env.example`).

- [ ] **Step 2: Introspect the installed SDK auth exports**

```ts
// scripts/introspect-sdk-auth.ts
import * as auth from '@modelcontextprotocol/sdk/client/auth.js';
import * as sh from '@modelcontextprotocol/sdk/client/streamableHttp.js';
console.log('auth exports:', Object.keys(auth));
console.log('streamableHttp exports:', Object.keys(sh));
```

Run: `npx ts-node scripts/introspect-sdk-auth.ts`
Expected: `auth exports` includes `OAuthClientProvider` (type — may not print) and `UnauthorizedError`; `streamableHttp exports` includes `StreamableHTTPClientTransport`. Open the package's `dist/**/auth.d.ts` to read the exact `OAuthClientProvider` member names, and reconcile Task 2.3 against them.

- [ ] **Step 3: Commit**

```bash
git add scripts/introspect-sdk-auth.ts .env.example .env
git commit -m "chore(oauth): pin MCP SDK auth surface; keep redirect-uri env"
```

### Task 2.2: In-memory OAuth state store

**Files:**
- Create: `src/mcp/oauth/oauth-state.store.ts`
- Test: `src/mcp/oauth/oauth-state.store.spec.ts`

**Interfaces:**
- Produces injectable `OAuthStateStore` — the backing memory the provider reads/writes:
  - `clientInfo: OAuthClientInformationFull | undefined` (get/set)
  - `tokens: OAuthTokens | undefined` (get/set)
  - `codeVerifier: string | undefined` (get/set)
  - `pendingAuthUrl: URL | undefined` (get/set) — where `redirectToAuthorization` stashes the URL so the HTTP layer can 302
  - `isAuthenticated(): boolean` — true when `tokens?.access_token` is present
  - `clear(): void`

> Types `OAuthClientInformationFull` / `OAuthTokens` come from `@modelcontextprotocol/sdk/shared/auth.js`. If those import paths differ in the installed version (checked in Task 2.1), use the version's actual export path — the store logic is identical.

- [ ] **Step 1: Write the failing test**

```ts
// src/mcp/oauth/oauth-state.store.spec.ts
import { OAuthStateStore } from './oauth-state.store';

describe('OAuthStateStore', () => {
  it('round-trips tokens and reports authenticated', () => {
    const s = new OAuthStateStore();
    expect(s.isAuthenticated()).toBe(false);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    expect(s.isAuthenticated()).toBe(true);
    expect(s.tokens?.access_token).toBe('abc');
  });

  it('stores code verifier and pending auth url', () => {
    const s = new OAuthStateStore();
    s.codeVerifier = 'v';
    s.pendingAuthUrl = new URL('https://mcp.swiggy.com/auth/authorize?x=1');
    expect(s.codeVerifier).toBe('v');
    expect(s.pendingAuthUrl?.searchParams.get('x')).toBe('1');
  });

  it('clear wipes everything', () => {
    const s = new OAuthStateStore();
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    s.clear();
    expect(s.isAuthenticated()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/mcp/oauth/oauth-state.store.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/mcp/oauth/oauth-state.store.ts
import { Injectable } from '@nestjs/common';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

@Injectable()
export class OAuthStateStore {
  clientInfo: OAuthClientInformationFull | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  pendingAuthUrl: URL | undefined;

  isAuthenticated(): boolean {
    return !!this.tokens?.access_token;
  }

  clear(): void {
    this.clientInfo = undefined;
    this.tokens = undefined;
    this.codeVerifier = undefined;
    this.pendingAuthUrl = undefined;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/mcp/oauth/oauth-state.store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/oauth/oauth-state.store.ts src/mcp/oauth/oauth-state.store.spec.ts
git commit -m "feat(oauth): in-memory state store backing the OAuthClientProvider"
```

### Task 2.3: `SwiggyOAuthProvider implements OAuthClientProvider`

**Files:**
- Create: `src/mcp/oauth/swiggy-oauth.provider.ts`
- Test: `src/mcp/oauth/swiggy-oauth.provider.spec.ts`

**Interfaces:**
- Consumes: `OAuthStateStore` (2.2), `ConfigService`.
- Produces `SwiggyOAuthProvider` satisfying the SDK's `OAuthClientProvider`:
  - `get redirectUrl(): string` → `SWIGGY_OAUTH_REDIRECT_URI`
  - `get clientMetadata(): OAuthClientMetadata` → `{ client_name, redirect_uris, grant_types: ['authorization_code'], response_types: ['code'], scope: 'mcp:tools mcp:resources mcp:prompts' }`
  - `clientInformation()` / `saveClientInformation(info)` → store
  - `tokens()` / `saveTokens(t)` → store
  - `saveCodeVerifier(v)` / `codeVerifier()` → store
  - `redirectToAuthorization(url: URL)` → stash into `store.pendingAuthUrl` (do NOT navigate — the HTTP layer does the 302)
  - `state()` → random string

> `grant_types` omits `refresh_token` because v1.0 doesn't issue refresh tokens. The Mastra example lists `refresh_token`, but our provider stays honest to what Swiggy supports today.

- [ ] **Step 1: Write the failing test**

```ts
// src/mcp/oauth/swiggy-oauth.provider.spec.ts
import { SwiggyOAuthProvider } from './swiggy-oauth.provider';
import { OAuthStateStore } from './oauth-state.store';

const config = {
  get: (k: string) =>
    ({ SWIGGY_OAUTH_REDIRECT_URI: 'http://localhost:3000/oauth/callback' } as Record<string, string>)[k],
} as any;

describe('SwiggyOAuthProvider', () => {
  it('exposes redirect url and honest client metadata', () => {
    const p = new SwiggyOAuthProvider(config, new OAuthStateStore());
    expect(p.redirectUrl).toBe('http://localhost:3000/oauth/callback');
    expect(p.clientMetadata.grant_types).toEqual(['authorization_code']); // no refresh_token in v1
    expect(p.clientMetadata.redirect_uris).toContain('http://localhost:3000/oauth/callback');
  });

  it('redirectToAuthorization stashes the url instead of navigating', async () => {
    const store = new OAuthStateStore();
    const p = new SwiggyOAuthProvider(config, store);
    await p.redirectToAuthorization(new URL('https://mcp.swiggy.com/auth/authorize?code_challenge=x'));
    expect(store.pendingAuthUrl?.searchParams.get('code_challenge')).toBe('x');
  });

  it('persists code verifier and tokens through the store', async () => {
    const store = new OAuthStateStore();
    const p = new SwiggyOAuthProvider(config, store);
    await p.saveCodeVerifier('ver');
    expect(await p.codeVerifier()).toBe('ver');
    await p.saveTokens({ access_token: 't', token_type: 'Bearer' } as any);
    expect((await p.tokens())?.access_token).toBe('t');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/mcp/oauth/swiggy-oauth.provider.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/mcp/oauth/swiggy-oauth.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthStateStore } from './oauth-state.store';

@Injectable()
export class SwiggyOAuthProvider implements OAuthClientProvider {
  constructor(private config: ConfigService, private store: OAuthStateStore) {}

  get redirectUrl(): string {
    return (
      this.config.get<string>('SWIGGY_OAUTH_REDIRECT_URI') ??
      'http://localhost:3000/oauth/callback'
    );
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'smart-order-agent',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code'], // v1.0 issues no refresh tokens
      response_types: ['code'],
      scope: 'mcp:tools mcp:resources mcp:prompts',
    };
  }

  state(): string {
    return randomBytes(16).toString('base64url');
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.store.clientInfo;
  }
  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.store.tokens;
  }
  saveTokens(tokens: OAuthTokens): void {
    this.store.tokens = tokens;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.codeVerifier = codeVerifier;
  }
  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error('No PKCE code verifier stored');
    return this.store.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Don't navigate here (we're server-side). Stash it; the /oauth/login route 302s the user.
    this.store.pendingAuthUrl = authorizationUrl;
  }

  invalidateCredentials(): void {
    this.store.clear();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/mcp/oauth/swiggy-oauth.provider.spec.ts`
Expected: PASS. (If the installed SDK's `OAuthClientProvider` declares extra required members, add them per Task 2.1's introspection — the store already holds the state they need.)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/oauth/swiggy-oauth.provider.ts src/mcp/oauth/swiggy-oauth.provider.spec.ts
git commit -m "feat(oauth): SwiggyOAuthProvider implementing the SDK OAuthClientProvider"
```

### Task 2.4: MCP session factory + OAuth controller (browser bridge)

**Files:**
- Create: `src/mcp/real/mcp-session.factory.ts`
- Create: `src/mcp/oauth/oauth.controller.ts`
- Modify: `src/mcp/mcp.module.ts` (interim registration — finalized in Task 3.5)

**Interfaces:**
- Consumes: `SwiggyOAuthProvider` (2.3), `OAuthStateStore` (2.2), `ConfigService`, SDK `Client` + `StreamableHTTPClientTransport`.
- Produces:
  - `McpSessionFactory`:
    - `beginAuth(): Promise<URL>` — builds a transport with the provider, attempts `client.connect()`; the SDK triggers the provider's `redirectToAuthorization`; returns `store.pendingAuthUrl`. Swallows the expected `UnauthorizedError`.
    - `completeAuth(code: string): Promise<void>` — `transport.finishAuth(code)` then `client.connect()` to establish the authenticated session.
    - `getClient(): Promise<Client>` — returns the connected client; throws `UnauthorizedException` when `!store.isAuthenticated()`.
    - `reset(): void`.
  - Routes: `GET /oauth/login` (302 → Swiggy), `GET /oauth/callback?code` (completeAuth → success page), `GET /oauth/status`.

> `beginAuth`/`completeAuth` orchestration is the version-sensitive part. The canonical modern pattern is: create ONE `transport` instance, `connect()` (throws `UnauthorizedError`, provider has stashed the URL), redirect user; on callback call `transport.finishAuth(code)` on the SAME transport, then `connect()` again. Keep a single transport+client pair on the factory instance. Reconcile against Task 2.1's introspection.

- [ ] **Step 1: Implement the session factory**

```ts
// src/mcp/real/mcp-session.factory.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SwiggyOAuthProvider } from '../oauth/swiggy-oauth.provider';
import { OAuthStateStore } from '../oauth/oauth-state.store';

@Injectable()
export class McpSessionFactory {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(
    private config: ConfigService,
    private provider: SwiggyOAuthProvider,
    private store: OAuthStateStore,
  ) {}

  private serverUrl(): URL {
    const base = this.config.get<string>('SWIGGY_MCP_BASE_URL') ?? 'https://mcp.swiggy.com';
    return new URL(`${base}/food`);
  }

  private ensureTransport(): { client: Client; transport: StreamableHTTPClientTransport } {
    if (!this.transport || !this.client) {
      this.transport = new StreamableHTTPClientTransport(this.serverUrl(), {
        authProvider: this.provider,
      });
      this.client = new Client({ name: 'smart-order-agent', version: '0.1.0' });
    }
    return { client: this.client, transport: this.transport };
  }

  async beginAuth(): Promise<URL> {
    const { client, transport } = this.ensureTransport();
    try {
      await client.connect(transport); // triggers DCR + discovery + PKCE, then throws
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e;
    }
    if (!this.store.pendingAuthUrl) throw new Error('No authorization URL produced by the SDK');
    return this.store.pendingAuthUrl;
  }

  async completeAuth(code: string): Promise<void> {
    const { client, transport } = this.ensureTransport();
    await transport.finishAuth(code); // exchanges code using stored verifier + client info
    await client.connect(transport); // now authenticated
  }

  async getClient(): Promise<Client> {
    if (!this.store.isAuthenticated()) {
      throw new UnauthorizedException('Not authenticated — visit /oauth/login');
    }
    const { client, transport } = this.ensureTransport();
    // Connect once; subsequent calls reuse the live client.
    if (!(client as any)._connected) {
      try {
        await client.connect(transport);
      } catch {
        /* already connected is fine */
      }
    }
    return client;
  }

  reset(): void {
    this.client = null;
    this.transport = null;
  }
}
```

- [ ] **Step 2: Implement the controller**

```ts
// src/mcp/oauth/oauth.controller.ts
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { McpSessionFactory } from '../real/mcp-session.factory';
import { OAuthStateStore } from './oauth-state.store';

@Controller('oauth')
export class OAuthController {
  constructor(private sessions: McpSessionFactory, private store: OAuthStateStore) {}

  @Get('login')
  async login(@Res() res: Response) {
    const url = await this.sessions.beginAuth();
    return res.redirect(url.toString());
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    if (!code) return res.status(400).send('Missing authorization code');
    await this.sessions.completeAuth(code);
    return res.send('Swiggy MCP connected. Close this tab and hit /suggestions.');
  }

  @Get('status')
  status() {
    return { authenticated: this.store.isAuthenticated() };
  }
}
```

- [ ] **Step 3: Interim registration in `McpModule`** (finalized in Task 3.5)

```ts
// src/mcp/mcp.module.ts (interim @Module)
// providers: [OAuthStateStore, SwiggyOAuthProvider, McpSessionFactory, ...]
// controllers: [OAuthController]
// exports: [OAuthStateStore]
```

- [ ] **Step 4: Verify boot + status route**

Run: `npm run start` then `curl -i "http://localhost:3000/oauth/status"`
Expected: `200 {"authenticated":false}`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/real/mcp-session.factory.ts src/mcp/oauth/oauth.controller.ts src/mcp/mcp.module.ts
git commit -m "feat(oauth): SDK-driven auth session factory + /oauth login/callback/status"
```

---

## Phase 3 — Real MCP client + interface refactor (read path)

### Task 3.1: Refactor `SwiggyMcpClient` interface and domain types

**Files:**
- Modify: `src/mcp/mcp-client.interface.ts`

**Interfaces:**
- Produces the new contract consumed by mock, real client, and `SuggestionsService`:

```ts
// src/mcp/mcp-client.interface.ts
export interface SwiggyAddress {
  addressId: string;
  label: string;        // "Home" | "Work" | ...
  displayText?: string; // human-readable address line (no coordinates ever)
}

export interface RestaurantResult {
  restaurantId: string;
  name: string;
  cuisine: string;      // primary cuisine (first of cuisines[]), lowercased+snaked for ranking
  avgPrice: number;     // costForTwo (rupees)
  isOpen: boolean;      // derived from availabilityStatus === "OPEN"
  etaMinutes: number;   // delivery ETA (minutes)
  rating: number;       // 0..5
  distanceKm?: number;
}

export interface SearchRestaurantsParams {
  addressId: string;
  query: string;        // required by the real tool; SuggestionsService supplies a cuisine/meal term
  offset?: number;
}

// --- ordering (cart journey) ---
export interface CartItemRef { itemId: string; quantity: number; }

export interface BuildCartParams {
  restaurantId: string;
  items: CartItemRef[];
}

export interface CartSummary {
  restaurantId: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;        // rupees
}

export interface PlaceOrderResult {
  orderId: string;
  status: string;
  etaMinutes: number;
}

export interface SwiggyMcpClient {
  getAddresses(): Promise<SwiggyAddress[]>;
  searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]>;
  buildCart(params: BuildCartParams): Promise<CartSummary>;   // update_food_cart + get_food_cart
  placeOrder(): Promise<PlaceOrderResult>;                    // place_food_order (COD); guarded by caller
}
```

- [ ] **Step 1: Replace the file contents** with the block above.
- [ ] **Step 2: Typecheck (expected to fail in mock + suggestions — fixed next tasks)**

Run: `npx tsc --noEmit`
Expected: errors only in `mock-swiggy-mcp.client.ts` and `suggestions.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/mcp-client.interface.ts
git commit -m "refactor(mcp): interface matches real Swiggy Food tool contracts"
```

### Task 3.2: Update `MockSwiggyMcpClient` to the new interface

**Files:**
- Modify: `src/mcp/mock-swiggy-mcp.client.ts`
- Test: `src/mcp/mock-swiggy-mcp.client.spec.ts`

**Interfaces:**
- Consumes: new `SwiggyMcpClient` (Task 3.1).
- Produces: mock returning deterministic addresses, restaurants (with `isOpen` derived), and a fake cart/order.

- [ ] **Step 1: Write the failing test**

```ts
// src/mcp/mock-swiggy-mcp.client.spec.ts
import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';

describe('MockSwiggyMcpClient', () => {
  const c = new MockSwiggyMcpClient();

  it('returns at least one saved address', async () => {
    const a = await c.getAddresses();
    expect(a[0].addressId).toBeTruthy();
  });

  it('search filters to a query and includes open flag', async () => {
    const r = await c.searchRestaurants({ addressId: 'addr_home', query: 'biryani' });
    expect(r.every((x) => typeof x.isOpen === 'boolean')).toBe(true);
    expect(r.some((x) => x.cuisine === 'biryani')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/mcp/mock-swiggy-mcp.client.spec.ts`
Expected: FAIL (methods missing / wrong signature).

- [ ] **Step 3: Rewrite the mock**

```ts
// src/mcp/mock-swiggy-mcp.client.ts
import { Injectable } from '@nestjs/common';
import {
  BuildCartParams, CartSummary, PlaceOrderResult, RestaurantResult,
  SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient,
} from './mcp-client.interface';

const MOCK_RESTAURANTS: RestaurantResult[] = [
  { restaurantId: 'r1', name: 'Bawarchi Biryani House', cuisine: 'biryani', avgPrice: 350, isOpen: true, etaMinutes: 32, rating: 4.3, distanceKm: 2.1 },
  { restaurantId: 'r2', name: 'Wok This Way', cuisine: 'chinese', avgPrice: 420, isOpen: true, etaMinutes: 28, rating: 4.1, distanceKm: 3.0 },
  { restaurantId: 'r3', name: 'Punjab Grill Express', cuisine: 'north_indian', avgPrice: 500, isOpen: true, etaMinutes: 40, rating: 4.4, distanceKm: 5.2 },
  { restaurantId: 'r4', name: 'Sushi Yama', cuisine: 'japanese', avgPrice: 650, isOpen: false, etaMinutes: 0, rating: 4.6, distanceKm: 6.0 },
  { restaurantId: 'r5', name: 'Pizza Republic', cuisine: 'italian', avgPrice: 380, isOpen: true, etaMinutes: 25, rating: 4.0, distanceKm: 1.4 },
  { restaurantId: 'r6', name: 'South Spice', cuisine: 'south_indian', avgPrice: 220, isOpen: true, etaMinutes: 20, rating: 4.5, distanceKm: 1.1 },
  { restaurantId: 'r7', name: 'Thai Basil Kitchen', cuisine: 'thai', avgPrice: 480, isOpen: true, etaMinutes: 35, rating: 4.2, distanceKm: 4.4 },
  { restaurantId: 'r8', name: 'Momo Point', cuisine: 'tibetan', avgPrice: 180, isOpen: true, etaMinutes: 22, rating: 4.3, distanceKm: 2.8 },
];

@Injectable()
export class MockSwiggyMcpClient implements SwiggyMcpClient {
  async getAddresses(): Promise<SwiggyAddress[]> {
    await this.latency();
    return [
      { addressId: 'addr_home', label: 'Home', displayText: 'Home, Sector 21' },
      { addressId: 'addr_work', label: 'Work', displayText: 'Work, Cyber Hub' },
    ];
  }

  async searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]> {
    await this.latency();
    const q = params.query?.toLowerCase().trim();
    if (!q || q === 'popular' || q === 'best food') return MOCK_RESTAURANTS;
    return MOCK_RESTAURANTS.filter(
      (r) => r.cuisine.includes(q) || r.name.toLowerCase().includes(q),
    );
  }

  async buildCart(params: BuildCartParams): Promise<CartSummary> {
    await this.latency();
    const r = MOCK_RESTAURANTS.find((x) => x.restaurantId === params.restaurantId);
    return {
      restaurantId: params.restaurantId,
      restaurantName: r?.name ?? 'Unknown',
      items: params.items.map((i) => ({ name: `item-${i.itemId}`, quantity: i.quantity, price: 200 })),
      total: params.items.reduce((s, i) => s + 200 * i.quantity, 0),
    };
  }

  async placeOrder(): Promise<PlaceOrderResult> {
    await this.latency();
    return { orderId: `mock-${Date.now()}`, status: 'placed', etaMinutes: 30 };
  }

  private latency() {
    return new Promise((r) => setTimeout(r, 50));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/mcp/mock-swiggy-mcp.client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mock-swiggy-mcp.client.ts src/mcp/mock-swiggy-mcp.client.spec.ts
git commit -m "refactor(mcp): mock client conforms to new interface"
```

### Task 3.3: Response adapters (raw tool JSON → domain types)

**Files:**
- Create: `src/mcp/real/swiggy-response.adapter.ts`
- Test: `src/mcp/real/swiggy-response.adapter.spec.ts`

**Interfaces:**
- Produces:
  - `toAddresses(data: unknown): SwiggyAddress[]`
  - `toRestaurants(data: unknown): RestaurantResult[]`

> **Verification note (not a placeholder):** the docs pin the *fields that exist* — `addressId`/`label`, and per-restaurant `availabilityStatus`, `distanceKm`, plus name/cuisines/rating/costForTwo/eta — but **not the exact envelope key names** of the `data` payload. The adapter is written defensively against the documented field names AND records the actual shape via Task 3.7's captured fixture. If the live JSON differs, the ONLY change needed is the field-picking inside these two functions. Test uses a fixture that mirrors the documented `{ success, data }` shape; replace the fixture with the real captured payload from Task 3.7 and adjust the picks if needed.

- [ ] **Step 1: Write the failing test** (fixture reflects documented fields)

```ts
// src/mcp/real/swiggy-response.adapter.spec.ts
import { toAddresses, toRestaurants } from './swiggy-response.adapter';

describe('swiggy adapters', () => {
  it('maps addresses (no coordinates)', () => {
    const data = [{ addressId: 'addr_1', label: 'Home', displayText: 'Home, Sec 21' }];
    expect(toAddresses(data)).toEqual([
      { addressId: 'addr_1', label: 'Home', displayText: 'Home, Sec 21' },
    ]);
  });

  it('maps restaurants, derives isOpen and snake-cases primary cuisine', () => {
    const data = {
      restaurants: [
        {
          id: 'r1',
          name: 'Bawarchi Biryani House',
          cuisines: ['Biryani', 'North Indian'],
          costForTwo: 350,
          availabilityStatus: 'OPEN',
          rating: 4.3,
          etaMinutes: 32,
          distanceKm: 2.1,
        },
        { id: 'r2', name: 'Closed Place', cuisines: ['Thai'], costForTwo: 400, availabilityStatus: 'CLOSED', rating: 4.0, etaMinutes: 0 },
      ],
    };
    const out = toRestaurants(data);
    expect(out[0]).toMatchObject({ restaurantId: 'r1', cuisine: 'biryani', isOpen: true, avgPrice: 350 });
    expect(out[1].isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/mcp/real/swiggy-response.adapter.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/mcp/real/swiggy-response.adapter.ts
import { RestaurantResult, SwiggyAddress } from '../mcp-client.interface';

function snake(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

export function toAddresses(data: unknown): SwiggyAddress[] {
  const arr = Array.isArray(data) ? data : (data as any)?.addresses ?? [];
  return arr.map((a: any) => ({
    addressId: a.addressId ?? a.id,
    label: a.label ?? a.type ?? 'Address',
    displayText: a.displayText ?? a.address ?? undefined,
  }));
}

export function toRestaurants(data: unknown): RestaurantResult[] {
  const arr = (data as any)?.restaurants ?? (Array.isArray(data) ? data : []);
  return arr.map((r: any) => ({
    restaurantId: r.id ?? r.restaurantId,
    name: r.name,
    cuisine: snake((r.cuisines?.[0] ?? r.cuisine ?? 'unknown') as string),
    avgPrice: Number(r.costForTwo ?? r.avgPrice ?? 0),
    isOpen: (r.availabilityStatus ?? (r.isOpen ? 'OPEN' : 'CLOSED')) === 'OPEN',
    etaMinutes: Number(r.etaMinutes ?? r.sla?.deliveryTime ?? 0),
    rating: Number(r.rating ?? r.avgRating ?? 0),
    distanceKm: r.distanceKm != null ? Number(r.distanceKm) : undefined,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/mcp/real/swiggy-response.adapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/real/swiggy-response.adapter.ts src/mcp/real/swiggy-response.adapter.spec.ts
git commit -m "feat(mcp): defensive adapters from Swiggy tool payloads to domain types"
```

### Task 3.4: `RealSwiggyMcpClient`

**Files:**
- Create: `src/mcp/real/real-swiggy-mcp.client.ts`

(The `McpSessionFactory` was built in Task 2.4; this task only adds the client that drives tool calls through it.)

**Interfaces:**
- Consumes: `McpSessionFactory` (2.4), `OAuthStateStore` (2.2), adapters (3.3).
- Produces:
  - `RealSwiggyMcpClient implements SwiggyMcpClient` — calls tools via the authenticated client, unwraps `{ success, data }`, runs adapters, and on 401 / `UnauthorizedError` clears OAuth state so the next request forces a fresh `/oauth/login`.

> The MCP SDK's `callTool` returns `{ content: [...] }`; Swiggy wraps the domain payload as JSON text/structured content. `unwrap()` centralizes pulling `{ success, data, error }` out of the tool result and throwing on `success === false`. This is the second spot (besides adapters) to reconcile with the live shape captured in Task 3.7.

- [ ] **Step 1: Implement the real client**

```ts
// src/mcp/real/real-swiggy-mcp.client.ts
import { Injectable } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  BuildCartParams, CartSummary, PlaceOrderResult, RestaurantResult,
  SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient,
} from '../mcp-client.interface';
import { McpSessionFactory } from './mcp-session.factory';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { toAddresses, toRestaurants } from './swiggy-response.adapter';

@Injectable()
export class RealSwiggyMcpClient implements SwiggyMcpClient {
  constructor(private sessions: McpSessionFactory, private store: OAuthStateStore) {}

  private unwrap(result: any): any {
    // Swiggy tools return { success, data, message } | { success:false, error }
    const raw =
      result?.structuredContent ??
      (typeof result?.content?.[0]?.text === 'string'
        ? JSON.parse(result.content[0].text)
        : result);
    if (raw && raw.success === false) {
      throw new Error(raw.error?.message ?? 'Swiggy tool call failed');
    }
    return raw?.data ?? raw;
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const run = async () => {
      const client = await this.sessions.getClient();
      return client.callTool({ name, arguments: args });
    };
    try {
      return this.unwrap(await run());
    } catch (e: any) {
      const unauthorized = e instanceof UnauthorizedError || e?.status === 401 || e?.code === -32001;
      if (unauthorized) {
        this.store.clear();
        this.sessions.reset();
        throw new Error('Swiggy session expired — re-authenticate at /oauth/login');
      }
      throw e;
    }
  }

  async getAddresses(): Promise<SwiggyAddress[]> {
    return toAddresses(await this.call('get_addresses', {}));
  }

  async searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]> {
    return toRestaurants(
      await this.call('search_restaurants', {
        addressId: params.addressId,
        query: params.query,
        ...(params.offset ? { offset: params.offset } : {}),
      }),
    );
  }

  async buildCart(params: BuildCartParams): Promise<CartSummary> {
    await this.call('update_food_cart', { restaurantId: params.restaurantId, items: params.items });
    const cart = await this.call('get_food_cart', {});
    return {
      restaurantId: params.restaurantId,
      restaurantName: cart?.restaurantName ?? '',
      items: (cart?.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
      total: Number(cart?.total ?? 0),
    };
  }

  async placeOrder(): Promise<PlaceOrderResult> {
    const order = await this.call('place_food_order', { paymentMethod: 'COD' });
    return {
      orderId: order?.orderId,
      status: order?.status ?? 'placed',
      etaMinutes: Number(order?.etaMinutes ?? 0),
    };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (import paths for the SDK resolve; if a subpath differs, adjust the `@modelcontextprotocol/sdk/...` imports per the installed version's `exports`).

- [ ] **Step 3: Commit**

```bash
git add src/mcp/real/real-swiggy-mcp.client.ts
git commit -m "feat(mcp): real Swiggy Food client driving tools via the OAuth session"
```

### Task 3.5: Wire `USE_MOCK_MCP` in `McpModule`

**Files:**
- Modify: `src/mcp/mcp.module.ts`

**Interfaces:**
- Produces: `SWIGGY_MCP_CLIENT` resolves to `RealSwiggyMcpClient` when `USE_MOCK_MCP=false`, else `MockSwiggyMcpClient`. Registers the OAuth provider stack + controller. Exports `OAuthStateStore`.

- [ ] **Step 1: Implement the factory module**

```ts
// src/mcp/mcp.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';
import { RealSwiggyMcpClient } from './real/real-swiggy-mcp.client';
import { McpSessionFactory } from './real/mcp-session.factory';
import { OAuthStateStore } from './oauth/oauth-state.store';
import { SwiggyOAuthProvider } from './oauth/swiggy-oauth.provider';
import { OAuthController } from './oauth/oauth.controller';

export const SWIGGY_MCP_CLIENT = 'SWIGGY_MCP_CLIENT';

@Module({
  controllers: [OAuthController],
  providers: [
    OAuthStateStore,
    SwiggyOAuthProvider,
    McpSessionFactory,
    MockSwiggyMcpClient,
    RealSwiggyMcpClient,
    {
      provide: SWIGGY_MCP_CLIENT,
      inject: [ConfigService, MockSwiggyMcpClient, RealSwiggyMcpClient],
      useFactory: (config: ConfigService, mock: MockSwiggyMcpClient, real: RealSwiggyMcpClient) =>
        config.get('USE_MOCK_MCP') === 'false' ? real : mock,
    },
  ],
  exports: [SWIGGY_MCP_CLIENT, OAuthStateStore],
})
export class McpModule {}
```

- [ ] **Step 2: Verify both modes boot**

Run (mock): `USE_MOCK_MCP=true npm run start` → `curl "http://localhost:3000/suggestions?userId=dj&lat=28.6&lng=77.2"` → 5 suggestions.
Run (real, unauthenticated): `USE_MOCK_MCP=false npm run start` → `curl "http://localhost:3000/suggestions?userId=dj&lat=28.6&lng=77.2"` → 401 pointing to `/oauth/login`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/mcp.module.ts
git commit -m "feat(mcp): select mock vs real client via USE_MOCK_MCP"
```

### Task 3.6: `SuggestionsService` resolves address → search → rank

**Files:**
- Modify: `src/suggestions/suggestions.service.ts`
- Modify: `src/suggestions/suggestions.controller.ts`
- Test: `src/suggestions/suggestions.service.spec.ts`

**Interfaces:**
- Consumes: new `SwiggyMcpClient`, `PreferencesService`, `RankingService`.
- Produces:
  - `getTopSuggestions(userId: string, addressId?: string): Promise<RankedSuggestion[]>` — picks the address (given id, else first from `getAddresses()`), derives a search `query` from the user's top cuisine (or a meal-time default), searches, ranks.
  - `acceptSuggestion(userId, restaurantId, items, confirm)` and `skipSuggestion` unchanged in intent (ordering wiring lands in Phase 4).

> Behavior change: search now needs a `query` and an `addressId`. Query strategy: use the profile's most-frequent cuisine; if the profile is empty (cold start), fall back to a meal-time term (`lunch→"thali"`, `dinner→"biryani"`, `evening_snack→"rolls"`, `late_night→"pizza"`, `breakfast→"south indian"`). Because ranking still needs a broad candidate pool, run search for the **top 2** profile cuisines (or the single meal-time default) and merge/de-dupe results before ranking.

- [ ] **Step 1: Write the failing test** (inject fakes)

```ts
// src/suggestions/suggestions.service.spec.ts
import { SuggestionsService } from './suggestions.service';

const fakeMcp = {
  getAddresses: async () => [{ addressId: 'addr_home', label: 'Home' }],
  searchRestaurants: async () => [
    { restaurantId: 'r1', name: 'Bawarchi', cuisine: 'biryani', avgPrice: 350, isOpen: true, etaMinutes: 30, rating: 4.3 },
  ],
  buildCart: async () => ({ restaurantId: 'r1', restaurantName: 'Bawarchi', items: [], total: 0 }),
  placeOrder: async () => ({ orderId: 'o1', status: 'placed', etaMinutes: 30 }),
} as any;

const fakePrefs = {
  getProfile: async () => ({
    cuisineCounts: { biryani: 3 }, avgOrderValue: 350,
    timeSlotCounts: { dinner: 3 }, recentRestaurantIds: [], rejectedRestaurantIds: [],
  }),
  recordFeedback: async () => undefined,
} as any;

import { RankingService } from '../ranking/ranking.service';

describe('SuggestionsService', () => {
  it('resolves an address and returns ranked suggestions', async () => {
    const svc = new SuggestionsService(fakeMcp, fakePrefs, new RankingService());
    const out = await svc.getTopSuggestions('dj');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].restaurant.restaurantId).toBe('r1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/suggestions/suggestions.service.spec.ts`
Expected: FAIL (signature mismatch — `getTopSuggestions` still wants lat/lng).

- [ ] **Step 3: Rewrite the service**

```ts
// src/suggestions/suggestions.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { RestaurantResult, SwiggyMcpClient } from '../mcp/mcp-client.interface';
import { PreferencesService, PreferenceProfile } from '../preferences/preferences.service';
import { RankingService, RankedSuggestion } from '../ranking/ranking.service';

function currentTimeSlot(date = new Date()): string {
  const h = date.getHours();
  if (h >= 6 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'evening_snack';
  if (h >= 18 && h < 23) return 'dinner';
  return 'late_night';
}

const MEAL_DEFAULT_QUERY: Record<string, string> = {
  breakfast: 'south indian',
  lunch: 'thali',
  evening_snack: 'rolls',
  dinner: 'biryani',
  late_night: 'pizza',
};

function searchQueries(profile: PreferenceProfile, slot: string): string[] {
  const top = Object.entries(profile.cuisineCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cuisine]) => cuisine.replace('_', ' '));
  return top.length ? top : [MEAL_DEFAULT_QUERY[slot] ?? 'popular'];
}

@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(SWIGGY_MCP_CLIENT) private mcpClient: SwiggyMcpClient,
    private preferences: PreferencesService,
    private ranking: RankingService,
  ) {}

  async getTopSuggestions(userId: string, addressId?: string): Promise<RankedSuggestion[]> {
    const profile = await this.preferences.getProfile(userId);
    const slot = currentTimeSlot();

    const resolvedAddressId = addressId ?? (await this.mcpClient.getAddresses())[0]?.addressId;
    if (!resolvedAddressId) return [];

    const byId = new Map<string, RestaurantResult>();
    for (const q of searchQueries(profile, slot)) {
      const results = await this.mcpClient.searchRestaurants({ addressId: resolvedAddressId, query: q });
      for (const r of results) byId.set(r.restaurantId, r);
    }

    return this.ranking.rank([...byId.values()], profile, slot, 5);
  }

  async acceptSuggestion(userId: string, restaurantId: string, _itemIds: string[]) {
    await this.preferences.recordFeedback(userId, restaurantId, 'accepted');
    // Ordering is completed in Phase 4 (buildCart → confirm → placeOrder).
    return { recorded: true };
  }

  async skipSuggestion(userId: string, restaurantId: string) {
    return this.preferences.recordFeedback(userId, restaurantId, 'skipped');
  }
}
```

- [ ] **Step 4: Update the controller** (`lat`/`lng` → optional `addressId`)

```ts
// src/suggestions/suggestions.controller.ts  (GET handler only)
@Get()
async getSuggestions(@Query('userId') userId: string, @Query('addressId') addressId?: string) {
  const results = await this.suggestionsService.getTopSuggestions(userId, addressId);
  return {
    count: results.length,
    suggestions: results.map((s) => ({
      restaurant: s.restaurant.name,
      cuisine: s.restaurant.cuisine,
      etaMinutes: s.restaurant.etaMinutes,
      avgPrice: s.restaurant.avgPrice,
      reason: s.reason,
      isExplorePick: s.isExplorePick,
      score: Number(s.score.toFixed(3)),
    })),
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/suggestions/suggestions.service.ts src/suggestions/suggestions.controller.ts src/suggestions/suggestions.service.spec.ts
git commit -m "feat(suggestions): resolve addressId and search by profile cuisine before ranking"
```

### Task 3.7: Live smoke test (manual — requires phone + OTP) — **the local-demo gate**

**Files:**
- Create: `src/mcp/real/debug.controller.ts` (dev-only raw-payload capture)

**Interfaces:**
- Consumes: the authenticated session from the running server (the SDK provider holds the token — there is no token to copy by hand).

> This is the verification gate for Tasks 3.3–3.6 against reality, and it is the milestone the demo video captures. It cannot be a Jest unit test because it needs a live OAuth session (phone + OTP in a browser). Because Option B keeps the token inside the running server's provider, we capture raw payloads through a **dev-only debug route** rather than a standalone script with a pasted token. Run once, capture the real `get_addresses` / `search_restaurants` payloads, and reconcile the adapter field picks (Task 3.3) and `unwrap()` (Task 3.4) if the shapes differ from the fixtures. **Delete or guard this route before any production submission.**

- [ ] **Step 1: Add a dev-only debug controller** that prints raw tool payloads via the live session

```ts
// src/mcp/real/debug.controller.ts
import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpSessionFactory } from './mcp-session.factory';

// DEV ONLY. Guarded by USE_MOCK_MCP=false; remove before production submission.
@Controller('debug/mcp')
export class McpDebugController {
  constructor(private sessions: McpSessionFactory, private config: ConfigService) {}

  private guard() {
    if (this.config.get('USE_MOCK_MCP') !== 'false') throw new ForbiddenException('real mode only');
  }

  @Get('tools')
  async tools() {
    this.guard();
    const client = await this.sessions.getClient();
    return (await client.listTools()).tools.map((t) => t.name);
  }

  @Get('raw')
  async raw(@Query('tool') tool: string, @Query('addressId') addressId?: string, @Query('query') query?: string) {
    this.guard();
    const client = await this.sessions.getClient();
    const args = tool === 'search_restaurants' ? { addressId, query: query ?? 'biryani' } : {};
    return client.callTool({ name: tool, arguments: args });
  }
}
```

Register it in `McpModule`'s `controllers` array alongside `OAuthController`.

- [ ] **Step 2: Authenticate via the browser flow**

Run: `USE_MOCK_MCP=false npm run start`, open `http://localhost:3000/oauth/login`, complete phone + OTP. Confirm `curl http://localhost:3000/oauth/status` → `{"authenticated":true}`.

- [ ] **Step 3: Capture the live tool list + raw payloads**

Run:
```
curl "http://localhost:3000/debug/mcp/tools"
curl "http://localhost:3000/debug/mcp/raw?tool=get_addresses"
curl "http://localhost:3000/debug/mcp/raw?tool=search_restaurants&addressId=<id-from-above>&query=biryani"
```
Expected: the 17 Food tool names, a real addresses payload, and a real restaurants payload.

- [ ] **Step 4: Reconcile fixtures** — if the captured JSON differs from the assumptions in `swiggy-response.adapter.ts` / `unwrap()`, update those two files and their spec fixtures, then re-run `npx jest`.

- [ ] **Step 5: End-to-end check via the real API** (the demo shot)

Run: `curl "http://localhost:3000/suggestions?userId=dj"` (real mode, authenticated)
Expected: 5 ranked suggestions built from **real** nearby restaurants, each with a "why".

- [ ] **Step 6: Commit**

```bash
git add src/mcp/real/debug.controller.ts src/mcp/mcp.module.ts
git commit -m "test(mcp): dev-only debug route to capture live Swiggy payloads"
```

---

## Phase 4 — Ordering (guarded, real money)

### Task 4.1: Confirm-gated order flow in `SuggestionsService`

**Files:**
- Modify: `src/suggestions/suggestions.service.ts`
- Modify: `src/suggestions/suggestions.controller.ts`
- Test: `src/suggestions/suggestions.order.spec.ts`

**Interfaces:**
- Consumes: `SwiggyMcpClient.buildCart`, `SwiggyMcpClient.placeOrder`, `ConfigService` (`ALLOW_REAL_ORDERS`).
- Produces:
  - `acceptSuggestion(userId, restaurantId, items: CartItemRef[], confirm: boolean)`:
    1. records `accepted` feedback,
    2. `buildCart` → `CartSummary`,
    3. enforce **₹1000 cap** (throw `BadRequestException` if `total > 1000`),
    4. if **not** (`confirm === true` AND `ALLOW_REAL_ORDERS === 'true'`): return `{ placed: false, cart, message: 'Confirm to place' }` — **do not place**,
    5. else call `placeOrder()` and return `{ placed: true, order, cart }`.

> Safety rationale (spec constraint): `place_food_order` spends real money and is non-idempotent. Default is dry-run. Real placement requires both the operator's env opt-in and an explicit per-request `confirm`. This satisfies Swiggy's "confirm the cart and total before placing" guidance and the project's purchase-confirmation rule.

- [ ] **Step 1: Write the failing test**

```ts
// src/suggestions/suggestions.order.spec.ts
import { SuggestionsService } from './suggestions.service';
import { RankingService } from '../ranking/ranking.service';

const prefs = { getProfile: async () => ({ cuisineCounts: {}, avgOrderValue: 0, timeSlotCounts: {}, recentRestaurantIds: [], rejectedRestaurantIds: [] }), recordFeedback: async () => undefined } as any;

function mcpWithTotal(total: number) {
  return {
    getAddresses: async () => [{ addressId: 'a', label: 'Home' }],
    searchRestaurants: async () => [],
    buildCart: async () => ({ restaurantId: 'r1', restaurantName: 'X', items: [], total }),
    placeOrder: async () => ({ orderId: 'o1', status: 'placed', etaMinutes: 30 }),
  } as any;
}

describe('order flow', () => {
  it('does not place when confirm is false', async () => {
    const config = { get: () => 'true' } as any; // ALLOW_REAL_ORDERS=true but confirm=false
    const svc = new SuggestionsService(mcpWithTotal(400), prefs, new RankingService(), config);
    const out = await svc.acceptSuggestion('dj', 'r1', [{ itemId: 'i1', quantity: 1 }], false);
    expect(out.placed).toBe(false);
  });

  it('rejects carts over the ₹1000 cap', async () => {
    const config = { get: () => 'true' } as any;
    const svc = new SuggestionsService(mcpWithTotal(1200), prefs, new RankingService(), config);
    await expect(svc.acceptSuggestion('dj', 'r1', [{ itemId: 'i1', quantity: 4 }], true)).rejects.toThrow(/1000/);
  });

  it('places when confirm=true and env allows', async () => {
    const config = { get: () => 'true' } as any;
    const svc = new SuggestionsService(mcpWithTotal(400), prefs, new RankingService(), config);
    const out = await svc.acceptSuggestion('dj', 'r1', [{ itemId: 'i1', quantity: 1 }], true);
    expect(out.placed).toBe(true);
    expect(out.order.orderId).toBe('o1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/suggestions/suggestions.order.spec.ts`
Expected: FAIL (`acceptSuggestion` old signature / missing `ConfigService` param).

- [ ] **Step 3: Update the service** (add `ConfigService` to the constructor, replace `acceptSuggestion`)

```ts
// add import + constructor param
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CartItemRef } from '../mcp/mcp-client.interface';
// constructor(..., private ranking: RankingService, private config: ConfigService) {}

async acceptSuggestion(userId: string, restaurantId: string, items: CartItemRef[], confirm: boolean) {
  await this.preferences.recordFeedback(userId, restaurantId, 'accepted');
  const cart = await this.mcpClient.buildCart({ restaurantId, items });
  if (cart.total > 1000) {
    throw new BadRequestException(`Cart ₹${cart.total} exceeds the ₹1000 cap`);
  }
  const allowed = this.config.get('ALLOW_REAL_ORDERS') === 'true';
  if (!(confirm && allowed)) {
    return { placed: false, cart, message: 'Review the cart, then resend with confirm:true to place.' };
  }
  const order = await this.mcpClient.placeOrder();
  return { placed: true, order, cart };
}
```

- [ ] **Step 4: Update the controller** accept handler

```ts
// src/suggestions/suggestions.controller.ts
@Post('accept')
async accept(@Body() body: { userId: string; restaurantId: string; items?: { itemId: string; quantity: number }[]; confirm?: boolean }) {
  return this.suggestionsService.acceptSuggestion(
    body.userId, body.restaurantId, body.items ?? [], body.confirm === true,
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/suggestions/suggestions.service.ts src/suggestions/suggestions.controller.ts src/suggestions/suggestions.order.spec.ts
git commit -m "feat(order): confirm-gated, ₹1000-capped cart+place flow"
```

### Task 4.2: Non-idempotency guard on real placement

**Files:**
- Modify: `src/mcp/real/real-swiggy-mcp.client.ts`

**Interfaces:**
- Produces: `placeOrder()` that, on a 5xx from `place_food_order`, checks `get_food_orders` before surfacing an error, so a network failure after a successful placement doesn't cause a double order.

- [ ] **Step 1: Add a `get_food_orders` fallback** to `placeOrder()`

```ts
async placeOrder(): Promise<PlaceOrderResult> {
  try {
    const order = await this.call('place_food_order', { paymentMethod: 'COD' });
    return { orderId: order?.orderId, status: order?.status ?? 'placed', etaMinutes: Number(order?.etaMinutes ?? 0) };
  } catch (e: any) {
    const status = e?.status ?? 0;
    if (status >= 500) {
      // place_food_order is NOT idempotent — verify before the caller retries.
      const orders = await this.call('get_food_orders', {});
      const latest = (orders?.orders ?? orders)?.[0];
      if (latest?.orderId) {
        return { orderId: latest.orderId, status: latest.status ?? 'placed', etaMinutes: Number(latest.etaMinutes ?? 0) };
      }
    }
    throw e;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/real/real-swiggy-mcp.client.ts
git commit -m "fix(order): verify via get_food_orders on 5xx (place is non-idempotent)"
```

### Task 4.3: Docs — update README limitations & flow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README** to reflect: OAuth login step (`/oauth/login`), `USE_MOCK_MCP` toggle, address-based search (not lat/lng), the confirm-gated ordering with `ALLOW_REAL_ORDERS`, and the resolved-vs-remaining limitations (real location filtering now handled by Swiggy; cuisine frequency still global/not time-conditioned; weights still hand-picked; refresh-token re-auth every 5 days).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: real MCP flow, oauth login, ordering safety, updated limitations"
```

---

## Self-Review

**1. Spec coverage**
- No client secret; DCR + discovery done by the SDK via `OAuthClientProvider` → Tasks 2.1, 2.2, 2.3, 2.4. ✅
- 5-day token, 401 → `UnauthorizedError` re-auth → Task 3.4 (`call` catch clears state), Task 2.4 (`getClient` throws when unauthenticated). ✅
- Redirect URI localhost, exact-match → Tasks 1.2, 2.3 (`clientMetadata.redirect_uris`), 2.4. ✅
- `get_addresses` → `search_restaurants(addressId, query)` → Tasks 3.1, 3.3, 3.4, 3.6. ✅
- `availabilityStatus === "OPEN"` → Task 3.3 adapter (`isOpen`); ranking already filters on `isOpen`. ✅
- Cart journey + `place_food_order` (not `place_order`) → Tasks 3.4, 4.1. ✅
- ₹1000 cap → Task 4.1. ✅
- Non-idempotent place → Task 4.2. ✅
- `USE_MOCK_MCP` finally wired → Task 3.5. ✅
- Ranking engine unchanged → confirmed: no task touches `ranking.service.ts`. ✅
- Purchase confirmation (safety) → Task 4.1 double gate. ✅
- Idiomatic MCP auth (showcase requirement) → Phase 2 implements the SDK's `OAuthClientProvider`; no hand-rolled PKCE/token exchange. ✅
- Local demo before ordering → Phases 1–3 stand alone as the demoable milestone (Task 3.7 is the gate); Phase 4 is explicitly "further steps." ✅

**2. Placeholder scan** — Each code step contains real code. Three spots depend on external reality and are handled as verification steps, not TODOs: (a) the exact `OAuthClientProvider` member set is pinned in Task 2.1 and the provider adjusted in Task 2.3; (b) the response adapters (`swiggy-response.adapter.ts`) and (c) the tool-result envelope (`unwrap()`) are written against documented fields with defensive fallbacks and reconciled against captured live JSON in Task 3.7.

**3. Type consistency** — `SwiggyMcpClient` methods (`getAddresses`, `searchRestaurants`, `buildCart`, `placeOrder`) are identical across the interface (3.1), mock (3.2), real client (3.4/4.2), and service consumer (3.6/4.1). OAuth wiring is consistent: `OAuthStateStore` (2.2) is consumed by `SwiggyOAuthProvider` (2.3), `McpSessionFactory` (2.4), `RealSwiggyMcpClient` (3.4), and exported from `McpModule` (3.5); `TokenStore` from the old design appears nowhere. `getTopSuggestions(userId, addressId?)` matches its test and controller call. `acceptSuggestion(userId, restaurantId, items, confirm)` matches across service, controller, and both order tests.

**Known residual risk (call out at execution):** the `@modelcontextprotocol/sdk` OAuth surface (`OAuthClientProvider` members, `transport.finishAuth`, `authProvider` option, subpath imports) and the tool-result envelope shift across SDK versions. Task 2.1 pins the auth surface against the installed version before the provider is written; Task 3.4 Step 2 and Task 3.7 Step 4 pin the transport imports and live response shapes. This is the single biggest source of execution friction and should be resolved empirically, not from this plan's assumptions.

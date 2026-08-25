# MCP Server Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing ranking engine as a local stdio MCP server so Claude and other agents can call it, with a browser-driven `authenticate` tool and disk-persisted Swiggy OAuth tokens.

**Architecture:** Approach A — a new headless stdio entrypoint (`src/mcp-server/`) boots the existing NestJS DI container with no HTTP listener, resolves the existing services, and registers MCP tools that call straight into them. The REST app is untouched. The app becomes both an MCP server (to agents, stdio) and, unchanged, an MCP client (to Swiggy).

**Tech Stack:** TypeScript, NestJS 10 (DI only, `createApplicationContext`), `@modelcontextprotocol/sdk` 1.30 (`McpServer` + `StdioServerTransport`), `zod` 4 (already installed transitively — declare it as a direct dep), Jest.

**Spec:** `docs/superpowers/specs/2026-08-25-mcp-server-reframe-design.md`

## Global Constraints

- **stdout is the JSON-RPC channel.** No `console.log`/stdout writes anywhere on the MCP server path; all diagnostics go to **stderr**. Nest logger disabled (`{ logger: false }`).
- **Ordering stays out of scope.** No `place_food_order`, no payment. (The method was already removed in PR #6.)
- **No `userId` on any tool.** The server supplies a fixed internal id `FIXED_ID = ConfigService.get('DEFAULT_USER_ID') ?? 'dj'` to the service layer.
- **Mock-vs-real swappability preserved.** Full tool surface works offline when `USE_MOCK_MCP=true`.
- **Provider resolution:** `McpSessionFactory` and `SuggestionsService` are not exported by their modules; resolve them with `appContext.get(Type, { strict: false })`. `SWIGGY_MCP_CLIENT` (string token) and `OAuthStateStore` are exported by `McpModule`.
- **Token store path:** `process.env.SWIGGY_TOKEN_STORE_PATH ?? join(os.homedir(), '.smart-order-agent', 'oauth.json')`; file mode `0600`, parent dir `0700`.
- Branch: `feat/mcp-server-reframe` (already based on post-PR#6 `main`).

---

### Task 1: Persistent `OAuthStateStore`

Persist `tokens` + `clientInfo` to disk so a fresh stdio process reuses a valid token. Transient fields (`codeVerifier`, `pendingAuthUrl`, `state`) stay in-memory. Persistence is transparent to `SwiggyOAuthProvider`, which assigns `store.tokens = …` / `store.clientInfo = …` — we convert those to persisting accessors.

**Files:**
- Modify: `src/mcp/oauth/oauth-state.store.ts`
- Test: `src/mcp/oauth/oauth-state.store.spec.ts` (exists — update + extend)

**Interfaces:**
- Consumes: `OAuthClientInformationFull`, `OAuthTokens` from `@modelcontextprotocol/sdk/shared/auth.js`.
- Produces: `class OAuthStateStore` with unchanged public surface — fields `tokens`, `clientInfo`, `codeVerifier`, `pendingAuthUrl`, `state`, methods `isAuthenticated()`, `clear()` — plus a new constructor `constructor(@Optional() persistPath?: string | null)`. Passing `null` disables persistence (in-memory only); omitting it (DI default) uses the default path.

- [ ] **Step 1: Update existing tests to opt out of disk persistence**

In `src/mcp/oauth/oauth-state.store.spec.ts`, change every `new OAuthStateStore()` to `new OAuthStateStore(null)` (pure in-memory — keeps these 4 tests hermetic). Leave the assertions unchanged.

- [ ] **Step 2: Add failing persistence tests**

Append to `src/mcp/oauth/oauth-state.store.spec.ts`:

```typescript
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('OAuthStateStore persistence', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soa-oauth-'));
    file = join(dir, 'oauth.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists tokens + clientInfo and reloads them in a new instance', () => {
    const a = new OAuthStateStore(file);
    a.clientInfo = { client_id: 'c1', redirect_uris: ['http://localhost/cb'] } as any;
    a.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    expect(existsSync(file)).toBe(true);

    const b = new OAuthStateStore(file);
    expect(b.isAuthenticated()).toBe(true);
    expect(b.tokens?.access_token).toBe('abc');
    expect(b.clientInfo?.client_id).toBe('c1');
  });

  it('clear() deletes the persisted file', () => {
    const a = new OAuthStateStore(file);
    a.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    a.clear();
    expect(existsSync(file)).toBe(false);
    expect(new OAuthStateStore(file).isAuthenticated()).toBe(false);
  });

  it('a corrupt file loads as unauthenticated (no throw)', () => {
    writeFileSync(file, '{ not json');
    const s = new OAuthStateStore(file);
    expect(s.isAuthenticated()).toBe(false);
  });

  it('does not write a file when persistence is disabled (null)', () => {
    const s = new OAuthStateStore(null);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    // no file arg => nothing to assert on disk; just verify in-memory works
    expect(s.isAuthenticated()).toBe(true);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx jest src/mcp/oauth/oauth-state.store.spec.ts -t persistence`
Expected: FAIL — constructor takes no arg / no persistence yet.

- [ ] **Step 4: Implement persistence in `oauth-state.store.ts`**

Replace the file contents with:

```typescript
import { Injectable, Optional } from '@nestjs/common';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

function defaultPath(): string {
  return process.env.SWIGGY_TOKEN_STORE_PATH ?? join(homedir(), '.smart-order-agent', 'oauth.json');
}

/** Persisted-to-disk subset. Transient fields never touch disk. */
interface PersistShape {
  clientInfo?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
}

@Injectable()
export class OAuthStateStore {
  private _clientInfo: OAuthClientInformationFull | undefined;
  private _tokens: OAuthTokens | undefined;

  // Transient — in-memory only, per login attempt.
  codeVerifier: string | undefined;
  pendingAuthUrl: URL | undefined;
  state: string | undefined;

  private readonly persistPath: string | null;

  constructor(@Optional() persistPath?: string | null) {
    // undefined => DI default (persist to home); explicit null => in-memory only.
    this.persistPath = persistPath === undefined ? defaultPath() : persistPath;
    this.load();
  }

  get clientInfo(): OAuthClientInformationFull | undefined {
    return this._clientInfo;
  }
  set clientInfo(v: OAuthClientInformationFull | undefined) {
    this._clientInfo = v;
    this.save();
  }

  get tokens(): OAuthTokens | undefined {
    return this._tokens;
  }
  set tokens(v: OAuthTokens | undefined) {
    this._tokens = v;
    this.save();
  }

  isAuthenticated(): boolean {
    return !!this._tokens?.access_token;
  }

  clear(): void {
    this._clientInfo = undefined;
    this._tokens = undefined;
    this.codeVerifier = undefined;
    this.pendingAuthUrl = undefined;
    this.state = undefined;
    if (this.persistPath && existsSync(this.persistPath)) {
      try {
        rmSync(this.persistPath, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8')) as PersistShape;
      this._clientInfo = data.clientInfo;
      this._tokens = data.tokens;
    } catch {
      // Corrupt/unreadable file: start unauthenticated, never throw.
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true, mode: 0o700 });
      const shape: PersistShape = { clientInfo: this._clientInfo, tokens: this._tokens };
      writeFileSync(this.persistPath, JSON.stringify(shape), { mode: 0o600 });
    } catch (e) {
      process.stderr.write(`[oauth-store] persist failed: ${(e as Error).message}\n`);
    }
  }
}
```

- [ ] **Step 5: Run the store tests to verify they pass**

Run: `npx jest src/mcp/oauth/oauth-state.store.spec.ts`
Expected: PASS (all — updated in-memory tests + new persistence tests).

- [ ] **Step 6: Run the full suite (no regressions in OAuth provider / session factory)**

Run: `npx jest src/mcp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/oauth/oauth-state.store.ts src/mcp/oauth/oauth-state.store.spec.ts
git commit -m "feat(oauth): persist tokens + clientInfo to disk"
```

---

### Task 2: Graceful MongoDB degradation

In real mode, order history comes from Swiggy; Mongo is used only for skip/accept feedback. Make its absence non-fatal: suggestions still work (no skip-penalty), and feedback writes report a soft failure instead of throwing.

**Files:**
- Modify: `src/preferences/preferences.service.ts`
- Modify: `src/app.module.ts` (non-fatal Mongoose connection)
- Test: `src/preferences/preferences.service.spec.ts` (create)

**Interfaces:**
- Consumes: existing `PreferencesService` (constructor injects `orderModel`, `feedbackModel`).
- Produces: `PreferencesService.recordFeedback(userId, restaurantId, action)` now resolves to `{ recorded: boolean; note?: string }` (was the raw mongoose doc). `getProfile(userId)` unchanged signature, but returns a safe empty-ish profile when the store throws.

- [ ] **Step 1: Write failing degradation tests**

Create `src/preferences/preferences.service.spec.ts`:

```typescript
import { PreferencesService } from './preferences.service';

function throwingModel() {
  return {
    create: jest.fn().mockRejectedValue(new Error('Mongo down')),
    find: jest.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ exec: () => Promise.reject(new Error('Mongo down')) }) }),
    }),
  } as any;
}

describe('PreferencesService (store offline)', () => {
  it('recordFeedback returns a soft failure instead of throwing', async () => {
    const svc = new PreferencesService(throwingModel(), throwingModel());
    const res = await svc.recordFeedback('dj', 'r1', 'skipped');
    expect(res.recorded).toBe(false);
    expect(res.note).toMatch(/offline/i);
  });

  it('getProfile degrades to an empty profile when reads fail', async () => {
    const svc = new PreferencesService(throwingModel(), throwingModel());
    const profile = await svc.getProfile('dj');
    expect(profile.rejectedRestaurantIds).toEqual([]);
    expect(profile.recentRestaurantIds).toEqual([]);
    expect(profile.avgOrderValue).toBe(0);
  });
});

describe('PreferencesService (store online)', () => {
  it('recordFeedback returns recorded:true on success', async () => {
    const ok = { create: jest.fn().mockResolvedValue({}), find: jest.fn() } as any;
    const svc = new PreferencesService(ok, ok);
    const res = await svc.recordFeedback('dj', 'r1', 'accepted');
    expect(res).toEqual({ recorded: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/preferences/preferences.service.spec.ts`
Expected: FAIL — `recordFeedback` currently throws / returns a doc, not `{ recorded }`.

- [ ] **Step 3: Implement graceful degradation**

In `src/preferences/preferences.service.ts`, replace `recordFeedback` and wrap `getProfile`'s DB access:

```typescript
  async recordFeedback(
    userId: string,
    restaurantId: string,
    action: 'accepted' | 'skipped',
  ): Promise<{ recorded: boolean; note?: string }> {
    try {
      await this.feedbackModel.create({ userId, restaurantId, action, suggestedAt: new Date() });
      return { recorded: true };
    } catch (e) {
      process.stderr.write(`[preferences] feedback not persisted: ${(e as Error).message}\n`);
      return { recorded: false, note: 'feedback not persisted (store offline)' };
    }
  }
```

Wrap the reads in `getProfile` so any failure yields the safe empty profile:

```typescript
  async getProfile(userId: string): Promise<PreferenceProfile> {
    const empty: PreferenceProfile = {
      cuisineCounts: {},
      avgOrderValue: 0,
      timeSlotCounts: {},
      recentRestaurantIds: [],
      rejectedRestaurantIds: [],
    };
    try {
      const orders = await this.orderModel.find({ userId }).sort({ orderedAt: -1 }).limit(200).exec();

      const cuisineCounts: Record<string, number> = {};
      const timeSlotCounts: Record<string, number> = {};
      let totalValue = 0;
      for (const o of orders) {
        cuisineCounts[o.cuisine] = (cuisineCounts[o.cuisine] || 0) + 1;
        timeSlotCounts[o.timeSlot] = (timeSlotCounts[o.timeSlot] || 0) + 1;
        totalValue += o.orderValue;
      }

      const recentFeedback = await this.feedbackModel
        .find({ userId, action: 'skipped' })
        .sort({ createdAt: -1 })
        .limit(20)
        .exec();

      return {
        cuisineCounts,
        avgOrderValue: orders.length ? Math.round(totalValue / orders.length) : 0,
        timeSlotCounts,
        recentRestaurantIds: orders.slice(0, 10).map((o) => o.restaurantId),
        rejectedRestaurantIds: recentFeedback.map((f) => f.restaurantId),
      };
    } catch (e) {
      process.stderr.write(`[preferences] profile read failed, degrading: ${(e as Error).message}\n`);
      return empty;
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/preferences/preferences.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Make the Mongoose connection non-fatal**

In `src/app.module.ts`, extend the Mongoose factory so a missing Mongo never blocks or crashes bootstrap:

```typescript
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI') ?? 'mongodb://localhost:27017/smart-order-agent',
        // stdio server must not hang or crash when Mongo is absent — fail fast,
        // don't buffer commands forever; PreferencesService degrades gracefully.
        serverSelectionTimeoutMS: 2000,
        bufferCommands: false,
        connectionFactory: (connection: any) => {
          connection.on('error', (err: Error) =>
            process.stderr.write(`[mongo] connection error (feedback disabled): ${err.message}\n`),
          );
          return connection;
        },
      }),
```

- [ ] **Step 6: Confirm the accept/skip callers tolerate the new return shape**

`SuggestionsService.acceptSuggestion` already returns `{ recorded: true }` literally and `skipSuggestion` returns the `recordFeedback` result. Verify the existing suggestions suite still passes:

Run: `npx jest src/suggestions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/preferences/preferences.service.ts src/preferences/preferences.service.spec.ts src/app.module.ts
git commit -m "feat(preferences): degrade gracefully when Mongo is unavailable"
```

---

### Task 3: `authenticate` login helper

Reusable helper that drives the one-time Swiggy browser login from the MCP session, reusing `McpSessionFactory.beginAuth()`/`completeAuth()`. Factored so the state-validation + token-exchange core is unit-testable without a real browser or socket.

**Files:**
- Create: `src/mcp-server/authenticate.ts`
- Test: `src/mcp-server/authenticate.spec.ts`

**Interfaces:**
- Consumes: `McpSessionFactory` (`beginAuth(): Promise<URL>`, `completeAuth(code: string): Promise<void>`), `OAuthStateStore` (`isAuthenticated()`, `state`), `ConfigService` (`USE_MOCK_MCP`, `SWIGGY_OAUTH_REDIRECT_URI`).
- Produces:
  - `interface AuthDeps { sessions: Pick<McpSessionFactory,'beginAuth'|'completeAuth'>; store: Pick<OAuthStateStore,'isAuthenticated'|'state'|'clear'> & { state?: string }; isMock: boolean; openBrowser?: (url: string) => void; timeoutMs?: number; }`
  - `interface AuthResult { authenticated: boolean; message: string; loginUrl?: string; }`
  - `verifyAndComplete(code: string, state: string | undefined, deps: AuthDeps): Promise<void>` — throws `Error('Invalid or missing state parameter')` on CSRF mismatch, else calls `completeAuth`.
  - `runAuthentication(deps: AuthDeps): Promise<AuthResult>` — full orchestration.

- [ ] **Step 1: Write failing tests for the testable core**

Create `src/mcp-server/authenticate.spec.ts`:

```typescript
import { verifyAndComplete, runAuthentication, AuthDeps } from './authenticate';

function baseDeps(over: Partial<AuthDeps> = {}): AuthDeps {
  return {
    sessions: { beginAuth: jest.fn(), completeAuth: jest.fn().mockResolvedValue(undefined) },
    store: { isAuthenticated: () => false, state: 'good-state', clear: jest.fn() },
    isMock: false,
    openBrowser: jest.fn(),
    ...over,
  };
}

describe('verifyAndComplete', () => {
  it('rejects a mismatched state (CSRF)', async () => {
    const deps = baseDeps();
    await expect(verifyAndComplete('code123', 'WRONG', deps)).rejects.toThrow(/state/i);
    expect(deps.sessions.completeAuth).not.toHaveBeenCalled();
  });

  it('completes the exchange when state matches', async () => {
    const deps = baseDeps();
    await verifyAndComplete('code123', 'good-state', deps);
    expect(deps.sessions.completeAuth).toHaveBeenCalledWith('code123');
  });
});

describe('runAuthentication short-circuits', () => {
  it('returns already-authenticated without opening a browser', async () => {
    const deps = baseDeps({ store: { isAuthenticated: () => true, state: undefined, clear: jest.fn() } });
    const res = await runAuthentication(deps);
    expect(res.authenticated).toBe(true);
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(deps.sessions.beginAuth).not.toHaveBeenCalled();
  });

  it('is a success no-op in mock mode', async () => {
    const deps = baseDeps({ isMock: true });
    const res = await runAuthentication(deps);
    expect(res.authenticated).toBe(true);
    expect(res.message).toMatch(/mock/i);
    expect(deps.sessions.beginAuth).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/mcp-server/authenticate.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `authenticate.ts`**

Create `src/mcp-server/authenticate.ts`:

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'child_process';
import { URL } from 'url';

export interface AuthDeps {
  sessions: { beginAuth: () => Promise<URL>; completeAuth: (code: string) => Promise<void> };
  store: { isAuthenticated: () => boolean; state?: string; clear: () => void };
  isMock: boolean;
  redirectUri?: string; // defaults to http://localhost:3000/oauth/callback
  openBrowser?: (url: string) => void;
  timeoutMs?: number; // default 180000
}

export interface AuthResult {
  authenticated: boolean;
  message: string;
  loginUrl?: string;
}

/** CSRF check + token exchange. Mirrors oauth.controller.callback. */
export async function verifyAndComplete(
  code: string,
  state: string | undefined,
  deps: AuthDeps,
): Promise<void> {
  if (!code) throw new Error('Missing authorization code');
  if (!state || state !== deps.store.state) {
    throw new Error('Invalid or missing state parameter');
  }
  deps.store.state = undefined;
  await deps.sessions.completeAuth(code);
}

function defaultOpenBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    /* user can click the printed URL instead */
  }
}

export async function runAuthentication(deps: AuthDeps): Promise<AuthResult> {
  if (deps.store.isAuthenticated()) {
    return { authenticated: true, message: 'Already authenticated with Swiggy.' };
  }
  if (deps.isMock) {
    return { authenticated: true, message: 'Mock mode — no Swiggy login required.' };
  }

  const redirect = new URL(deps.redirectUri ?? 'http://localhost:3000/oauth/callback');
  const open = deps.openBrowser ?? defaultOpenBrowser;
  const timeoutMs = deps.timeoutMs ?? 180000;

  const loginUrl = (await deps.sessions.beginAuth()).toString();

  return new Promise<AuthResult>((resolve) => {
    let settled = false;
    const finish = (r: AuthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(r);
    };

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${redirect.port || 80}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const code = reqUrl.searchParams.get('code') ?? '';
      const state = reqUrl.searchParams.get('state') ?? undefined;
      try {
        await verifyAndComplete(code, state, deps);
        res.end('Swiggy MCP connected. You can close this tab and return to your agent.');
        finish({ authenticated: true, message: 'Authenticated with Swiggy.', loginUrl });
      } catch (e) {
        res.statusCode = 400;
        res.end((e as Error).message);
        finish({ authenticated: false, message: (e as Error).message, loginUrl });
      }
    });

    const timer = setTimeout(
      () => finish({ authenticated: false, message: 'Login timed out — call `authenticate` again.', loginUrl }),
      timeoutMs,
    );

    server.listen(Number(redirect.port) || 3000, () => {
      process.stderr.write(`[authenticate] open this URL to sign in:\n${loginUrl}\n`);
      open(loginUrl);
    });
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/mcp-server/authenticate.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/authenticate.ts src/mcp-server/authenticate.spec.ts
git commit -m "feat(mcp-server): authenticate helper (temp callback listener + browser)"
```

---

### Task 4: Tool registration

Register the six MCP tools against an `McpServer`, each a thin wrapper over an existing service, with centralized auth-error and result mapping. Pure function so it can be tested against fakes without a transport.

**Files:**
- Create: `src/mcp-server/tools.ts`
- Test: `src/mcp-server/tools.spec.ts`

**Interfaces:**
- Consumes: `SuggestionsService` (`getTopSuggestions(userId, addressId?)`, `surpriseToCart(userId, addressId?)`, `acceptSuggestion(userId, restaurantId, itemIds)`, `skipSuggestion(userId, restaurantId)`), the `SWIGGY_MCP_CLIENT` (`getAddresses()`), `runAuthentication` (Task 3), `UnauthorizedException` (`@nestjs/common`), `UnauthorizedError` (`@modelcontextprotocol/sdk/client/auth.js`).
- Produces:
  - `interface ToolDeps { suggestions: SuggestionsServiceLike; mcpClient: { getAddresses: () => Promise<any[]> }; authenticate: () => Promise<{ authenticated: boolean; message: string }>; fixedUserId: string; }`
  - `registerTools(server: McpServer, deps: ToolDeps): void`
  - Exported helpers for testing: `okResult(data): CallToolResult`, `errorResult(message): CallToolResult`, `withAuthErrors<T>(fn): Promise<CallToolResult>`.

- [ ] **Step 1: Write failing tests for the tool handlers**

Create `src/mcp-server/tools.spec.ts`. Test the handler behaviors via the exported helpers + a thin capture of registered tools:

```typescript
import { UnauthorizedException } from '@nestjs/common';
import { buildHandlers, ToolDeps } from './tools';

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    fixedUserId: 'dj',
    authenticate: jest.fn().mockResolvedValue({ authenticated: true, message: 'ok' }),
    mcpClient: { getAddresses: jest.fn().mockResolvedValue([{ addressId: 'a1', label: 'Home' }]) },
    suggestions: {
      getTopSuggestions: jest.fn().mockResolvedValue({ reorder: [{ restaurantId: 'r1' }], discover: [] }),
      surpriseToCart: jest.fn().mockResolvedValue({ picked: { restaurantId: 'r1' }, cart: { toPay: 250 } }),
      acceptSuggestion: jest.fn().mockResolvedValue({ recorded: true }),
      skipSuggestion: jest.fn().mockResolvedValue({ recorded: false, note: 'feedback not persisted (store offline)' }),
    },
    ...over,
  } as ToolDeps;
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe('tool handlers', () => {
  it('get_suggestions returns { reorder, discover } and passes the fixed user id', async () => {
    const d = deps();
    const h = buildHandlers(d);
    const res = await h.get_suggestions({ addressId: 'a1' });
    expect(d.suggestions.getTopSuggestions).toHaveBeenCalledWith('dj', 'a1');
    expect(parse(res)).toEqual({ reorder: [{ restaurantId: 'r1' }], discover: [] });
  });

  it('surprise_cart returns { picked, cart }', async () => {
    const res = await buildHandlers(deps()).surprise_cart({});
    expect(parse(res)).toEqual({ picked: { restaurantId: 'r1' }, cart: { toPay: 250 } });
  });

  it('skip_suggestion surfaces the offline note', async () => {
    const res = await buildHandlers(deps()).skip_suggestion({ restaurantId: 'r1' });
    expect(parse(res).recorded).toBe(false);
    expect(parse(res).note).toMatch(/offline/i);
  });

  it('maps UnauthorizedException to a clean auth-error result', async () => {
    const d = deps({
      suggestions: {
        getTopSuggestions: jest.fn().mockRejectedValue(new UnauthorizedException('nope')),
      } as any,
    });
    const res = await buildHandlers(d).get_suggestions({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/authenticate/i);
  });

  it('list_addresses returns the address array', async () => {
    const res = await buildHandlers(deps()).list_addresses({});
    expect(parse(res)).toEqual([{ addressId: 'a1', label: 'Home' }]);
  });

  it('authenticate returns the auth result payload', async () => {
    const res = await buildHandlers(deps()).authenticate({});
    expect(parse(res)).toEqual({ authenticated: true, message: 'ok' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/mcp-server/tools.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `tools.ts`**

Create `src/mcp-server/tools.ts`:

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { UnauthorizedException } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

interface SuggestionsServiceLike {
  getTopSuggestions(userId: string, addressId?: string): Promise<unknown>;
  surpriseToCart(userId: string, addressId?: string): Promise<unknown>;
  acceptSuggestion(userId: string, restaurantId: string, itemIds: string[]): Promise<unknown>;
  skipSuggestion(userId: string, restaurantId: string): Promise<unknown>;
}

export interface ToolDeps {
  suggestions: SuggestionsServiceLike;
  mcpClient: { getAddresses: () => Promise<unknown[]> };
  authenticate: () => Promise<{ authenticated: boolean; message: string }>;
  fixedUserId: string;
}

export function okResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const AUTH_HINT = 'Not authenticated with Swiggy — call the `authenticate` tool first.';

export async function withAuthErrors(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return okResult(await fn());
  } catch (e) {
    if (e instanceof UnauthorizedException || e instanceof UnauthorizedError) {
      return errorResult(AUTH_HINT);
    }
    return errorResult((e as Error).message);
  }
}

type Handler = (args: any) => Promise<CallToolResult>;

/** Handlers isolated from the transport so they can be unit-tested directly. */
export function buildHandlers(deps: ToolDeps): Record<string, Handler> {
  const uid = deps.fixedUserId;
  return {
    authenticate: () => withAuthErrors(() => deps.authenticate()),
    get_suggestions: ({ addressId }) =>
      withAuthErrors(() => deps.suggestions.getTopSuggestions(uid, addressId)),
    surprise_cart: ({ addressId }) =>
      withAuthErrors(() => deps.suggestions.surpriseToCart(uid, addressId)),
    list_addresses: () => withAuthErrors(() => deps.mcpClient.getAddresses()),
    accept_suggestion: ({ restaurantId, itemIds }) =>
      withAuthErrors(() => deps.suggestions.acceptSuggestion(uid, restaurantId, itemIds)),
    skip_suggestion: ({ restaurantId }) =>
      withAuthErrors(() => deps.suggestions.skipSuggestion(uid, restaurantId)),
  };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const h = buildHandlers(deps);

  server.registerTool(
    'authenticate',
    {
      title: 'Authenticate with Swiggy',
      description: 'One-time browser login to Swiggy (phone + OTP). No-op if already signed in.',
      inputSchema: {},
    },
    h.authenticate,
  );

  server.registerTool(
    'get_suggestions',
    {
      title: 'Get food suggestions',
      description: 'Two ranked top-5 lists from your Swiggy order history: { reorder, discover }.',
      inputSchema: { addressId: z.string().optional().describe('Swiggy address id; defaults to your first saved address') },
    },
    h.get_suggestions,
  );

  server.registerTool(
    'surprise_cart',
    {
      title: 'Surprise me — fill my cart',
      description: 'Randomly picks one suggestion, adds a single item to your real Swiggy cart, and stops at the cart (no order placed).',
      inputSchema: { addressId: z.string().optional() },
    },
    h.surprise_cart,
  );

  server.registerTool(
    'list_addresses',
    {
      title: 'List saved Swiggy addresses',
      description: 'Your saved Swiggy delivery addresses.',
      inputSchema: {},
    },
    h.list_addresses,
  );

  server.registerTool(
    'accept_suggestion',
    {
      title: 'Record an accepted suggestion',
      description: 'Positive feedback that tunes future ranking.',
      inputSchema: { restaurantId: z.string(), itemIds: z.array(z.string()) },
    },
    h.accept_suggestion,
  );

  server.registerTool(
    'skip_suggestion',
    {
      title: 'Record a skipped suggestion',
      description: 'Negative feedback that tunes future ranking.',
      inputSchema: { restaurantId: z.string() },
    },
    h.skip_suggestion,
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/mcp-server/tools.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/tools.spec.ts
git commit -m "feat(mcp-server): register the six tools with auth-error mapping"
```

---

### Task 5: stdio entrypoint + packaging

Wire everything into a runnable stdio server, declare the `zod` dep, add the run script, env, and README section.

**Files:**
- Create: `src/mcp-server/main.ts`
- Modify: `package.json` (script + declare `zod`)
- Modify: `.env.example` (add `SWIGGY_TOKEN_STORE_PATH`)
- Modify: `README.md` (add "Use it as an MCP server" section)

**Interfaces:**
- Consumes: `AppModule`, `SuggestionsService`, `McpSessionFactory`, `OAuthStateStore`, `SWIGGY_MCP_CLIENT`, `ConfigService`, `registerTools` (Task 4), `runAuthentication` (Task 3).
- Produces: an executable stdio MCP server (`node dist/mcp-server/main.js`).

- [ ] **Step 1: Implement `main.ts`**

Create `src/mcp-server/main.ts`:

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from '../app.module';
import { SuggestionsService } from '../suggestions/suggestions.service';
import { McpSessionFactory } from '../mcp/real/mcp-session.factory';
import { OAuthStateStore } from '../mcp/oauth/oauth-state.store';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { registerTools } from './tools';
import { runAuthentication } from './authenticate';

async function bootstrap(): Promise<void> {
  // Headless: DI container only, no HTTP listener. Logger off — stdout is JSON-RPC.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const config = app.get(ConfigService);
  const suggestions = app.get(SuggestionsService, { strict: false });
  const sessions = app.get(McpSessionFactory, { strict: false });
  const store = app.get(OAuthStateStore, { strict: false });
  const mcpClient = app.get<any>(SWIGGY_MCP_CLIENT, { strict: false });

  const isMock = config.get('USE_MOCK_MCP') !== 'false';
  const fixedUserId = config.get<string>('DEFAULT_USER_ID') ?? 'dj';
  const redirectUri = config.get<string>('SWIGGY_OAUTH_REDIRECT_URI');

  const server = new McpServer({ name: 'smart-order-agent', version: '0.1.0' });

  registerTools(server, {
    suggestions,
    mcpClient,
    fixedUserId,
    authenticate: () => runAuthentication({ sessions, store, isMock, redirectUri }),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[smart-order-agent] MCP server ready (mock=${isMock}).\n`);
}

bootstrap().catch((e) => {
  process.stderr.write(`[smart-order-agent] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the run script and declare `zod` in `package.json`**

Add to `"scripts"`:

```json
    "mcp": "ts-node src/mcp-server/main.ts",
    "mcp:prod": "node dist/mcp-server/main.js",
```

Add to `"dependencies"` (already installed transitively; this declares the direct use):

```json
    "zod": "^4.4.3",
```

- [ ] **Step 3: Add the token-store path to `.env.example`**

Under the Swiggy MCP block in `.env.example`:

```bash
# Where the stdio MCP server persists the Swiggy OAuth token (optional).
# Default: ~/.smart-order-agent/oauth.json
# SWIGGY_TOKEN_STORE_PATH=
```

- [ ] **Step 4: Build to verify the entrypoint compiles**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Smoke-test in mock mode (no Swiggy, no Mongo needed)**

Run a one-shot `tools/list` over stdio and confirm the six tools appear on stdout as clean JSON-RPC (nothing else on stdout):

```bash
USE_MOCK_MCP=true printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx ts-node src/mcp-server/main.ts 2>/dev/null
```

Expected: JSON-RPC responses on stdout; the `tools/list` result lists `authenticate`, `get_suggestions`, `surprise_cart`, `list_addresses`, `accept_suggestion`, `skip_suggestion`. Diagnostics appear only on stderr (hidden by `2>/dev/null`).

- [ ] **Step 6: Add the README section**

Add to `README.md` after "Endpoints" (adjust the absolute path in the snippet):

````markdown
## Use it as an MCP server

The same engine runs as a local **stdio MCP server**, so Claude (or any MCP
client) can call it as tools: `authenticate`, `get_suggestions`,
`surprise_cart`, `list_addresses`, `accept_suggestion`, `skip_suggestion`.

```bash
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

- **Mock mode** (`USE_MOCK_MCP=true`, the default): the full tool surface works
  offline — no Swiggy account, no MongoDB.
- **Real mode** (`USE_MOCK_MCP=false`): call `authenticate` once (browser phone +
  OTP); the token is cached at `~/.smart-order-agent/oauth.json` and reused across
  restarts for ~5 days. `surprise_cart` **stops at the cart** — no order is placed.
- Feedback (`accept`/`skip`) uses MongoDB when available and degrades to a
  no-op notice when it isn't; suggestions work either way.
````

- [ ] **Step 7: Run the whole suite + typecheck**

Run: `npm test && npx tsc -p tsconfig.json --noEmit`
Expected: all tests PASS, typecheck exit 0.

- [ ] **Step 8: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 9: Commit**

```bash
git add src/mcp-server/main.ts package.json package-lock.json .env.example README.md graphify-out/
git commit -m "feat(mcp-server): stdio entrypoint, run script, docs"
```

---

## Self-Review

**1. Spec coverage:**
- Architecture / Approach A / headless context → Task 5. ✓
- stdout/stderr constraint → Global Constraints + Task 5 main.ts + smoke test. ✓
- Tool surface (6 tools, no userId, zod) → Task 4. ✓
- `authenticate` tool + temp listener + mock no-op + already-authed → Task 3. ✓
- Token persistence (persist tokens+clientInfo, transient verifier/state, 0600, delete on clear, corrupt→unauth) → Task 1. ✓
- Feedback identity (FIXED_ID) → Task 4 handlers + Global Constraints. ✓
- Graceful Mongo degradation (getProfile empty, feedback soft-fail, non-fatal connection) → Task 2. ✓
- Not-authenticated error mapping → Task 4 `withAuthErrors`. ✓
- Mock mode offline → Task 3 (auth no-op) + Task 5 smoke. ✓
- Testing (handlers, persistence, mock e2e-ish, regressions) → Tasks 1–4 tests; regression checks in Steps. ✓
- New deps/files/scripts/README/Claude Desktop snippet → Task 5. ✓
- Non-goals (ordering, remote/multi-user, learned weights) → Global Constraints / untouched. ✓

**2. Placeholder scan:** No TBD/TODO; every code step carries real code. ✓

**3. Type consistency:**
- `recordFeedback` new return `{ recorded; note? }` defined in Task 2, consumed by Task 4 `skip_suggestion` test/handler. ✓
- `getTopSuggestions(userId, addressId?)`, `surpriseToCart(userId, addressId?)`, `acceptSuggestion(userId, restaurantId, itemIds)`, `skipSuggestion(userId, restaurantId)` — signatures verified against source; used consistently in Task 4. ✓
- `OAuthStateStore(@Optional() persistPath?)` defined in Task 1; used by DI (default) in Task 5 and directly in tests. ✓
- `AuthDeps`/`AuthResult`/`runAuthentication`/`verifyAndComplete` defined in Task 3; consumed in Tasks 4–5. ✓
- `ToolDeps`/`buildHandlers`/`registerTools` defined in Task 4; consumed in Task 5. ✓
- `SWIGGY_MCP_CLIENT` string token + `{ strict: false }` resolution — matches `mcp.module.ts`. ✓

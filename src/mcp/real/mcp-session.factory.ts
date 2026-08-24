import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SwiggyOAuthProvider } from '../oauth/swiggy-oauth.provider';
import { OAuthStateStore } from '../oauth/oauth-state.store';

/**
 * Owns the SDK `Client` + `StreamableHTTPClientTransport` pair used to talk to the real
 * Swiggy MCP server, and drives the SDK's own OAuth orchestration (discovery, Dynamic
 * Client Registration, PKCE) through `SwiggyOAuthProvider`.
 *
 * IMPORTANT (SDK 1.30.0 behaviour, verified against dist/esm sources — this deviates from
 * the task-2.4 brief's starting code):
 *
 * `Client.connect()` (client/index.js) wraps the `initialize` request in try/catch; on
 * failure it calls `void this.close()` and rethrows. `Protocol.close()` awaits
 * `transport.close()`, which — for `StreamableHTTPClientTransport` — synchronously calls
 * `this._abortController?.abort()` and invokes the `onclose` callback that Protocol wired
 * up during `connect()`. That callback synchronously resets the *client's* internal
 * `_transport` field to `undefined` before the `throw` in `Client.connect()` completes.
 * So the same `Client` instance CAN be reconnected later (no "already connected" guard
 * trip) — but `transport.close()` never clears the transport's own `_abortController`,
 * and `transport.start()` throws "already started" whenever `_abortController` is still
 * set. That means the *same transport instance* used for the failed `beginAuth()` connect
 * cannot be reused for the follow-up `connect()` in `completeAuth()`/`getClient()`.
 *
 * The brief's pseudocode assumed one transport instance could be reused end-to-end; in
 * 1.30.0 it cannot once a connect() attempt has failed and torn it down. The fix here:
 * keep ONE client instance alive across the flow (safe to reconnect), but mint a FRESH
 * transport (same URL, same authProvider) for every `connect()` call. `finishAuth()` is
 * still invoked on the exact transport that started the flow, per the SDK contract, since
 * it does not call `start()` and is unaffected by the abort.
 *
 * The brief also suggested checking `(client as any)._connected` in `getClient()` to avoid
 * a double-connect; no such field exists anywhere in the installed SDK. We track our own
 * `connected` boolean instead.
 *
 * FIX ROUND 1 addendum: reusing `this.client` across logins is only safe when the
 * previous `connect()` attempt actually failed (see above — that path resets
 * `client._transport` to `undefined`). If a *previous* login already completed
 * successfully (`client._transport` still set, pointing at a live transport), calling
 * `client.connect()` again hits `Protocol.connect()`'s very first guard:
 * `if (this._transport) throw new Error('Already connected to a transport. Call close()
 * before connecting to a new transport...')` — a PLAIN `Error`, not `UnauthorizedError`,
 * thrown before `Client.connect()`'s own try/catch even runs (that guard lives in
 * `Protocol.connect()`, which `Client.connect()` calls via `await super.connect(transport)`
 * as its very first line — so `Client.connect()`'s catch block, which only wraps the
 * `initialize` request, never sees it). `beginAuth()`'s catch only swallows
 * `UnauthorizedError`, so this would propagate as an unhandled 500 on a second
 * `/oauth/login` — which v1.0 requires periodically, since Swiggy issues no refresh
 * tokens and access tokens expire after 5 days. Fix: `beginAuth()` now unconditionally
 * discards any previous client/transport (`discardSession()`) before minting a fresh
 * `Client`, so every login starts from a guaranteed-clean slate regardless of whether the
 * prior session succeeded, failed, or was never started. `completeAuth()`/`getClient()`
 * also discard the session on an unexpected `connect()` failure so a half-open client is
 * never left behind for the next call to trip over.
 */
@Injectable()
export class McpSessionFactory {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected = false;

  constructor(
    private config: ConfigService,
    private provider: SwiggyOAuthProvider,
    private store: OAuthStateStore,
  ) {}

  private serverUrl(): URL {
    const base = this.config.get<string>('SWIGGY_MCP_BASE_URL') ?? 'https://mcp.swiggy.com';
    return new URL(`${base}/food`);
  }

  private ensureClient(): Client {
    if (!this.client) {
      this.client = new Client({ name: 'smart-order-agent', version: '0.1.0' });
      // If the transport drops mid-session (network blip / server-side session expiry),
      // the SDK resets client._transport to undefined on its own, but nothing told the
      // factory — without this, `connected` would stay stuck `true` and getClient() would
      // hand back a client with no live transport. This makes the next getClient() call
      // transparently reconnect instead. Harmless during intentional teardown
      // (discardSession()/reset() already null everything out regardless).
      this.client.onclose = () => {
        this.connected = false;
      };
    }
    return this.client;
  }

  /** Always mints a fresh transport: a `StreamableHTTPClientTransport` whose connect
   * attempt has failed cannot be `start()`-ed again (see class doc). */
  private newTransport(): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(this.serverUrl(), {
      authProvider: this.provider,
    });
  }

  /**
   * Tears down any existing client/transport so the next `connect()` starts from a
   * guaranteed-clean slate — see the FIX ROUND 1 addendum above for why this is required
   * before every `beginAuth()`, and on any unexpected `connect()` failure elsewhere.
   */
  private async discardSession(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Best-effort — the client/transport are being discarded regardless.
      }
    }
    this.client = null;
    this.transport = null;
    this.connected = false;
  }

  async beginAuth(): Promise<URL> {
    // A prior successful login (or a half-open client left by some other failure) must
    // not leak into this attempt — Protocol.connect() throws a plain Error("Already
    // connected...") if `client._transport` is still set, which beginAuth's catch below
    // (scoped to UnauthorizedError) would not swallow.
    await this.discardSession();
    const client = this.ensureClient();
    this.transport = this.newTransport();
    try {
      await client.connect(this.transport); // triggers discovery + DCR + PKCE, then throws
      // No tokens yet means this should not happen, but if the SDK somehow authorized
      // immediately (e.g. cached tokens), treat the connect as successful.
      this.connected = true;
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e;
    }
    if (!this.store.pendingAuthUrl) throw new Error('No authorization URL produced by the SDK');
    return this.store.pendingAuthUrl;
  }

  async completeAuth(code: string): Promise<void> {
    if (!this.transport) {
      throw new Error('No pending authorization flow — call beginAuth() first');
    }
    // Exchange the code using the verifier + client info the provider stashed during
    // beginAuth(). Safe on the (possibly already-aborted) transport: finishAuth() never
    // calls start(), it only drives the SDK's auth() token exchange.
    await this.transport.finishAuth(code);

    // The transport that ran beginAuth() is spent (see class doc) — start a fresh one on
    // the same client, now that the provider/store hold valid tokens.
    const client = this.ensureClient();
    this.transport = this.newTransport();
    try {
      await client.connect(this.transport);
      this.connected = true;
    } catch (e) {
      // Don't leave a half-open client for the next call (e.g. a retried /oauth/login) to
      // trip over — discard so the next attempt starts clean.
      await this.discardSession();
      throw e;
    }
  }

  async getClient(): Promise<Client> {
    if (!this.store.isAuthenticated()) {
      throw new UnauthorizedException('Not authenticated — visit /oauth/login');
    }
    const client = this.ensureClient();
    if (!this.connected) {
      this.transport = this.newTransport();
      try {
        await client.connect(this.transport);
        this.connected = true;
      } catch (e) {
        await this.discardSession();
        throw e;
      }
    }
    return client;
  }

  reset(): void {
    this.client = null;
    this.transport = null;
    this.connected = false;
  }
}

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

  async beginAuth(): Promise<URL> {
    const client = this.ensureClient();
    this.transport = this.newTransport();
    this.connected = false;
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
    await client.connect(this.transport);
    this.connected = true;
  }

  async getClient(): Promise<Client> {
    if (!this.store.isAuthenticated()) {
      throw new UnauthorizedException('Not authenticated — visit /oauth/login');
    }
    const client = this.ensureClient();
    if (!this.connected) {
      this.transport = this.newTransport();
      await client.connect(this.transport);
      this.connected = true;
    }
    return client;
  }

  reset(): void {
    this.client = null;
    this.transport = null;
    this.connected = false;
  }
}

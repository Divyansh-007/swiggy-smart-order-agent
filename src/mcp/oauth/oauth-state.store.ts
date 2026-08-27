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

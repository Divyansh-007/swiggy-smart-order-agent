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
    const child = spawn(cmd, [url], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', () => {
      /* user can click the printed URL instead */
    });
    child.unref();
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
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${Number(redirect.port) || 3000}`);
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

    server.on('error', (e) => {
      finish({
        authenticated: false,
        message: `Could not start login listener: ${(e as Error).message}`,
        loginUrl,
      });
    });

    server.listen(Number(redirect.port) || 3000, '127.0.0.1', () => {
      process.stderr.write(`[authenticate] open this URL to sign in:\n${loginUrl}\n`);
      open(loginUrl);
    });
  });
}

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

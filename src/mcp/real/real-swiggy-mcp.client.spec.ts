import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { RealSwiggyMcpClient } from './real-swiggy-mcp.client';

function makeSessions(callTool: (...args: any[]) => Promise<any>) {
  return {
    getClient: jest.fn().mockResolvedValue({ callTool }),
    reset: jest.fn(),
    beginAuth: jest.fn(),
    completeAuth: jest.fn(),
  } as any;
}

function makeStore() {
  return {
    clear: jest.fn(),
    isAuthenticated: jest.fn().mockReturnValue(true),
  } as any;
}

describe('RealSwiggyMcpClient', () => {
  it('clears the OAuth session and resets on a real UnauthorizedError', async () => {
    const callTool = jest.fn().mockRejectedValue(new UnauthorizedError('x'));
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toThrow(/re-authenticate/i);
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(sessions.reset).toHaveBeenCalledTimes(1);
  });

  it('does NOT clear the session on a -32001 timeout', async () => {
    const callTool = jest.fn().mockRejectedValue({ code: -32001, message: 'Request timed out' });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toBeTruthy();
    expect(store.clear).not.toHaveBeenCalled();
    expect(sessions.reset).not.toHaveBeenCalled();
  });

  it('throws on an MCP-standard isError result', async () => {
    const callTool = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toThrow(/boom/);
  });

  it('maps a successful envelope through getAddresses', async () => {
    const callTool = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: [{ addressId: 'a', label: 'Home' }] }),
        },
      ],
    });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    const addresses = await client.getAddresses();
    expect(addresses).toEqual([{ addressId: 'a', label: 'Home', displayText: undefined }]);
  });
});

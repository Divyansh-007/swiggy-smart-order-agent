# Demo — Smart Order Agent

A ~90-second walkthrough of the agent running as an MCP server: two ranked
shortlists from your real Swiggy order history, and a "surprise me" that fills a
real cart and stops before payment.

> **Watch it:** _[link your recording here]_

## What the demo shows

- **It's an MCP server.** Any MCP client (Claude Desktop, the MCP Inspector, your
  own) calls its tools — `get_suggestions`, `surprise_cart`, and four more.
- **Real reasoning, not an LLM loop.** `get_suggestions` returns `reorder` (your
  usuals) and `discover` (new places), each ranked deterministically over your
  order history — frequency, recency, price-fit, time-of-day — with a one-line "why".
- **Concludes at the cart.** `surprise_cart` adds one item to your **real** Swiggy
  cart and stops. `place_food_order` is never wired in — no order, no payment.
- **Mock or real, one interface.** It runs fully offline against a mock, or against
  live Swiggy over OAuth 2.1 + PKCE — flip `USE_MOCK_MCP`.

## Try it yourself

### Setup

```bash
npm install
npm run build
```

Point an MCP client at `dist/mcp-server/main.js`. For **Claude Desktop**, add to
`claude_desktop_config.json`:

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

(Set `USE_MOCK_MCP` to `true` for the offline mock — no Swiggy account, no MongoDB.)

### Act 1 — offline mock (no account needed)

With `USE_MOCK_MCP=true`, ask your MCP client to call `get_suggestions`. It returns
two ranked lists against synthetic history, each entry with a reason — proving the
whole pipeline with zero setup:

```jsonc
{
  "reorder": [
    { "restaurantId": "r1", "name": "Bawarchi Biryani House",
      "items": [{ "menuItemId": "m1", "name": "Chicken Biryani", "quantity": 2 }],
      "score": 0.78, "reason": "Ordered 3× — your go-to" }
    // ...
  ],
  "discover": [
    { "restaurant": { "name": "Sushi Yama", "cuisine": "japanese" },
      "reason": "New pick — similar to what you usually order, worth trying" }
    // ...
  ]
}
```

### Act 2 — live Swiggy

Set `USE_MOCK_MCP=false`, then drive the tools in order:

1. **`authenticate`** — opens a browser for the one-time phone + OTP login. The
   token is cached at `~/.smart-order-agent/oauth.json` (~5 days), so later runs
   skip it.
2. **`get_suggestions`** — `reorder` + `discover` built from *your* real order
   history (`get_food_orders`).
3. **`surprise_cart`** — picks one suggestion, adds a single item to your **real
   Swiggy cart**, and returns it with a live `toPay`:

```jsonc
{
  "picked": { "list": "reorder", "restaurantName": "Biryani To Go",
              "item": { "name": "Gazali Chaap Biryani" } },
  "cart": { "restaurantName": "Biryani To Go", "itemTotal": 499, "toPay": 884 }
}
```

Nothing is ordered and nothing is paid — you tap pay in the Swiggy app if you want it.

## Recording tips

- Claude Desktop makes the best take: you ask in plain language ("I'm hungry — what
  should I order?" / "surprise me") and Claude calls the tools live.
- `authenticate` once just before recording so the token is cached and the two tool
  calls are instant on camera.
- Keep an offline **mock-mode** take as a backup — it always works, no network, no login.
- Make sure the cart's `toPay` is visible in frame; it's the proof it hit real Swiggy.

See the main [README](../README.md) for the full tool table and architecture.

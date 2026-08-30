# Architecture & Deployment Overview

**Project:** Smart Order Agent — an MCP server over the Swiggy Food MCP
**Deployment scope:** single-user (the operator's own Swiggy account)
**Prepared for:** Swiggy Builders production-access review

> Placeholders in `<angle brackets>` are filled in at submission time.

## 1. What it is

Smart Order Agent is **both sides of MCP at once**:

- an **MCP server** (over stdio) that exposes six tools any agent can call —
  `authenticate`, `get_suggestions`, `surprise_cart`, `list_addresses`,
  `accept_suggestion`, `skip_suggestion`; and
- an **MCP client** to the **Swiggy Food MCP** (streamable-HTTP), authenticated
  with OAuth 2.1 + PKCE.

The core is a deterministic recommender over the operator's real order history —
frequency, recency, price-fit, time-of-day — not an LLM tool-dispatch loop. The
same engine is also reachable over a small REST API.

```
Agent (Claude / MCP client)
      │  MCP (stdio)
      ▼
Smart Order Agent  ──► Swiggy Food MCP  (streamable-HTTP, OAuth 2.1 + PKCE + DCR)
   ├─ ranking / preferences services (stateless per request)
   ├─ OAuth token store (encrypted at rest)
   └─ MongoDB: accept/skip feedback only
```

## 2. Authentication (OAuth 2.1 + PKCE)

- Uses the MCP SDK's native `OAuthClientProvider`, so **Dynamic Client
  Registration, `.well-known` discovery, and PKCE** are handled by the SDK —
  there is **no static client id/secret** to store.
- The operator signs in once interactively (phone + OTP in the browser); the
  access token is cached server-side (encrypted). Swiggy v1 issues no refresh
  token, so the token is re-obtained via the same interactive login when it
  expires (~5 days).
- Redirect URI is HTTPS, exact-match: `<https://prod-domain/oauth/callback>`.

## 3. Production deployment shape (single-user)

- **Compute:** one small container / VM on `<provider>` in `<region>`.
- **Networking:** fixed **egress IP** (static or NAT gateway) `<static/gateway IP>`
  for allow-listing; inbound limited to the OAuth callback over HTTPS.
- **Domain / TLS:** `<prod-domain>` with a managed certificate; the OAuth redirect
  URI is registered exact-match.
- **State:**
  - OAuth token → encrypted token store (`SWIGGY_TOKEN_STORE_PATH`), file perms
    restricted to the service account; encryption key from `<KMS / secret manager>`.
  - MongoDB (feedback only) on the private network; not publicly reachable.
- **Config:** `USE_MOCK_MCP=false`, `SWIGGY_MCP_BASE_URL=https://mcp.swiggy.com`,
  `SWIGGY_OAUTH_REDIRECT_URI=<https://prod-domain/oauth/callback>`.

## 4. Safety & reliability posture

- **Conclude at cart:** `surprise_cart` builds the cart and returns; the codebase
  has **no `place_food_order` path** and no payment handling.
- **Graceful degradation:** if MongoDB is unavailable, suggestions and cart still
  work; feedback writes report a soft failure instead of crashing.
- **Respects Swiggy:** only user-initiated tool calls, honoring Swiggy's responses;
  no scraping, no rate-limit bypass, no retries that could hammer the API.
- **Least privilege:** the dev-only read-only debug endpoint is removed for prod;
  only the six product tools are exposed.

## 5. What changes from local → production

| Concern | Local (today) | Production (this plan) |
|---|---|---|
| OAuth redirect URI | `http://localhost:3000/oauth/callback` | `<https://prod-domain/oauth/callback>` |
| Token store | local file `~/.smart-order-agent/oauth.json` (0600) | encrypted store, key in `<KMS/secret manager>` |
| MongoDB | local/optional | managed, private-network only |
| Debug endpoint | present (dev-only guard) | removed |
| Egress IP | dynamic | `<static/gateway IP>` (allow-listed) |
| TLS | n/a | managed cert on `<prod-domain>` |

## 6. Data handling

See [data-privacy-declaration.md](data-privacy-declaration.md). In short: live
Swiggy data is used in memory and not persisted; the only stored data is coarse
accept/skip feedback (no PII) and the encrypted OAuth token.

## 7. Open items to finalize before submitting

- Choose `<provider / region>` and obtain a `<static / gateway IP>`.
- Register `<prod-domain>` + TLS and set the exact-match redirect URI.
- Select the token-encryption mechanism `<KMS / secret manager>`.
- Provide a `<security-contact email>`.

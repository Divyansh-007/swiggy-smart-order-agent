# Data Handling & Privacy Declaration

**Project:** Smart Order Agent — an MCP server over the Swiggy Food MCP
**Deployment scope:** single-user (the operator's own Swiggy account)
**Prepared for:** Swiggy Builders production-access review

> Placeholders in `<angle brackets>` are filled in at submission time.

## 1. Summary

Smart Order Agent reads the operator's **own** Swiggy order history through the
Swiggy Food MCP and produces two ranked shortlists (reorder / discover). A
"surprise" action fills the operator's real Swiggy cart with one item and
**stops at the cart** — no order is ever placed and no payment is processed.

The deployment described here serves a **single user** (the operator). There is
no sign-up, no other end users, and no collection of third-party personal data.

## 2. Data the app processes

| Data | Source | Where it lives | Persisted? |
|---|---|---|---|
| Order history (restaurant, items, totals, timestamps) | Swiggy `get_food_orders` (live) | In memory, per request | **No** — used to rank, then discarded |
| Saved addresses | Swiggy `get_addresses` (live) | In memory, per request | **No** |
| Restaurant search / menu / cart | Swiggy tools (live) | In memory, per request | **No** |
| Accept/skip **feedback** | The operator's own actions | MongoDB `feedbacks` collection | **Yes** |
| OAuth access token + client registration | Swiggy OAuth 2.1 + PKCE (SDK) | Encrypted token store (see §4) | **Yes** |

### Exactly what the feedback record contains

The only order-derived data written to the database is coarse feedback, with **no
personal identifiers**:

```
feedbacks: { userId, restaurantId, action ('accepted'|'skipped'), suggestedAt, createdAt, updatedAt }
```

`userId` is an internal partition key (a fixed string for the single operator),
**not** a Swiggy identifier. There is a legacy `orders` collection used only by a
local demo seed and the offline mock; in production (real Swiggy mode) order
history is fetched live and **never written to it**.

## 3. Data the app does NOT collect, store, or transmit

- **No payment data** — cards, UPI, wallet, or any payment instrument. The app
  never calls `place_food_order` and has no payment code path.
- **No precise location or phone numbers** — the response adapters
  (`src/mcp/real/*.adapter.ts`) deliberately drop coordinates and phone fields;
  addresses are used only as opaque IDs / display strings, never geocoded or stored.
- **No selling, sharing, scraping, or profiling** of any data. Data is used solely
  to serve the operator their own suggestions.
- **No third-party analytics, ad, or tracking SDKs.**

## 4. Storage, security, and secrets

- **OAuth token at rest:** stored server-side, **encrypted at rest**
  `<encryption: e.g. libsodium/KMS-managed key>`, file/secret permissions
  restricted to the service account. Tokens are short-lived (Swiggy v1 issues no
  refresh token; access expires ~5 days) and are re-obtained via the operator's
  interactive login. On sign-out the token is deleted.
- **Database:** MongoDB reachable only on the private network / loopback of the
  host; not exposed publicly; credentials held as `<secret manager>`.
- **Transport:** all Swiggy MCP traffic is HTTPS; the OAuth redirect URI is
  HTTPS and exact-match `<https://prod-domain/oauth/callback>`.
- **Secrets:** no static Swiggy client id/secret exists (Dynamic Client
  Registration handles client identity); app secrets are injected via environment
  / `<secret manager>`, never committed.
- **Debug surface removed for production:** the dev-only read-only debug endpoint
  (`src/mcp/real/debug.controller.ts`) is disabled/removed in the production build.

## 5. Retention & deletion

- **Live data** (order history, addresses, menus, cart): not retained — it exists
  only for the duration of a request.
- **Feedback:** retained to improve ranking; retention limit `<e.g. 180 days>`,
  after which records are purged. The operator can wipe all feedback at any time
  by dropping the `feedbacks` collection.
- **OAuth token:** deleted on sign-out and overwritten on each new login.
- **Account/data deletion request:** as a single-user system, deletion is
  performed by the operator directly on their own host.

## 6. Compliance posture (against Swiggy's usage rules)

- Conclude-at-cart: no order manipulation, no automated ordering, no payment bypass.
- No scraping, no reselling of access, no rate-limit bypass — the app makes normal,
  user-initiated tool calls and honors Swiggy's responses.
- No reverse engineering; the integration uses the published MCP tool schemas.

## 7. Contacts

- **Operator / data controller:** `<legal name>`
- **Security contact:** `<security-contact email>`
- **Hosting / infrastructure:** `<provider>`, region `<region>`, egress IP(s)
  `<static / gateway IP>`

_This declaration reflects the application as built; see
[architecture-overview.md](architecture-overview.md) for the deployment shape._

# Graph Report - smart-order-agent  (2026-08-28)

## Corpus Check
- 64 files · ~46,164 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 494 nodes · 769 edges · 28 communities (23 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b5b91c6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- suggestions.service.ts
- real-swiggy-mcp.client.ts
- scripts
- OAuthStateStore
- preferences.service.ts
- What You Must Do When Invoked
- Phase 3 — Real MCP client + interface refactor (read path)
- dependencies
- compilerOptions
- History-Driven Suggestions (Reorder + Discovery) Implementation Plan
- Smart Order Agent
- Surprise-To-Cart (Conclude at Cart) Implementation Plan
- graphify reference: extra exports and benchmark
- MCP Server Reframe — Design Spec
- graphify reference: query, path, explain
- mcp-server/main.ts
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- CLAUDE.md
- .claude/CLAUDE.md
- extraction-spec.md
- Global Constraints
- account-profile.service.spec.ts

## God Nodes (most connected - your core abstractions)
1. `OAuthStateStore` - 21 edges
2. `McpSessionFactory` - 19 edges
3. `SwiggyOAuthProvider` - 18 edges
4. `SwiggyMcpClient` - 14 edges
5. `compilerOptions` - 14 edges
6. `RealSwiggyMcpClient` - 13 edges
7. `SuggestionsService` - 13 edges
8. `RestaurantResult` - 12 edges
9. `PreferencesService` - 12 edges
10. `What You Must Do When Invoked` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Scored` --references--> `RestaurantMeta`  [EXTRACTED]
  src/ranking/reorder-ranking.service.ts → src/suggestions/account-profile.service.ts
- `bootstrap()` --calls--> `runAuthentication()`  [EXTRACTED]
  src/mcp-server/main.ts → src/mcp-server/authenticate.ts
- `bootstrap()` --calls--> `registerTools()`  [EXTRACTED]
  src/mcp-server/main.ts → src/mcp-server/tools.ts
- `RankedSuggestion` --references--> `RestaurantResult`  [EXTRACTED]
  src/ranking/ranking.service.ts → src/mcp/mcp-client.interface.ts
- `ReorderSuggestion` --references--> `ReorderItem`  [EXTRACTED]
  src/ranking/reorder-ranking.service.ts → src/mcp/mcp-client.interface.ts

## Import Cycles
- None detected.

## Communities (28 total, 5 thin omitted)

### Community 0 - "suggestions.service.ts"
Cohesion: 0.06
Nodes (39): Body, Post, ReorderItem, RestaurantResult, PreferenceProfile, RankingModule, Module, RankedSuggestion (+31 more)

### Community 1 - "real-swiggy-mcp.client.ts"
Cohesion: 0.07
Nodes (28): AccountOrder, BuildCartParams, CartItemInput, CartSummary, MenuItem, SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient (+20 more)

### Community 2 - "scripts"
Cohesion: 0.06
Nodes (35): jest, description, devDependencies, jest, ts-jest, ts-node, ts-node-dev, @types/jest (+27 more)

### Community 3 - "OAuthStateStore"
Cohesion: 0.06
Nodes (22): Optional, Res, McpModule, Module, OAuthController, Controller, Get, Query (+14 more)

### Community 4 - "preferences.service.ts"
Cohesion: 0.11
Nodes (20): InjectModel, PreferencesModule, Module, PreferencesService, Injectable, Feedback, FeedbackDocument, FeedbackSchema (+12 more)

### Community 5 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 6 - "Phase 3 — Real MCP client + interface refactor (read path)"
Cohesion: 0.08
Nodes (24): File Structure, Global Constraints, Phase 1 — Prerequisites & test harness, Phase 2 — OAuth via the SDK's `OAuthClientProvider` (idiomatic MCP), Phase 3 — Real MCP client + interface refactor (read path), Phase 4 — Ordering (guarded, real money), Real Swiggy MCP Integration Implementation Plan, Self-Review (+16 more)

### Community 7 - "dependencies"
Cohesion: 0.10
Nodes (21): @modelcontextprotocol/sdk, mongoose, @nestjs/common, @nestjs/config, @nestjs/core, @nestjs/mongoose, @nestjs/platform-express, dependencies (+13 more)

### Community 8 - "compilerOptions"
Cohesion: 0.11
Nodes (17): ES2021, src/**/*.ts, compilerOptions, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+9 more)

### Community 10 - "History-Driven Suggestions (Reorder + Discovery) Implementation Plan"
Cohesion: 0.15
Nodes (12): File Structure, Global Constraints, History-Driven Suggestions (Reorder + Discovery) Implementation Plan, Self-Review, Task 1: Capture live payloads + widen the read-only debug allow-list, Task 2: Interface + domain types + mock history, Task 3: Order-history adapters (reconciled to live shapes), Task 4: Real client methods (+4 more)

### Community 11 - "Smart Order Agent"
Cohesion: 0.20
Nodes (9): Also available: a REST API, Architecture note, Conclude at cart (shipped), Configuration (`.env`), How it works, Known simplifications (good next steps), Quickstart — connect it as an MCP server, Smart Order Agent (+1 more)

### Community 12 - "Surprise-To-Cart (Conclude at Cart) Implementation Plan"
Cohesion: 0.20
Nodes (9): File Structure, Global Constraints, Self-Review, Surprise-To-Cart (Conclude at Cart) Implementation Plan, Task 1: Cart contract reconciliation (interface + client + mock + adapter), Task 2: Restaurant menu tool (for discover picks), Task 3: `surpriseToCart` service + endpoint, Task 4: Live verification + reconciliation (real mutation — user consented) (+1 more)

### Community 13 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 14 - "MCP Server Reframe — Design Spec"
Cohesion: 0.12
Nodes (16): Architecture, Auth: `authenticate` tool + token persistence, Context, Critical stdio constraint, Decisions locked during brainstorming, Error handling, Feedback identity + graceful Mongo degradation, Goals (+8 more)

### Community 16 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 17 - "mcp-server/main.ts"
Cohesion: 0.09
Nodes (18): AppModule, Module, SWIGGY_MCP_CLIENT, AuthDeps, AuthResult, runAuthentication(), verifyAndComplete(), bootstrap() (+10 more)

### Community 18 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 19 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 20 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 28 - "Global Constraints"
Cohesion: 0.20
Nodes (9): Global Constraints, MCP Server Reframe Implementation Plan, Self-Review, Task 1: Persistent `OAuthStateStore`, Task 2: Graceful MongoDB degradation, Task 3: `authenticate` login helper, Task 4: Tool registration, Task 5: stdio entrypoint + packaging (+1 more)

### Community 30 - "account-profile.service.spec.ts"
Cohesion: 0.33
Nodes (5): fakeMcp, fakePreferences, orderA, orderB, orderC

## Knowledge Gaps
- **183 isolated node(s):** `name`, `version`, `description`, `mcp`, `model-context-protocol` (+178 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `OAuthStateStore` connect `OAuthStateStore` to `real-swiggy-mcp.client.ts`, `mcp-server/main.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `McpSessionFactory` connect `OAuthStateStore` to `real-swiggy-mcp.client.ts`, `mcp-server/main.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _183 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `suggestions.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05754527162977867 - nodes in this community are weakly interconnected._
- **Should `real-swiggy-mcp.client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06994535519125683 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._
- **Should `OAuthStateStore` be split into smaller, more focused modules?**
  _Cohesion score 0.05641025641025641 - nodes in this community are weakly interconnected._
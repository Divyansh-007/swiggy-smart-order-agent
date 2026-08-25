# Graph Report - smart-order-agent  (2026-08-25)

## Corpus Check
- 56 files · ~35,349 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 420 nodes · 660 edges · 28 communities (23 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `510b3800`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- suggestions.service.ts
- real-swiggy-mcp.client.ts
- devDependencies
- mcp.module.ts
- preferences.service.ts
- What You Must Do When Invoked
- Phase 3 — Real MCP client + interface refactor (read path)
- dependencies
- compilerOptions
- SuggestionsService
- History-Driven Suggestions (Reorder + Discovery) Implementation Plan
- Smart Order Agent
- Surprise-To-Cart (Conclude at Cart) Implementation Plan
- graphify reference: extra exports and benchmark
- order-history.adapter.ts
- app.module.ts
- graphify reference: query, path, explain
- account-profile.service.spec.ts
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- CLAUDE.md
- .claude/CLAUDE.md
- extraction-spec.md

## God Nodes (most connected - your core abstractions)
1. `SwiggyOAuthProvider` - 18 edges
2. `McpSessionFactory` - 18 edges
3. `SwiggyMcpClient` - 15 edges
4. `OAuthStateStore` - 15 edges
5. `RealSwiggyMcpClient` - 14 edges
6. `compilerOptions` - 14 edges
7. `RestaurantResult` - 12 edges
8. `MockSwiggyMcpClient` - 12 edges
9. `What You Must Do When Invoked` - 12 edges
10. `History-Driven Suggestions (Reorder + Discovery) Implementation Plan` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Scored` --references--> `RestaurantMeta`  [EXTRACTED]
  src/ranking/reorder-ranking.service.ts → src/suggestions/account-profile.service.ts
- `RankedSuggestion` --references--> `RestaurantResult`  [EXTRACTED]
  src/ranking/ranking.service.ts → src/mcp/mcp-client.interface.ts
- `ReorderSuggestion` --references--> `ReorderItem`  [EXTRACTED]
  src/ranking/reorder-ranking.service.ts → src/mcp/mcp-client.interface.ts
- `RestaurantMeta` --references--> `ReorderItem`  [EXTRACTED]
  src/suggestions/account-profile.service.ts → src/mcp/mcp-client.interface.ts
- `MockSwiggyMcpClient` --implements--> `SwiggyMcpClient`  [EXTRACTED]
  src/mcp/mock-swiggy-mcp.client.ts → src/mcp/mcp-client.interface.ts

## Import Cycles
- None detected.

## Communities (28 total, 5 thin omitted)

### Community 0 - "suggestions.service.ts"
Cohesion: 0.07
Nodes (35): ReorderItem, RestaurantResult, SWIGGY_MCP_CLIENT, PreferenceProfile, PreferencesService, Injectable, RankingModule, Module (+27 more)

### Community 1 - "real-swiggy-mcp.client.ts"
Cohesion: 0.08
Nodes (21): AccountOrder, BuildCartParams, CartItemInput, CartSummary, PlaceOrderResult, SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient (+13 more)

### Community 2 - "devDependencies"
Cohesion: 0.08
Nodes (25): jest, description, devDependencies, jest, ts-jest, ts-node, ts-node-dev, @types/jest (+17 more)

### Community 3 - "mcp.module.ts"
Cohesion: 0.07
Nodes (19): Res, McpModule, Module, OAuthController, Controller, Get, Query, OAuthStateStore (+11 more)

### Community 4 - "preferences.service.ts"
Cohesion: 0.14
Nodes (17): InjectModel, PreferencesModule, Module, Feedback, FeedbackDocument, FeedbackSchema, Prop, Schema (+9 more)

### Community 5 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 6 - "Phase 3 — Real MCP client + interface refactor (read path)"
Cohesion: 0.08
Nodes (24): File Structure, Global Constraints, Phase 1 — Prerequisites & test harness, Phase 2 — OAuth via the SDK's `OAuthClientProvider` (idiomatic MCP), Phase 3 — Real MCP client + interface refactor (read path), Phase 4 — Ordering (guarded, real money), Real Swiggy MCP Integration Implementation Plan, Self-Review (+16 more)

### Community 7 - "dependencies"
Cohesion: 0.11
Nodes (19): @modelcontextprotocol/sdk, mongoose, @nestjs/common, @nestjs/config, @nestjs/core, @nestjs/mongoose, @nestjs/platform-express, dependencies (+11 more)

### Community 8 - "compilerOptions"
Cohesion: 0.11
Nodes (17): ES2021, src/**/*.ts, compilerOptions, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+9 more)

### Community 9 - "SuggestionsService"
Cohesion: 0.17
Nodes (8): Body, Post, SuggestionsController, Controller, Get, Query, SuggestionsService, Injectable

### Community 10 - "History-Driven Suggestions (Reorder + Discovery) Implementation Plan"
Cohesion: 0.15
Nodes (12): File Structure, Global Constraints, History-Driven Suggestions (Reorder + Discovery) Implementation Plan, Self-Review, Task 1: Capture live payloads + widen the read-only debug allow-list, Task 2: Interface + domain types + mock history, Task 3: Order-history adapters (reconciled to live shapes), Task 4: Real client methods (+4 more)

### Community 11 - "Smart Order Agent"
Cohesion: 0.17
Nodes (11): Architecture note, Configuration (`.env`), Endpoints, How it works, Known simplifications (good next steps), Mock mode (default — no Swiggy account needed), Real Swiggy mode, Roadmap — conclude at cart (next) (+3 more)

### Community 12 - "Surprise-To-Cart (Conclude at Cart) Implementation Plan"
Cohesion: 0.20
Nodes (9): File Structure, Global Constraints, Self-Review, Surprise-To-Cart (Conclude at Cart) Implementation Plan, Task 1: Cart contract reconciliation (interface + client + mock + adapter), Task 2: Restaurant menu tool (for discover picks), Task 3: `surpriseToCart` service + endpoint, Task 4: Live verification + reconciliation (real mutation — user consented) (+1 more)

### Community 13 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 14 - "order-history.adapter.ts"
Cohesion: 0.39
Nodes (7): cuisinesFromOrderDetails(), MONTHS, parseAmount(), parseOrderedAt(), reorderItemsOf(), snake(), toAccountOrders()

### Community 15 - "app.module.ts"
Cohesion: 0.33
Nodes (4): AppModule, Module, SuggestionsModule, Module

### Community 16 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 17 - "account-profile.service.spec.ts"
Cohesion: 0.33
Nodes (5): fakeMcp, fakePreferences, orderA, orderB, orderC

### Community 18 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 19 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 20 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

## Knowledge Gaps
- **152 isolated node(s):** `name`, `version`, `description`, `build`, `start` (+147 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SwiggyMcpClient` connect `real-swiggy-mcp.client.ts` to `suggestions.service.ts`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `McpSessionFactory` connect `mcp.module.ts` to `real-swiggy-mcp.client.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _152 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `suggestions.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07402597402597402 - nodes in this community are weakly interconnected._
- **Should `real-swiggy-mcp.client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07542087542087542 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `mcp.module.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06594071385359952 - nodes in this community are weakly interconnected._
# Graph Report - src  (2026-08-25)

## Corpus Check
- Corpus is ~9,805 words - fits in a single context window. You may not need a graph.

## Summary
- 228 nodes · 482 edges · 11 communities (9 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10

## God Nodes (most connected - your core abstractions)
1. `SwiggyOAuthProvider` - 18 edges
2. `McpSessionFactory` - 18 edges
3. `SwiggyMcpClient` - 15 edges
4. `OAuthStateStore` - 15 edges
5. `RealSwiggyMcpClient` - 14 edges
6. `RestaurantResult` - 12 edges
7. `MockSwiggyMcpClient` - 12 edges
8. `PreferencesService` - 11 edges
9. `SuggestionsService` - 11 edges
10. `AccountOrder` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Scored` --references--> `RestaurantMeta`  [EXTRACTED]
  ranking/reorder-ranking.service.ts → suggestions/account-profile.service.ts
- `RankedSuggestion` --references--> `RestaurantResult`  [EXTRACTED]
  ranking/ranking.service.ts → mcp/mcp-client.interface.ts
- `ReorderSuggestion` --references--> `ReorderItem`  [EXTRACTED]
  ranking/reorder-ranking.service.ts → mcp/mcp-client.interface.ts
- `RestaurantMeta` --references--> `ReorderItem`  [EXTRACTED]
  suggestions/account-profile.service.ts → mcp/mcp-client.interface.ts
- `AccountProfile` --inherits--> `PreferenceProfile`  [EXTRACTED]
  suggestions/account-profile.service.ts → preferences/preferences.service.ts

## Import Cycles
- None detected.

## Communities (11 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (28): RestaurantResult, McpModule, Module, RankingModule, Module, RankedSuggestion, RankingService, Injectable (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (14): AccountOrder, BuildCartParams, CartItemRef, CartSummary, PlaceOrderResult, SearchRestaurantsParams, SwiggyAddress, MOCK_CUISINES (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (7): OAuthStateStore, Injectable, config, SwiggyOAuthProvider, Injectable, CAPTURE_TOOLS, NOTE: SDK -32001 = RequestTimeout, not auth — do not clear the session on it.

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (11): OAuthController, Controller, Get, Query, McpDebugController, Controller, Get, Query (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (19): InjectModel, PreferencesModule, Module, PreferencesService, Injectable, Feedback, FeedbackDocument, FeedbackSchema (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (17): ReorderItem, SWIGGY_MCP_CLIENT, PreferenceProfile, ReorderRankingService, ReorderSuggestion, Scored, restaurantA, restaurantB (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.33
Nodes (7): cuisinesFromOrderDetails(), MONTHS, parseAmount(), parseOrderedAt(), reorderItemsOf(), snake(), toAccountOrders()

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (4): AppModule, Module, SuggestionsModule, Module

### Community 10 - "Community 10"
Cohesion: 0.60
Nodes (4): parseAmount(), snake(), toAddresses(), toRestaurants()

## Knowledge Gaps
- **23 isolated node(s):** `CartItemRef`, `MOCK_RESTAURANTS`, `MOCK_CUISINES`, `MOCK_ORDERS`, `config` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SwiggyMcpClient` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `McpSessionFactory` connect `Community 3` to `Community 1`, `Community 2`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `CartItemRef`, `MOCK_RESTAURANTS`, `MOCK_CUISINES` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07676767676767676 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11229946524064172 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10227272727272728 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.13675213675213677 - nodes in this community are weakly interconnected._
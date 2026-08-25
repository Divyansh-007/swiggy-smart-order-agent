export interface SwiggyAddress {
  addressId: string;
  label: string;        // "Home" | "Work" | ...
  displayText?: string; // human-readable address line (no coordinates ever)
}

export interface RestaurantResult {
  restaurantId: string;
  name: string;
  cuisine: string;      // primary cuisine (first of cuisines[]), lowercased+snaked for ranking
  avgPrice: number;     // costForTwo (rupees)
  isOpen: boolean;      // derived from availabilityStatus === "OPEN"
  etaMinutes: number;   // delivery ETA (minutes)
  rating: number;       // 0..5
  distanceKm?: number;
}

export interface SearchRestaurantsParams {
  addressId: string;
  query: string;        // required by the real tool; SuggestionsService supplies a cuisine/meal term
  offset?: number;
}

// --- ordering (cart journey) ---
export interface CartItemInput { menuItemId: string; quantity: number; }

export interface BuildCartParams {
  restaurantId: string;
  addressId: string;                 // REQUIRED by update_food_cart/get_food_cart
  items: CartItemInput[];
  restaurantName?: string;
}

export interface CartSummary {
  restaurantId: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
  itemTotal: number;
  toPay: number;         // pricing.to_pay — the live payable total
}

export interface PlaceOrderResult {
  orderId: string;
  status: string;
  etaMinutes: number;
}

// --- account order history (reorder suggestions) ---
export interface ReorderItem {
  menuItemId: string;
  name: string;
  quantity: number;
}

export interface AccountOrder {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  orderTotal: number;      // rupees, parsed from Swiggy's string
  orderedAt: Date;         // parsed from orderedTime
  isActiveOrder: boolean;
  reorderItems: ReorderItem[]; // exact items to re-add ([] if the order has no reorder action)
}

export interface SwiggyMcpClient {
  getAddresses(): Promise<SwiggyAddress[]>;
  searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]>;
  buildCart(params: BuildCartParams): Promise<CartSummary>;   // update_food_cart + get_food_cart
  placeOrder(): Promise<PlaceOrderResult>;                    // place_food_order (COD); guarded by caller
  getOrderHistory(addressId: string): Promise<AccountOrder[]>;        // get_food_orders (newest-first)
  getRestaurantCuisines(orderId: string): Promise<string[]>;          // get_food_order_details -> restaurant_cuisine[]
}

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
export interface CartItemRef { itemId: string; quantity: number; }

export interface BuildCartParams {
  restaurantId: string;
  items: CartItemRef[];
}

export interface CartSummary {
  restaurantId: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;        // rupees
}

export interface PlaceOrderResult {
  orderId: string;
  status: string;
  etaMinutes: number;
}

export interface SwiggyMcpClient {
  getAddresses(): Promise<SwiggyAddress[]>;
  searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]>;
  buildCart(params: BuildCartParams): Promise<CartSummary>;   // update_food_cart + get_food_cart
  placeOrder(): Promise<PlaceOrderResult>;                    // place_food_order (COD); guarded by caller
}

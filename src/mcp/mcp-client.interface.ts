export interface RestaurantResult {
  restaurantId: string;
  name: string;
  cuisine: string;
  avgPrice: number;
  isOpen: boolean;
  etaMinutes: number;
  rating: number;
}

export interface SearchRestaurantsParams {
  lat: number;
  lng: number;
  cuisine?: string;
  maxPrice?: number;
}

export interface PlaceOrderParams {
  restaurantId: string;
  itemIds: string[];
}

export interface PlaceOrderResult {
  orderId: string;
  status: string;
  etaMinutes: number;
}

/**
 * Anything that talks to Swiggy's Food MCP server must implement this.
 * Swap MockSwiggyMcpClient for a real client once localhost/prod MCP
 * access is granted — nothing else in the app needs to change.
 */
export interface SwiggyMcpClient {
  searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]>;
  placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult>;
}

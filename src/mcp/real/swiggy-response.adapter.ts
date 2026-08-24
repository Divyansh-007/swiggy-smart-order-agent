import { RestaurantResult, SwiggyAddress } from '../mcp-client.interface';

function snake(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Swiggy returns money as a display string (e.g. "₹500 for two"), not a number.
 * Pull the first integer out of it; pass numbers through unchanged.
 */
function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

/**
 * Maps get_addresses' structuredContent (`{ addresses: [...] }`) to domain addresses.
 * Real Swiggy fields: `id`, `addressLine`, `addressCategory`/`addressTag`.
 * Never surfaces coordinates or phone numbers.
 */
export function toAddresses(data: unknown): SwiggyAddress[] {
  const arr = Array.isArray(data) ? data : (data as any)?.addresses ?? [];
  return arr.map((a: any) => ({
    addressId: a.addressId ?? a.id,
    label: a.addressCategory ?? a.addressTag ?? a.label ?? a.type ?? 'Address',
    displayText: a.addressLine ?? a.displayText ?? a.address ?? undefined,
  }));
}

/**
 * Maps search_restaurants' structuredContent (`{ restaurants: [...] }`) to domain results.
 * Real Swiggy fields: `id`, `cuisines[]`, `costForTwo` (string), `avgRating`,
 * `deliveryTimeMinutes`, `availabilityStatus`, `distanceKm`.
 * Fallbacks retain compatibility with the documented/simple shape.
 */
export function toRestaurants(data: unknown): RestaurantResult[] {
  const arr = (data as any)?.restaurants ?? (Array.isArray(data) ? data : []);
  return arr.map((r: any) => ({
    restaurantId: r.id ?? r.restaurantId,
    name: r.name,
    cuisine: snake((r.cuisines?.[0] ?? r.cuisine ?? 'unknown') as string),
    avgPrice: parseAmount(r.costForTwo ?? r.avgPrice),
    isOpen: (r.availabilityStatus ?? (r.isOpen ? 'OPEN' : 'CLOSED')) === 'OPEN',
    etaMinutes: Number(r.deliveryTimeMinutes ?? r.etaMinutes ?? r.sla?.deliveryTime ?? 0),
    rating: Number(r.avgRating ?? r.rating ?? 0),
    distanceKm: r.distanceKm != null ? Number(r.distanceKm) : undefined,
  }));
}

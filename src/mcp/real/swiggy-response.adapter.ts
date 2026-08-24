import { RestaurantResult, SwiggyAddress } from '../mcp-client.interface';

function snake(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

export function toAddresses(data: unknown): SwiggyAddress[] {
  const arr = Array.isArray(data) ? data : (data as any)?.addresses ?? [];
  return arr.map((a: any) => ({
    addressId: a.addressId ?? a.id,
    label: a.label ?? a.type ?? 'Address',
    displayText: a.displayText ?? a.address ?? undefined,
  }));
}

export function toRestaurants(data: unknown): RestaurantResult[] {
  const arr = (data as any)?.restaurants ?? (Array.isArray(data) ? data : []);
  return arr.map((r: any) => ({
    restaurantId: r.id ?? r.restaurantId,
    name: r.name,
    cuisine: snake((r.cuisines?.[0] ?? r.cuisine ?? 'unknown') as string),
    avgPrice: Number(r.costForTwo ?? r.avgPrice ?? 0),
    isOpen: (r.availabilityStatus ?? (r.isOpen ? 'OPEN' : 'CLOSED')) === 'OPEN',
    etaMinutes: Number(r.etaMinutes ?? r.sla?.deliveryTime ?? 0),
    rating: Number(r.rating ?? r.avgRating ?? 0),
    distanceKm: r.distanceKm != null ? Number(r.distanceKm) : undefined,
  }));
}

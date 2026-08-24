import { toAddresses, toRestaurants } from './swiggy-response.adapter';

describe('swiggy adapters', () => {
  it('maps addresses (simple/documented shape)', () => {
    const data = [{ addressId: 'addr_1', label: 'Home', displayText: 'Home, Sec 21' }];
    expect(toAddresses(data)).toEqual([
      { addressId: 'addr_1', label: 'Home', displayText: 'Home, Sec 21' },
    ]);
  });

  it('maps restaurants, derives isOpen and snake-cases primary cuisine', () => {
    const data = {
      restaurants: [
        {
          id: 'r1',
          name: 'Bawarchi Biryani House',
          cuisines: ['Biryani', 'North Indian'],
          costForTwo: 350,
          availabilityStatus: 'OPEN',
          rating: 4.3,
          etaMinutes: 32,
          distanceKm: 2.1,
        },
        { id: 'r2', name: 'Closed Place', cuisines: ['Thai'], costForTwo: 400, availabilityStatus: 'CLOSED', rating: 4.0, etaMinutes: 0 },
      ],
    };
    const out = toRestaurants(data);
    expect(out[0]).toMatchObject({ restaurantId: 'r1', cuisine: 'biryani', isOpen: true, avgPrice: 350 });
    expect(out[1].isOpen).toBe(false);
  });

  // --- Reconciled against LIVE Swiggy Food payloads (captured 2026-08-24). ---
  // Address values are synthetic (real payload carries PII: name/address/phone);
  // only the field STRUCTURE mirrors what get_addresses actually returns.

  it('maps the real get_addresses structuredContent shape', () => {
    const structuredContent = {
      addresses: [
        {
          id: 'addr_home',
          addressLine: 'Test User: 123 Example Rd, Sector X, City, 000000, India. (Tag)',
          phoneNumber: '****0000',
          addressCategory: 'Home',
          addressTag: 'Home',
        },
        {
          id: 'addr_work',
          addressLine: 'Test User: 4th Floor, Office Park, City, 000000, India. (Office)',
          phoneNumber: '****0000',
          addressCategory: 'Work',
          addressTag: 'Work',
        },
      ],
      total: 2,
    };
    expect(toAddresses(structuredContent)).toEqual([
      { addressId: 'addr_home', label: 'Home', displayText: 'Test User: 123 Example Rd, Sector X, City, 000000, India. (Tag)' },
      { addressId: 'addr_work', label: 'Work', displayText: 'Test User: 4th Floor, Office Park, City, 000000, India. (Office)' },
    ]);
  });

  it('maps the real search_restaurants shape: string costForTwo, deliveryTimeMinutes, avgRating', () => {
    const structuredContent = {
      restaurants: [
        {
          id: '81276',
          name: 'Behrouz Biryani',
          cuisines: ['Biryani', 'North Indian', 'Kebabs'],
          avgRating: 4.4,
          totalRatings: '5.0K+',
          costForTwo: '₹500 for two',
          areaName: 'Rohini',
          distanceKm: 3.7,
          deliveryTimeMinutes: 25,
          deliveryTimeRange: '20-25 MINS',
          availabilityStatus: 'OPEN',
        },
      ],
      total: 1,
    };
    const out = toRestaurants(structuredContent);
    expect(out[0]).toEqual({
      restaurantId: '81276',
      name: 'Behrouz Biryani',
      cuisine: 'biryani',
      avgPrice: 500, // parsed out of "₹500 for two" (was NaN before reconciliation)
      isOpen: true,
      etaMinutes: 25, // from deliveryTimeMinutes (was 0 before reconciliation)
      rating: 4.4, // from avgRating
      distanceKm: 3.7,
    });
  });

  it('parses costForTwo with a thousands separator', () => {
    const out = toRestaurants({ restaurants: [{ id: 'x', name: 'Pricey', cuisines: ['Sushi'], costForTwo: '₹1,200 for two', availabilityStatus: 'OPEN', avgRating: 4.6, deliveryTimeMinutes: 40 }] });
    expect(out[0].avgPrice).toBe(1200);
  });
});

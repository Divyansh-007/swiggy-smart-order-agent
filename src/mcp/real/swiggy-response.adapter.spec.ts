import { toAddresses, toRestaurants } from './swiggy-response.adapter';

describe('swiggy adapters', () => {
  it('maps addresses (no coordinates)', () => {
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
});

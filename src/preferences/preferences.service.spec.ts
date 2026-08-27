import { PreferencesService } from './preferences.service';

function throwingModel() {
  return {
    create: jest.fn().mockRejectedValue(new Error('Mongo down')),
    find: jest.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ exec: () => Promise.reject(new Error('Mongo down')) }) }),
    }),
  } as any;
}

describe('PreferencesService (store offline)', () => {
  it('recordFeedback returns a soft failure instead of throwing', async () => {
    const svc = new PreferencesService(throwingModel(), throwingModel());
    const res = await svc.recordFeedback('dj', 'r1', 'skipped');
    expect(res.recorded).toBe(false);
    expect(res.note).toMatch(/offline/i);
  });

  it('getProfile degrades to an empty profile when reads fail', async () => {
    const svc = new PreferencesService(throwingModel(), throwingModel());
    const profile = await svc.getProfile('dj');
    expect(profile.rejectedRestaurantIds).toEqual([]);
    expect(profile.recentRestaurantIds).toEqual([]);
    expect(profile.avgOrderValue).toBe(0);
  });
});

describe('PreferencesService (store online)', () => {
  it('recordFeedback returns recorded:true on success', async () => {
    const ok = { create: jest.fn().mockResolvedValue({}), find: jest.fn() } as any;
    const svc = new PreferencesService(ok, ok);
    const res = await svc.recordFeedback('dj', 'r1', 'accepted');
    expect(res).toEqual({ recorded: true });
  });
});

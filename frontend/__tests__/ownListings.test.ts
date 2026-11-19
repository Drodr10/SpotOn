/**
 * Renter feeds (search, Home "Listings Near You") hide the viewer's own
 * listings; signed out or a failed claims lookup hides nothing.
 */
import { getViewerId, withoutOwnListings } from '../src/utils/ownListings';

const rows = [
  { id: 'a', owner_id: 'me' },
  { id: 'b', owner_id: 'someone' },
  { id: 'c', owner_id: null },
];

describe('withoutOwnListings', () => {
  it('drops listings owned by the viewer', () => {
    expect(withoutOwnListings(rows, 'me').map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('keeps everything when signed out', () => {
    expect(withoutOwnListings(rows, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(withoutOwnListings(rows, undefined)).toHaveLength(3);
  });

  it('does not mutate the input', () => {
    withoutOwnListings(rows, 'me');
    expect(rows).toHaveLength(3);
  });
});

describe('getViewerId', () => {
  it('reads the sub claim', async () => {
    const client = { auth: { getClaims: async () => ({ data: { claims: { sub: 'me' } } }) } };
    await expect(getViewerId(client)).resolves.toBe('me');
  });

  it('is null when signed out', async () => {
    const client = { auth: { getClaims: async () => ({ data: null }) } };
    await expect(getViewerId(client)).resolves.toBeNull();
  });

  it('is null when the lookup throws', async () => {
    const client = {
      auth: {
        getClaims: async () => {
          throw new Error('offline');
        },
      },
    };
    await expect(getViewerId(client)).resolves.toBeNull();
  });
});

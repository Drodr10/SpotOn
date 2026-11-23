/**
 * Other users' profiles are read through the get_public_profiles RPC, never
 * from('profiles') (RLS hides other users' rows; see
 * supabase/migrations/20261116160000_profiles_privacy.sql).
 */
import { fetchPublicProfile, fetchPublicProfiles } from '../src/utils/publicProfiles';
import { supabase } from '../src/utils/supabase';

jest.mock('../src/utils/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const rpc = supabase.rpc as jest.Mock;
const A = '77777777-7777-7777-7777-777777777777';
const B = '88888888-8888-8888-8888-888888888888';

beforeEach(() => {
  rpc.mockReset();
  (supabase.from as jest.Mock).mockReset();
});

test('calls the RPC once with de-duplicated ids and keys rows by id', async () => {
  rpc.mockResolvedValue({
    data: [{ id: A, full_name: 'Alice', avatar_url: 'https://x/a.png' }],
    error: null,
  });
  const byId = await fetchPublicProfiles([A, A, B, null, undefined]);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('get_public_profiles', { p_ids: [A, B] });
  expect(byId.get(A)).toEqual({ id: A, full_name: 'Alice', avatar_url: 'https://x/a.png' });
  expect(byId.has(B)).toBe(false);
  expect(supabase.from).not.toHaveBeenCalled();
});

test('no ids → no request', async () => {
  expect((await fetchPublicProfiles([null])).size).toBe(0);
  expect(await fetchPublicProfile(undefined)).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

test('an RPC error degrades to "not found" rather than throwing', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  expect(await fetchPublicProfile(A)).toBeNull();
  log.mockRestore();
});

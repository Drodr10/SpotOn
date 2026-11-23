/**
 * listing photos (utils/listingPhoto.ts).
 *
 * Production bug, Nov 2026: the listing-photos bucket didn't exist, every upload
 * failed, and CreateListing2 saved the host phone's file:// path as photo_url —
 * so search and the home slider showed blanks on every other phone.
 */
import {
  displayablePhotoUrl,
  listingPhotoPath,
  uploadListingPhoto,
} from '../src/utils/listingPhoto';

describe('displayablePhotoUrl', () => {
  it('keeps public http(s) URLs', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/listing-photos/u/listing_1.jpg';
    expect(displayablePhotoUrl(url)).toBe(url);
    expect(displayablePhotoUrl(' http://a/b.jpg ')).toBe('http://a/b.jpg');
  });

  it.each([
    'file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/ImagePicker/x.jpg',
    'file:///data/user/0/com.parking.spoton.app/cache/ImagePicker/x.jpg',
    'content://media/external/images/1',
    'ph://ABC',
    '',
    '   ',
    null,
    undefined,
  ])('hides %p (only exists on the host phone, or no photo)', (url) => {
    expect(displayablePhotoUrl(url)).toBeNull();
  });
});

describe('listingPhotoPath', () => {
  it("puts the file in the owner's folder, which the storage INSERT policy requires", () => {
    expect(listingPhotoPath('user-1', 42)).toBe('user-1/listing_42.jpg');
  });
});

describe('uploadListingPhoto', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function fakeClient(result: { data: { path: string } | null; error: Error | null }) {
    const upload = jest.fn().mockResolvedValue(result);
    const getPublicUrl = jest.fn((path: string) => ({
      data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/listing-photos/${path}` },
    }));
    const from = jest.fn(() => ({ upload, getPublicUrl }));
    return { client: { storage: { from } } as any, from, upload };
  }

  function fakeFile(bytes: number) {
    globalThis.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
    }) as any;
  }

  it("uploads the bytes to the owner's folder and returns the public URL", async () => {
    fakeFile(10);
    const { client, from, upload } = fakeClient({ data: { path: 'u1/listing_5.jpg' }, error: null });
    const url = await uploadListingPhoto(client, 'u1', 'file:///photo.jpg', 5);
    expect(from).toHaveBeenCalledWith('listing-photos');
    expect(upload).toHaveBeenCalledWith('u1/listing_5.jpg', expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
    });
    expect(url).toBe('https://x.supabase.co/storage/v1/object/public/listing-photos/u1/listing_5.jpg');
  });

  it('throws instead of falling back to the local path when storage refuses', async () => {
    fakeFile(10);
    const { client } = fakeClient({ data: null, error: new Error('Bucket not found') });
    await expect(uploadListingPhoto(client, 'u1', 'file:///photo.jpg')).rejects.toThrow('Bucket not found');
  });

  it('refuses an empty file rather than uploading 0 bytes', async () => {
    fakeFile(0);
    const { client, upload } = fakeClient({ data: { path: 'x' }, error: null });
    await expect(uploadListingPhoto(client, 'u1', 'file:///photo.jpg')).rejects.toThrow(/empty/);
    expect(upload).not.toHaveBeenCalled();
  });
});

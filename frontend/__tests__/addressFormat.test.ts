/**
 * formatReverseGeocodeAddress — the pin/current-location address in
 * CreateListing2. Regression: parts were all comma-joined, giving
 * "1201, Brickell Ave, Miami, FL" on iOS and Android.
 */
import { formatReverseGeocodeAddress } from '../src/utils/geocode';

describe('formatReverseGeocodeAddress', () => {
  it('joins street number and street with a space, not a comma', () => {
    expect(
      formatReverseGeocodeAddress({ streetNumber: '1201', street: 'Brickell Ave', city: 'Miami', region: 'FL' }),
    ).toBe('1201 Brickell Ave, Miami, FL');
  });

  it('omits a missing street number', () => {
    expect(formatReverseGeocodeAddress({ street: 'Brickell Ave', city: 'Miami', region: 'FL' })).toBe(
      'Brickell Ave, Miami, FL',
    );
  });

  it('skips missing city / region without leaving stray commas', () => {
    expect(formatReverseGeocodeAddress({ streetNumber: '1201', street: 'Brickell Ave', region: 'FL' })).toBe(
      '1201 Brickell Ave, FL',
    );
    expect(formatReverseGeocodeAddress({ streetNumber: '1201', street: 'Brickell Ave' })).toBe('1201 Brickell Ave');
    expect(formatReverseGeocodeAddress({ city: 'Miami', region: 'FL' })).toBe('Miami, FL');
  });

  it('treats null, empty and whitespace parts as missing and trims the rest', () => {
    expect(
      formatReverseGeocodeAddress({ streetNumber: null, street: '  Brickell Ave ', city: '', region: '   ' }),
    ).toBe('Brickell Ave');
  });

  it('ignores a lone street number with no street', () => {
    expect(formatReverseGeocodeAddress({ streetNumber: '1201', city: 'Miami', region: 'FL' })).toBe('Miami, FL');
  });

  it('falls back to name when there is no street', () => {
    expect(formatReverseGeocodeAddress({ name: 'Bayfront Park', city: 'Miami', region: 'FL' })).toBe(
      'Bayfront Park, Miami, FL',
    );
  });

  it('does not repeat a name that equals the city', () => {
    expect(formatReverseGeocodeAddress({ name: 'Miami', city: 'Miami', region: 'FL' })).toBe('Miami, FL');
  });

  it('returns an empty string for nothing usable', () => {
    expect(formatReverseGeocodeAddress(null)).toBe('');
    expect(formatReverseGeocodeAddress(undefined)).toBe('');
    expect(formatReverseGeocodeAddress({})).toBe('');
  });
});

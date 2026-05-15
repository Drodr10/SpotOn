/**
 * Location-based tax-rate lookup for booking totals.
 *
 * Resolves a state from coords via expo-location's reverse geocoder, then maps
 * to a static rate from `taxRates.ts`. Falls back to a flat default rate when
 * the geocode fails or the state isn't in the table.
 */
import * as Location from 'expo-location';

import { US_STATE_TAX_RATES, DEFAULT_TAX_RATE } from './taxRates';

export interface TaxResult {
  rate: number;
  jurisdiction: string;
}

export async function getTaxRateForCoords(
  latitude: number,
  longitude: number,
): Promise<TaxResult> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const region = results?.[0]?.region ?? null; // state name

    if (region && US_STATE_TAX_RATES[region] !== undefined) {
      return { rate: US_STATE_TAX_RATES[region], jurisdiction: region };
    }
  } catch (e) {
    console.warn('[tax] reverseGeocode failed, using default rate', e);
  }

  return { rate: DEFAULT_TAX_RATE, jurisdiction: 'Default' };
}

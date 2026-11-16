/**
 * Vehicle helpers shared by RegisterVehicle (add/edit), Profile's car cards and
 * anywhere a plate is shown. Pure functions except decodeVin (network).
 */

/** USPS codes accepted by vehicles_plate_state_check (20261116140000). */
export const US_PLATE_STATES: readonly { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'PR', name: 'Puerto Rico' }, { code: 'GU', name: 'Guam' },
  { code: 'VI', name: 'U.S. Virgin Islands' }, { code: 'AS', name: 'American Samoa' },
  { code: 'MP', name: 'Northern Mariana Islands' },
];

const STATE_CODES = new Set(US_PLATE_STATES.map((s) => s.code));

export function isPlateState(code: string | null | undefined): boolean {
  return !!code && STATE_CODES.has(code.toUpperCase());
}

/** Upper-case and drop spaces/dashes: "abc-1234 " → "ABC1234". */
export function normalizePlate(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * "FL · ABC1234", or just the plate for vehicles saved before plate_state
 * existed. Pass a last-4 string to get "FL · •••1234".
 */
export function formatPlate(plate: string, state?: string | null, masked = false): string {
  const shown = masked ? `•••${plate}` : plate;
  return state ? `${state} · ${shown}` : shown;
}

// ── VIN ────────────────────────────────────────────────────────────────────

/** 17 chars, no I/O/Q (ISO 3779). Check digit is not enforced: it is only
 *  mandatory for North-American VINs and NHTSA reports bad ones anyway. */
export function isVinShaped(raw: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(raw.trim().toUpperCase());
}

/**
 * "HONDA" → "Honda", "MERCEDES-BENZ" → "Mercedes-Benz". Tokens of ≤3 letters
 * or containing a digit stay upper-case ("BMW", "GMC", "RAV4", "CR-V").
 * Leaves already mixed-case input alone.
 */
export function tidyCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.replace(/[A-Z0-9]+/g, (tok) =>
    tok.length <= 3 || /\d/.test(tok) ? tok : tok[0] + tok.slice(1).toLowerCase(),
  );
}

export interface DecodedVin {
  make: string;
  model: string;
  year: string | null;
}

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';

/**
 * Look up make/model with NHTSA's free, keyless vPIC API. Returns null when the
 * VIN doesn't decode to a make and model. The VIN is only sent to NHTSA — it is
 * never stored by SpotOn.
 */
export async function decodeVin(raw: string, timeoutMs = 10_000): Promise<DecodedVin | null> {
  const vin = raw.trim().toUpperCase();
  if (!isVinShaped(vin)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${VPIC_URL}${encodeURIComponent(vin)}?format=json`, {
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    return parseVpicResult(body);
  } finally {
    clearTimeout(timer);
  }
}

export function parseVpicResult(body: any): DecodedVin | null {
  const row = body?.Results?.[0];
  const make = String(row?.Make ?? '').trim();
  const model = String(row?.Model ?? '').trim();
  if (!make || !model) return null;
  const year = String(row?.ModelYear ?? '').trim();
  return { make: tidyCase(make), model: tidyCase(model), year: year || null };
}

// ── Errors ─────────────────────────────────────────────────────────────────

/**
 * True when the database doesn't have vehicles.plate_state yet
 * (20261116140000 not applied). PostgREST answers PGRST204 "Could not find the
 * 'plate_state' column ... in the schema cache"; callers retry without it so a
 * build that ships ahead of the migration can still add and edit cars.
 */
export function isMissingPlateStateColumn(
  err: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? '';
  return (err.code === 'PGRST204' || msg.includes('schema cache')) && msg.includes('plate_state');
}

/**
 * trg_guard_vehicle_in_active_booking refuses edits/deletes while the car is on
 * an unfinished booking; its message is already written for the user.
 */
export function vehicleSaveErrorMessage(
  err: { message?: string; code?: string } | null | undefined,
): string {
  const msg = err?.message ?? '';
  // Both trg_guard_vehicle_in_active_booking messages are written for users.
  if (msg.includes('booking that has not finished') || msg.includes('checking out right now')) return msg;
  // FK from reservations before 20261116120000 (ON DELETE SET NULL) is applied.
  if (err?.code === '23503' || msg.includes('violates foreign key constraint')) {
    return "This car has booking history, so it can't be removed yet. Please try again later.";
  }
  if (msg.includes('vehicles_plate_state_check')) return 'Pick the state shown on your plate.';
  return msg || 'Something went wrong. Please try again.';
}

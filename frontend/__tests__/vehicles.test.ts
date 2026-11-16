/**
 * Tests for the vehicle helpers behind add/edit car and the car cards.
 *
 * WHAT THESE PIN
 *   * the client state list matches the DB CHECK constraint (same 56 codes) —
 *     a code the DB rejects would surface as a raw constraint error
 *   * plate normalisation and display, including legacy rows with no state
 *   * VIN shape rules (17 chars, no I/O/Q) and vPIC result parsing, including
 *     the "decoded nothing" case that must not autofill blanks
 *   * the booking-lock DB message reaches the user verbatim
 *
 * WHAT THESE DO NOT COVER
 *   The live NHTSA request, and the screens themselves.
 */
import {
  US_PLATE_STATES,
  isPlateState,
  normalizePlate,
  formatPlate,
  isVinShaped,
  tidyCase,
  parseVpicResult,
  vehicleSaveErrorMessage,
  isMissingPlateStateColumn,
} from '../src/utils/vehicles';

describe('plate states', () => {
  it('has the 56 codes the database accepts, no duplicates', () => {
    const codes = US_PLATE_STATES.map((s) => s.code);
    expect(codes).toHaveLength(56);
    expect(new Set(codes).size).toBe(56);
  });

  it('validates case-insensitively and rejects unknowns', () => {
    expect(isPlateState('fl')).toBe(true);
    expect(isPlateState('DC')).toBe(true);
    expect(isPlateState('XX')).toBe(false);
    expect(isPlateState('')).toBe(false);
    expect(isPlateState(null)).toBe(false);
  });
});

describe('plates', () => {
  it('normalises spacing, dashes and case', () => {
    expect(normalizePlate(' abc-12 34 ')).toBe('ABC1234');
  });

  it('formats with and without a state', () => {
    expect(formatPlate('ABC1234', 'FL')).toBe('FL · ABC1234');
    expect(formatPlate('ABC1234', null)).toBe('ABC1234');
    expect(formatPlate('1234', 'GA', true)).toBe('GA · •••1234');
  });
});

describe('VIN', () => {
  it('accepts a 17-char VIN and rejects I, O, Q and wrong lengths', () => {
    expect(isVinShaped('1HGCM82633A004352')).toBe(true);
    expect(isVinShaped(' 1hgcm82633a004352 ')).toBe(true);
    expect(isVinShaped('1HGCM82633A00435')).toBe(false);
    expect(isVinShaped('1HGCM82633A0043I2')).toBe(false);
    expect(isVinShaped('1HGCM82633A0043O2')).toBe(false);
  });

  it('title-cases shouty vPIC values but leaves mixed case alone', () => {
    expect(tidyCase('HONDA')).toBe('Honda');
    expect(tidyCase('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(tidyCase('CR-V')).toBe('CR-V');
    expect(tidyCase('BMW')).toBe('BMW');
    expect(tidyCase('RAV4')).toBe('RAV4');
    expect(tidyCase('LAND ROVER')).toBe('Land Rover');
    expect(tidyCase('Accord')).toBe('Accord');
  });

  it('parses a decoded result', () => {
    expect(parseVpicResult({ Results: [{ Make: 'HONDA', Model: 'Accord', ModelYear: '2003' }] }))
      .toEqual({ make: 'Honda', model: 'Accord', year: '2003' });
  });

  it('returns null when vPIC decoded no make/model', () => {
    expect(parseVpicResult({ Results: [{ Make: '', Model: '', ModelYear: '' }] })).toBeNull();
    expect(parseVpicResult({})).toBeNull();
  });
});

describe('save errors', () => {
  it('passes the booking-lock message through unchanged', () => {
    const msg = 'This car is on a booking that has not finished yet. You can change or remove it once the booking ends.';
    expect(vehicleSaveErrorMessage({ message: msg })).toBe(msg);
  });

  it('turns the state CHECK violation into a plain instruction', () => {
    expect(vehicleSaveErrorMessage({ message: 'new row violates check constraint "vehicles_plate_state_check"' }))
      .toBe('Pick the state shown on your plate.');
  });

  it('explains the pre-migration FK refusal instead of showing it raw', () => {
    expect(vehicleSaveErrorMessage({ code: '23503', message: 'update or delete on table "vehicles" violates foreign key constraint' }))
      .toMatch(/booking history/);
  });

  it('detects a database without plate_state, and nothing else', () => {
    expect(isMissingPlateStateColumn({ code: 'PGRST204', message: "Could not find the 'plate_state' column of 'vehicles' in the schema cache" })).toBe(true);
    expect(isMissingPlateStateColumn({ code: 'PGRST204', message: "Could not find the 'color' column of 'vehicles' in the schema cache" })).toBe(false);
    expect(isMissingPlateStateColumn({ message: 'new row violates check constraint "vehicles_plate_state_check"' })).toBe(false);
    expect(isMissingPlateStateColumn(null)).toBe(false);
  });

  it('never returns an empty message', () => {
    expect(vehicleSaveErrorMessage(null)).toMatch(/try again/);
  });
});

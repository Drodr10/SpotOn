# Frontend Migration Guide — Temporal Pricing (Ticket #41)

## Overview

The backend has been updated to support **multi-tier pricing** with **dynamic platform fees**. Instead of a single `price_per_hour` field, listings now support `hourly_rate`, `daily_rate`, `weekly_rate`, and `monthly_rate`.

This guide walks you through the necessary frontend changes.

---

## Architecture Changes

### Pricing Schema

**Before (Deprecated):**
```json
{
  "id": "listing-id",
  "price_per_hour": 25.00
}
```

**After (New):**
```json
{
  "id": "listing-id",
  "hourly_rate": 25.00,
  "daily_rate": 150.00,
  "weekly_rate": 800.00,
  "monthly_rate": 2800.00
}
```

**Important:** All four rate fields may be `NULL`. The backend enforces that bookings for a given duration only succeed if the corresponding rate exists. For example, a 10-hour booking requires `daily_rate` to be non-NULL.

### Pricing Calculation (moved to backend)

**Before:** Frontend computed `total_price = price_per_hour * hours`.

**After:** Backend computes pricing using a "cap pricing" algorithm:
- Choose the **minimum cost** across all available tiers for the requested duration.
- Apply platform fee: **15% for short-term (hourly/daily), 7% for long-term (weekly/monthly)**.
- Calculate `host_payout = subtotal` (platform fee is the difference).

**Example:**
```
Booking: 8.9 hours
Listing has: hourly_rate=25, daily_rate=150

Options:
  - Hourly: 8.9 * $25 = $222.50
  - Daily:  1 * $150 = $150.00 (minimum, chosen)
  
Platform fee (short-term): $150 * 0.15 = $22.50
Total: $172.50
Host payout: $150.00
```

---

## New Endpoints

### Preview Pricing (No Reservation Created)

```
GET /api/reservations/preview?listing_id=abc-123&start_time=2026-05-13T10:00:00Z&end_time=2026-05-13T19:00:00Z
```

**Response (200):**
```json
{
  "subtotal": "150.00",
  "platform_fee": "22.50",
  "host_payout": "150.00",
  "total": "172.50",
  "tier": "daily",
  "units": "1",
  "rate": "150.00"
}
```

**Error (400) — Duration not supported:**
```json
{
  "error": "Daily bookings not supported for this listing"
}
```

**Error (404) — Listing not found:**
```json
{
  "error": "Listing not found"
}
```

Use this endpoint **before** the user confirms a booking to show the final price breakdown.

### Create Reservation

```
POST /api/reservations
```

**Request (changes):**
```json
{
  "listing_id": "abc-123",
  "renter_id": "user-id",
  "start_time": "2026-05-13T10:00:00Z",
  "end_time": "2026-05-13T19:00:00Z"
}
```

⚠️ **IMPORTANT:** Do **NOT** send `total_price` from the client. The server calculates it.

**Response (201):**
```json
{
  "reservation_id": "res-id",
  "conversation_id": "conv-id",
  "total_price": "172.50",
  "platform_fee": "22.50",
  "host_payout": "150.00",
  "message": "Reservation created successfully and conversation initiated"
}
```

---

## Frontend Code Changes Required

### 1. Listing Fetches

**Before:**
```typescript
const listings = await supabase.table("listings")
  .select("id, address, price_per_hour")
  .execute();
```

**After:**
```typescript
const listings = await supabase.table("listings")
  .select("id, address, hourly_rate, daily_rate, weekly_rate, monthly_rate")
  .execute();
```

### 2. Create Listing Form

Add inputs for each rate tier. Example schema:

```typescript
interface CreateListingData {
  address: string;
  latitude: number;
  longitude: number;
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
}
```

Hosts may leave some rates as `NULL` if they don't support that booking duration.

### 3. Booking Flow (Critical)

**Before:**
```typescript
const subtotal = listing.price_per_hour * hoursBooked;
const total = subtotal * 1.15; // hard-coded 15% fee

const response = await fetch("/api/reservations", {
  method: "POST",
  body: JSON.stringify({
    listing_id: listing.id,
    renter_id: user.id,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    total_price: total  // ❌ Client-computed (WRONG)
  })
});
```

**After:**
```typescript
// 1. Fetch pricing preview
const previewResp = await fetch(
  `/api/reservations/preview?listing_id=${listing.id}&start_time=${startTime.toISOString()}&end_time=${endTime.toISOString()}`
);

if (!previewResp.ok) {
  const error = await previewResp.json();
  showError(error.error); // e.g., "Daily bookings not supported for this listing"
  return;
}

const pricing = await previewResp.json();
// pricing = { subtotal, platform_fee, host_payout, total, tier, units, rate }

// 2. Show pricing breakdown to user (optional but recommended)
console.log(`Booking ${pricing.units} ${pricing.tier}(s) @ $${pricing.rate}/unit`);
console.log(`Total: $${pricing.total} (includes $${pricing.platform_fee} platform fee)`);

// 3. Create reservation (server will re-compute and validate price)
const bookingResp = await fetch("/api/reservations", {
  method: "POST",
  body: JSON.stringify({
    listing_id: listing.id,
    renter_id: user.id,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString()
    // ❌ DO NOT include total_price (server computes it)
  })
});
```

### 4. Display Price Per Listing

**Before:**
```tsx
<Text>${listing.price_per_hour}/hr</Text>
```

**After:** Show all available rates or the "best price" for a typical booking:

```tsx
const bestHourlyPrice = listing.hourly_rate;
const bestDailyPrice = listing.daily_rate ? listing.daily_rate / 24 : null;
const displayPrice = Math.min(...[bestHourlyPrice, bestDailyPrice].filter(p => p));

<Text>From ${displayPrice.toFixed(2)}/hr</Text>
```

Or display a breakdown:
```tsx
<View>
  {listing.hourly_rate && <Text>Hourly: ${listing.hourly_rate}/hr</Text>}
  {listing.daily_rate && <Text>Daily: ${listing.daily_rate}/day</Text>}
  {listing.weekly_rate && <Text>Weekly: ${listing.weekly_rate}/wk</Text>}
  {listing.monthly_rate && <Text>Monthly: ${listing.monthly_rate}/mo</Text>}
</View>
```

---

## Testing Checklist

- [ ] Update `SuggestionsList.tsx` to fetch new rate fields instead of `price_per_hour`
- [ ] Update `Search.tsx` booking flow to call preview endpoint
- [ ] Update `CreateListing2.tsx` form to accept all four rates
- [ ] Verify booking doesn't send `total_price`
- [ ] Test error handling: try booking with a duration tier that's NULL (expect 400)
- [ ] Add unit tests for price calculation and tier selection (8.9h → daily cap vs 9h → daily)

---

## Rollback Plan

If critical issues arise:
1. Keep `price_per_hour` column in DB (migrations preserve it as a fallback).
2. Frontend can temporarily revert to single-rate display.
3. Backend will accept both old and new schemas during transition period.

---

## Questions?

Refer to the backend API documentation in `backend/README.md` or run:
```bash
curl "http://localhost:5000/api/reservations/preview?listing_id=test&start_time=2026-05-13T10:00:00Z&end_time=2026-05-13T19:00:00Z"
```


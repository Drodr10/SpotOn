# SpotOn API Specifications

This document outlines the available endpoints for the SpotOn backend.
Base URL: `http://localhost:5000/api`

---

## Authentication

### `POST /auth/signup`

- **Description**: Creates a Supabase user and a record in the profiles table.
- **Body**: `{email, password, full_name}`

### `POST /auth/login`

- **Description**: Returns a session token for the mobile app to store.
- **Body**: `{email, password}`

## User Profiles

### `GET /profiles/<id>`

- **Description**: Fetches name, email, and rating_avg for a specific user.
- **Response**: `200 OK` with specific user info

### `PUT /profiles/<id>`

- **Description**: Updates user settings or profile picture.
- **Body**: `{full_name, photo_url}`

## Listings

### `GET /listings`

- **Description**: Returns all active parking spots. Optionally filters by availability for a requested time range.
- **Query Parameters** (optional):
  - `start_time` — ISO 8601 timestamp (e.g., `2026-05-15T14:00:00Z`). When provided with `end_time`, filters to listings without overlapping reservations.
  - `end_time` — ISO 8601 timestamp (e.g., `2026-05-15T16:00:00Z`).
- **Response**: `200 OK` with an array of listing objects (filtered by time range if provided).
- **Example**: `GET /listings?start_time=2026-05-15T14:00:00Z&end_time=2026-05-15T16:00:00Z`

### `POST /listings`

- **Description**: Creates a new parking spot.
- **Body**: `{ owner_id, address, price_per_hour, latitude, longitude }`

---

## Reservations

### `POST /reservations` (removed)

- **Response**: always `410 Gone`. It created unpaid `pending` bookings with no PaymentIntent that never expired, so anyone signed in could block a spot's calendar for free. Bookings are created through checkout: `POST /stripe/create-booking-payment`, then the reservation is inserted once paid (webhook / `POST /stripe/finalize-booking`). The payout sweep cancels any leftover unpaid `pending` rows with no PaymentIntent after 30 minutes.

### `GET /reservations/<user_id>`

- **Description**: Returns all reservations made by a specific user (past and upcoming).
- **Response**: `200 OK` with reservation data array
---

## Messaging

### `GET /messages/<conversation_id>`

- **Description**: Fetches all messages for a specific chat.
- **Response**: Sorted by `sent_at` ascending.


## Stripe

### 'GET /stripe/key

- **Description**: Returns the stripe publishable key that is used in in the frontend stripe integration.
- **Response**: `{ publishableKey }` with `200 OK`.

### 'POST /stripe/payment-sheet
- **Description**: Generates and returns a payment sheet used for creating a promptable transaction for the user.
- **Body**: `{price}`, where price is given in cents. 
- **Response**: `{ paymentIntent, customerSessionClientSecret, customer }`.

### 'POST /stripe/create-connect-account
- **Description**: Generates a stripe account ID for a given user.
- **Body**: `{user_id}`, corresponding to their supabase account ID. 
- **Response**: `{ account_id }`.

### 'POST /stripe/payment-sheet
- **Description**: Generates a link used for onboarding new users to Stripe.
- **Body**: `{user_id}`, corresponding to their supabase account ID. 
- **Response**: `{ account_link_url }` used for user onboarding.


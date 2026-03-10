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

- **Description**: Returns all active parking spots.
- **Response**: `200 OK` with an array of listing objects.

### `POST /listings`

- **Description**: Creates a new parking spot.
- **Body**: `{ owner_id, address, price_per_hour, latitude, longitude }`

---

## Reservations

### `POST /reservations`

- **Description**: Creates a booking for a spot.
- **Body**: `{ listing_id, renter_id, start_time, end_time, total_price }`

---

## Messaging

### `GET /messages/<conversation_id>`

- **Description**: Fetches all messages for a specific chat.
- **Response**: Sorted by `sent_at` ascending.

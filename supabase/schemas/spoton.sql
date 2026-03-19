create extension if not exists "pgcrypto";

create type reservation_status as enum ('pending', 'confirmed', 'paid', 'cancelled', 'completed');
create type conversation_status as enum ('active', 'archived', 'closed');

create table if not exists public.profiles (
  id uuid not null primary key references auth.users(id),
  full_name text not null,
  email text unique not null,
  rating_avg numeric default 5.0,
  created_at timestamptz default now()
);

create table if not exists public.listings (
  id uuid not null primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  price_per_hour numeric(10,2) not null,
  is_active boolean default true,
  photo_url text,
  created_at timestamptz default now()
);

create table if not exists public.reservations (
  id uuid not null primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  renter_id uuid not null references public.profiles(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  total_price numeric(10,2) not null,
  status reservation_status default 'pending',
  created_at timestamptz default now(),
  constraint reservations_check_times check (end_time > start_time)
);

create table if not exists public.conversations (
  id uuid not null primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete cascade,
  renter_id uuid not null references public.profiles(id),
  owner_id uuid not null references public.profiles(id),
  status conversation_status default 'active',
  last_message text,
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid not null primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null,
  sent_at timestamptz default now()
);

create index if not exists idx_listings_owner_id on public.listings(owner_id);
create index if not exists idx_reservations_listing_id on public.reservations(listing_id);
create index if not exists idx_reservations_renter_id on public.reservations(renter_id);
create index if not exists idx_conversations_reservation_id on public.conversations(reservation_id);
create index if not exists idx_conversations_renter_owner on public.conversations(renter_id, owner_id);
create index if not exists idx_messages_conversation_id on public.messages(conversation_id);

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.reservations enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Profiles: users can manage their own profile; basic public select for profiles (optional)
create policy "profiles_select_public" on public.profiles
  for select using (true);

create policy "profiles_manage_own" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Listings: public can view listings; owners can insert/update/delete their own listings
create policy "listings_public_select" on public.listings
  for select using (is_active = true);

create policy "listings_owner_insert" on public.listings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "listings_owner_update" on public.listings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "listings_owner_delete" on public.listings
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Reservations: renters and listing owners can view/create reservations
create policy "reservations_renter_insert" on public.reservations
  for insert to authenticated
  with check ((select auth.uid()) = renter_id);

create policy "reservations_parties_select" on public.reservations
  for select to authenticated
  using (
    renter_id = (select auth.uid())
    or
    listing_id in (select id from public.listings where owner_id = (select auth.uid()))
  );

create policy "reservations_update_status" on public.reservations
  for update to authenticated
  using (
    -- allow renter or listing owner to update (could be narrowed by column)
    renter_id = (select auth.uid())
    or listing_id in (select id from public.listings where owner_id = (select auth.uid()))
  )
  with check (
    renter_id = (select auth.uid())
    or listing_id in (select id from public.listings where owner_id = (select auth.uid()))
  );

-- Conversations: only participants of the conversation can select/insert/update/delete
create policy "conversations_participants_select" on public.conversations
  for select to authenticated
  using (
    renter_id = (select auth.uid()) or owner_id = (select auth.uid())
  );

create policy "conversations_participants_insert" on public.conversations
  for insert to authenticated
  with check (
    renter_id = (select auth.uid()) or owner_id = (select auth.uid())
  );

create policy "conversations_participants_update" on public.conversations
  for update to authenticated
  using (
    renter_id = (select auth.uid()) or owner_id = (select auth.uid())
  )
  with check (
    renter_id = (select auth.uid()) or owner_id = (select auth.uid())
  );

create policy "conversations_participants_delete" on public.conversations
  for delete to authenticated
  using (
    renter_id = (select auth.uid()) or owner_id = (select auth.uid())
  );

-- Messages: only conversation participants can insert/select messages
create policy "messages_conversation_participants_select" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
      and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
    )
  );

create policy "messages_conversation_participants_insert" on public.messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
      and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
    )
    and sender_id = (select auth.uid())
  );

create policy "messages_conversation_participants_update" on public.messages
  for update to authenticated
  using (
    sender_id = (select auth.uid())
  )
  with check (
    sender_id = (select auth.uid())
  );

create policy "messages_conversation_participants_delete" on public.messages
  for delete to authenticated
  using (
    sender_id = (select auth.uid())
  );

-- Trigger: Handle new user profile creation automatically
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id, 
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'), 
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable PostGIS extension for spatial math
create extension if not exists postgis;

-- Add the 'location' column to listings
alter table public.listings 
add column if not exists location geography(Point, 4326);

-- Populate 'location' from your existing lat/long data
update public.listings 
set location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography;

-- Create the Spatial Index (High-speed searching)
create index if not exists idx_listings_location on public.listings using gist(location);

create or replace function get_nearby_listings(
  user_lat double precision, 
  user_long double precision, 
  max_meters float default 16093.4 -- 10 miles
)
returns setof public.listings 
language plpgsql
security definer 
as $$
begin
  return query
  select *
  from public.listings
  where is_active = true
  and ST_DWithin(
    location, 
    ST_SetSRID(ST_MakePoint(user_long, user_lat), 4326)::geography, 
    max_meters
  )
  order by location <-> ST_SetSRID(ST_MakePoint(user_long, user_lat), 4326)::geography;
end;
$$;
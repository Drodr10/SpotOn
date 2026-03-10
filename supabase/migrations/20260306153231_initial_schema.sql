create type "public"."conversation_status" as enum ('active', 'archived', 'closed');

create type "public"."reservation_status" as enum ('pending', 'confirmed', 'paid', 'cancelled', 'completed');


  create table "public"."conversations" (
    "id" uuid not null default gen_random_uuid(),
    "reservation_id" uuid,
    "renter_id" uuid not null,
    "owner_id" uuid not null,
    "status" public.conversation_status default 'active'::public.conversation_status,
    "last_message" text,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."conversations" enable row level security;


  create table "public"."listings" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "address" text not null,
    "latitude" double precision not null,
    "longitude" double precision not null,
    "price_per_hour" numeric(10,2) not null,
    "is_active" boolean default true,
    "photo_url" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."listings" enable row level security;


  create table "public"."messages" (
    "id" uuid not null default gen_random_uuid(),
    "conversation_id" uuid not null,
    "sender_id" uuid not null,
    "content" text not null,
    "sent_at" timestamp with time zone default now()
      );


alter table "public"."messages" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "full_name" text not null,
    "email" text not null,
    "rating_avg" numeric default 5.0,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."profiles" enable row level security;


  create table "public"."reservations" (
    "id" uuid not null default gen_random_uuid(),
    "listing_id" uuid not null,
    "renter_id" uuid not null,
    "start_time" timestamp with time zone not null,
    "end_time" timestamp with time zone not null,
    "total_price" numeric(10,2) not null,
    "status" public.reservation_status default 'pending'::public.reservation_status,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."reservations" enable row level security;

CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id);

CREATE INDEX idx_conversations_renter_owner ON public.conversations USING btree (renter_id, owner_id);

CREATE INDEX idx_conversations_reservation_id ON public.conversations USING btree (reservation_id);

CREATE INDEX idx_listings_owner_id ON public.listings USING btree (owner_id);

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);

CREATE INDEX idx_reservations_listing_id ON public.reservations USING btree (listing_id);

CREATE INDEX idx_reservations_renter_id ON public.reservations USING btree (renter_id);

CREATE UNIQUE INDEX listings_pkey ON public.listings USING btree (id);

CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id);

CREATE UNIQUE INDEX profiles_email_key ON public.profiles USING btree (email);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX reservations_pkey ON public.reservations USING btree (id);

alter table "public"."conversations" add constraint "conversations_pkey" PRIMARY KEY using index "conversations_pkey";

alter table "public"."listings" add constraint "listings_pkey" PRIMARY KEY using index "listings_pkey";

alter table "public"."messages" add constraint "messages_pkey" PRIMARY KEY using index "messages_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."reservations" add constraint "reservations_pkey" PRIMARY KEY using index "reservations_pkey";

alter table "public"."conversations" add constraint "conversations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.profiles(id) not valid;

alter table "public"."conversations" validate constraint "conversations_owner_id_fkey";

alter table "public"."conversations" add constraint "conversations_renter_id_fkey" FOREIGN KEY (renter_id) REFERENCES public.profiles(id) not valid;

alter table "public"."conversations" validate constraint "conversations_renter_id_fkey";

alter table "public"."conversations" add constraint "conversations_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE not valid;

alter table "public"."conversations" validate constraint "conversations_reservation_id_fkey";

alter table "public"."listings" add constraint "listings_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."listings" validate constraint "listings_owner_id_fkey";

alter table "public"."messages" add constraint "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."messages" validate constraint "messages_conversation_id_fkey";

alter table "public"."messages" add constraint "messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES public.profiles(id) not valid;

alter table "public"."messages" validate constraint "messages_sender_id_fkey";

alter table "public"."profiles" add constraint "profiles_email_key" UNIQUE using index "profiles_email_key";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."reservations" add constraint "reservations_check_times" CHECK ((end_time > start_time)) not valid;

alter table "public"."reservations" validate constraint "reservations_check_times";

alter table "public"."reservations" add constraint "reservations_listing_id_fkey" FOREIGN KEY (listing_id) REFERENCES public.listings(id) not valid;

alter table "public"."reservations" validate constraint "reservations_listing_id_fkey";

alter table "public"."reservations" add constraint "reservations_renter_id_fkey" FOREIGN KEY (renter_id) REFERENCES public.profiles(id) not valid;

alter table "public"."reservations" validate constraint "reservations_renter_id_fkey";

grant delete on table "public"."conversations" to "anon";

grant insert on table "public"."conversations" to "anon";

grant references on table "public"."conversations" to "anon";

grant select on table "public"."conversations" to "anon";

grant trigger on table "public"."conversations" to "anon";

grant truncate on table "public"."conversations" to "anon";

grant update on table "public"."conversations" to "anon";

grant delete on table "public"."conversations" to "authenticated";

grant insert on table "public"."conversations" to "authenticated";

grant references on table "public"."conversations" to "authenticated";

grant select on table "public"."conversations" to "authenticated";

grant trigger on table "public"."conversations" to "authenticated";

grant truncate on table "public"."conversations" to "authenticated";

grant update on table "public"."conversations" to "authenticated";

grant delete on table "public"."conversations" to "service_role";

grant insert on table "public"."conversations" to "service_role";

grant references on table "public"."conversations" to "service_role";

grant select on table "public"."conversations" to "service_role";

grant trigger on table "public"."conversations" to "service_role";

grant truncate on table "public"."conversations" to "service_role";

grant update on table "public"."conversations" to "service_role";

grant delete on table "public"."listings" to "anon";

grant insert on table "public"."listings" to "anon";

grant references on table "public"."listings" to "anon";

grant select on table "public"."listings" to "anon";

grant trigger on table "public"."listings" to "anon";

grant truncate on table "public"."listings" to "anon";

grant update on table "public"."listings" to "anon";

grant delete on table "public"."listings" to "authenticated";

grant insert on table "public"."listings" to "authenticated";

grant references on table "public"."listings" to "authenticated";

grant select on table "public"."listings" to "authenticated";

grant trigger on table "public"."listings" to "authenticated";

grant truncate on table "public"."listings" to "authenticated";

grant update on table "public"."listings" to "authenticated";

grant delete on table "public"."listings" to "service_role";

grant insert on table "public"."listings" to "service_role";

grant references on table "public"."listings" to "service_role";

grant select on table "public"."listings" to "service_role";

grant trigger on table "public"."listings" to "service_role";

grant truncate on table "public"."listings" to "service_role";

grant update on table "public"."listings" to "service_role";

grant delete on table "public"."messages" to "anon";

grant insert on table "public"."messages" to "anon";

grant references on table "public"."messages" to "anon";

grant select on table "public"."messages" to "anon";

grant trigger on table "public"."messages" to "anon";

grant truncate on table "public"."messages" to "anon";

grant update on table "public"."messages" to "anon";

grant delete on table "public"."messages" to "authenticated";

grant insert on table "public"."messages" to "authenticated";

grant references on table "public"."messages" to "authenticated";

grant select on table "public"."messages" to "authenticated";

grant trigger on table "public"."messages" to "authenticated";

grant truncate on table "public"."messages" to "authenticated";

grant update on table "public"."messages" to "authenticated";

grant delete on table "public"."messages" to "service_role";

grant insert on table "public"."messages" to "service_role";

grant references on table "public"."messages" to "service_role";

grant select on table "public"."messages" to "service_role";

grant trigger on table "public"."messages" to "service_role";

grant truncate on table "public"."messages" to "service_role";

grant update on table "public"."messages" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."reservations" to "anon";

grant insert on table "public"."reservations" to "anon";

grant references on table "public"."reservations" to "anon";

grant select on table "public"."reservations" to "anon";

grant trigger on table "public"."reservations" to "anon";

grant truncate on table "public"."reservations" to "anon";

grant update on table "public"."reservations" to "anon";

grant delete on table "public"."reservations" to "authenticated";

grant insert on table "public"."reservations" to "authenticated";

grant references on table "public"."reservations" to "authenticated";

grant select on table "public"."reservations" to "authenticated";

grant trigger on table "public"."reservations" to "authenticated";

grant truncate on table "public"."reservations" to "authenticated";

grant update on table "public"."reservations" to "authenticated";

grant delete on table "public"."reservations" to "service_role";

grant insert on table "public"."reservations" to "service_role";

grant references on table "public"."reservations" to "service_role";

grant select on table "public"."reservations" to "service_role";

grant trigger on table "public"."reservations" to "service_role";

grant truncate on table "public"."reservations" to "service_role";

grant update on table "public"."reservations" to "service_role";


  create policy "conversations_participants_delete"
  on "public"."conversations"
  as permissive
  for delete
  to authenticated
using (((renter_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))));



  create policy "conversations_participants_insert"
  on "public"."conversations"
  as permissive
  for insert
  to authenticated
with check (((renter_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))));



  create policy "conversations_participants_select"
  on "public"."conversations"
  as permissive
  for select
  to authenticated
using (((renter_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))));



  create policy "conversations_participants_update"
  on "public"."conversations"
  as permissive
  for update
  to authenticated
using (((renter_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))))
with check (((renter_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))));



  create policy "listings_owner_delete"
  on "public"."listings"
  as permissive
  for delete
  to authenticated
using ((( SELECT auth.uid() AS uid) = owner_id));



  create policy "listings_owner_insert"
  on "public"."listings"
  as permissive
  for insert
  to authenticated
with check ((( SELECT auth.uid() AS uid) = owner_id));



  create policy "listings_owner_update"
  on "public"."listings"
  as permissive
  for update
  to authenticated
using ((( SELECT auth.uid() AS uid) = owner_id))
with check ((( SELECT auth.uid() AS uid) = owner_id));



  create policy "listings_public_select"
  on "public"."listings"
  as permissive
  for select
  to public
using ((is_active = true));



  create policy "messages_conversation_participants_delete"
  on "public"."messages"
  as permissive
  for delete
  to authenticated
using ((sender_id = ( SELECT auth.uid() AS uid)));



  create policy "messages_conversation_participants_insert"
  on "public"."messages"
  as permissive
  for insert
  to authenticated
with check (((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND ((c.renter_id = ( SELECT auth.uid() AS uid)) OR (c.owner_id = ( SELECT auth.uid() AS uid)))))) AND (sender_id = ( SELECT auth.uid() AS uid))));



  create policy "messages_conversation_participants_select"
  on "public"."messages"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND ((c.renter_id = ( SELECT auth.uid() AS uid)) OR (c.owner_id = ( SELECT auth.uid() AS uid)))))));



  create policy "messages_conversation_participants_update"
  on "public"."messages"
  as permissive
  for update
  to authenticated
using ((sender_id = ( SELECT auth.uid() AS uid)))
with check ((sender_id = ( SELECT auth.uid() AS uid)));



  create policy "profiles_manage_own"
  on "public"."profiles"
  as permissive
  for all
  to authenticated
using ((( SELECT auth.uid() AS uid) = id))
with check ((( SELECT auth.uid() AS uid) = id));



  create policy "profiles_select_public"
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);



  create policy "reservations_parties_select"
  on "public"."reservations"
  as permissive
  for select
  to authenticated
using (((renter_id = ( SELECT auth.uid() AS uid)) OR (listing_id IN ( SELECT listings.id
   FROM public.listings
  WHERE (listings.owner_id = ( SELECT auth.uid() AS uid))))));



  create policy "reservations_renter_insert"
  on "public"."reservations"
  as permissive
  for insert
  to authenticated
with check ((( SELECT auth.uid() AS uid) = renter_id));



  create policy "reservations_update_status"
  on "public"."reservations"
  as permissive
  for update
  to authenticated
using (((renter_id = ( SELECT auth.uid() AS uid)) OR (listing_id IN ( SELECT listings.id
   FROM public.listings
  WHERE (listings.owner_id = ( SELECT auth.uid() AS uid))))))
with check (((renter_id = ( SELECT auth.uid() AS uid)) OR (listing_id IN ( SELECT listings.id
   FROM public.listings
  WHERE (listings.owner_id = ( SELECT auth.uid() AS uid))))));




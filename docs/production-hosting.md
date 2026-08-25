# Getting the backend off ngrok and into production

Written 2026-08-25. Recommendation plus the exact strings to paste.

## What you actually need

The Flask backend has to be publicly reachable over HTTPS at a **stable**
hostname before the app can ship, for four independent reasons:

1. **Stripe webhooks** post to it (`payment_intent.succeeded` is the reliable
   backstop that creates reservations).
2. **Stripe Connect onboarding** redirects a real browser back to it —
   `/api/stripe/onboarding-complete` serves the deep-link bounce page.
3. **The app itself** calls it for pricing, booking, and payouts.
4. **The sweeps** need something to trigger them on a schedule.

ngrok fails #1–#3 in a shipped build because the hostname rotates. Expo's dev
server is not involved at all — it only serves JS to a development client.

## Recommendation: Render

Render is the best fit here, in order of why:

- **Native Python.** It reads `requirements.txt` and `.python-version` (both
  already present, and `gunicorn` is already a dependency). No Dockerfile.
- **Cron Jobs are a first-class service type**, which is exactly what the sweeps
  need — see below.
- **Auto-deploy from GitHub `main`**, matching how the team already works.
- Secrets live in a dashboard env-var store, never in the repo.

Roughly $7/month for the smallest always-on instance, plus a little for cron —
check current pricing, it moves. **Do not use the free tier**: it spins down
after inactivity, and a renter finalizing a booking would hit a ~30s cold start.

Alternatives, briefly: **Railway** is equally easy with usage-based billing.
**Fly.io** is cheaper at scale but wants a Dockerfile. **Cloud Run** is the
cheapest at low traffic but adds Docker, IAM, and Cloud Scheduler — more moving
parts than this team needs right now. Any of them works; Render is the least
setup for the same result.

## Pick the right service TYPE: Web Service

Render's Compute section has tabs for **Web Services**, **Private Services** and
**Background Workers**, at identical prices. The names mislead — pick
**Web Service**.

- **Web Service** = any HTTP service that gets a **public URL**. A JSON REST API
  qualifies; it has nothing to do with serving HTML pages.
- **Private Service** = reachable **only from inside your own Render private
  network**. No public address at all.
- **Background Worker** = no HTTP listener whatsoever.

The Flask backend must be publicly reachable for three independent reasons, all
of which a Private Service breaks:

1. Stripe posts webhooks to it from the public internet.
2. Stripe Connect onboarding redirects a real browser to
   `/api/stripe/onboarding-complete`.
3. The mobile app calls it from users' phones, which are not on your network.

Chosen wrong, it deploys fine, gets no public URL, and nothing can reach it.

## Web service settings

| field | value |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --workers 2 --timeout 60` |

`app:app` resolves because `backend/app.py` defines `app = Flask(__name__)`.
Never run `python app.py` in production — that starts the Werkzeug dev server
with `debug=True`.

## Environment variables

Copy from `backend/.env`, with one addition and one change:

```
SUPABASE_URL=            # same
SUPABASE_KEY=            # same — this is the SERVICE_ROLE key, see warning below
STRIPE_PUBLISHABLE_KEY=  # LIVE key when you go live
STRIPE_SECRET_KEY=       # LIVE key when you go live
STRIPE_WEBHOOK_SECRET=   # NEW value — regenerated per endpoint, see below
BACKEND_URL=https://<your-render-domain>
SWEEP_SECRET=            # same
ENABLE_SWEEP_SCHEDULER=false      # <<< MUST be set, see below
SWEEP_INTERVAL_SECONDS=           # ignored once the scheduler is off
```

### `ENABLE_SWEEP_SCHEDULER=false` is not optional

`backend/app.py:49` defaults this to `"true"`, and its other guard
(`WERKZEUG_RUN_MAIN != "false"`) is *satisfied* under gunicorn because that
variable is unset. So with `--workers 2` you get **two BackgroundScheduler
instances running the payout sweep concurrently, against real Stripe
transfers.** Set it to `false` on the first deploy, not as a follow-up.

The right production shape already exists in the code: both sweeps are exposed
as secret-gated, idempotent HTTP endpoints. Use those instead.

## Cron jobs

Two Render Cron Jobs. Note the `/api` prefix — every blueprint is registered
with `url_prefix='/api'`, so these paths are **not** `/stripe/...`:

```bash
# payout sweep — every 10 minutes
curl -fsS -X POST https://<domain>/api/stripe/run-payout-sweep \
  -H "X-Sweep-Secret: $SWEEP_SECRET"

# notification sweep — every 10 minutes
curl -fsS -X POST https://<domain>/api/stripe/run-notification-sweep \
  -H "X-Sweep-Secret: $SWEEP_SECRET"
```

Both return 401 without the header, so a wrong secret fails loudly.

## Stripe dashboard

Add a webhook endpoint pointing at:

```
https://<domain>/api/stripe/webhook
```

Again, `/api/stripe/webhook` — **not** `/stripe/webhook`. A wrong path here
fails *silently*: Stripe records delivery attempts, the app looks fine, and
reservations only ever get created by the client-side finalize call, so the
webhook backstop is quietly gone.

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. It is generated
per endpoint — it is not the same value as your local `stripe listen` secret.

## Frontend

Set `EXPO_PUBLIC_IP` to the **bare hostname** — no scheme, no `/api`:

```
EXPO_PUBLIC_IP=spoton-api.onrender.com
```

That is all the app needs. Every call site already builds
`https://${EXPO_PUBLIC_IP}/api/...`, verified across `api.ts`,
`usePricingPreview.ts` and `stripe.ts` — so pointing at production is an env-var
change with no code change.

**EAS does not upload `.env` files.** Set this (and the Supabase vars, and
`GOOGLE_MAPS_ANDROID_API_KEY`) as EAS environment variables, or the build ships
with them undefined.

## Going live on Stripe

Short answer: yes — you flip the dashboard to live mode and Stripe hands you a
separate set of everything. But "separate" goes further than just the keys:

- **API keys.** `pk_live_` / `sk_live_` instead of `pk_test_` / `sk_test_`.
  Straightforward swap in the Render env vars.
- **Webhook endpoints are configured per mode.** The endpoint you create in test
  mode does not exist in live mode. You add it again while in live mode, and it
  gets a **different signing secret** — so `STRIPE_WEBHOOK_SECRET` changes too.
- **Connect accounts are per mode.** Every seller who onboarded in test has to
  onboard again in live. This one is a *data* task, not config:
  `profiles.stripe_account_id` currently holds test-mode ids, and
  `create_connect_account` returns early when that column is already set
  (`stripe_client.py:331`), so those rows must be cleared at cutover or the
  seller silently gets handed a dead test account id.

**Start the account activation now — it is the item with lead time.** Live mode
requires the platform's own Stripe account to be fully activated: business
details, bank account, tax info, and a review by Stripe that can take days. It
is the one step that cannot be done on launch day.

## What this actually costs

Read off the rendered pricing page on 2026-08-25, not from memory. Render bills
**two separate line items** — a workspace plan, and compute per service. Every
workspace tier is quoted as "+ compute".

**Workspace plans:**

| plan | price | included |
|---|---|---|
| Hobby | **$0/mo** + compute | 25 services, 5 GB bandwidth, custom domains |
| Pro | $25/mo + compute | unlimited seats/services, 25 GB bandwidth |
| Scale | $499/mo + compute | 1 TB bandwidth, HIPAA, SSO |

**Web service compute** — this table is **collapsed behind a "Show Pricing"
accordion** in the *Services* row of the Compute section, which is why it is easy
to miss on the page:

| instance | price | RAM | CPU |
|---|---|---|---|
| Free | $0/mo | 512 MB | 0.1 |
| **Starter** | **$7/mo** | 512 MB | 0.5 |
| Standard | $25/mo | 2 GB | 1 |
| Pro | $85/mo | 4 GB | 2 |

**Cron jobs:** from $1/mo, Starter billed at $0.00016/minute, prorated by the
second. Two sweeps at 10-minute intervals are pennies of actual compute, so
expect the ~$1 floor.

### The realistic bill

**Hobby workspace ($0) + one Starter web service ($7) + two cron jobs (~$1)
= about $8/month.** The $25 figure is the *Pro workspace*, which this project
does not need yet — its wins are unlimited seats, 25 GB bandwidth and audit
logs, none of which bind at launch scale.

Since every tier including Hobby is priced "$X/mo **+ compute**", paid instance
types are billed on top of a free workspace. Confirm at checkout, but that is
what the page states.

The constraint to watch on Hobby is **5 GB/month outbound bandwidth**. Listing
images are served by Supabase Storage rather than through Flask, so this is JSON
traffic only and 5 GB goes a long way — but it is the first limit likely to bind.

### Why not the Free instance

Two reasons, both confirmed:

- It has **0.1 CPU** against Starter's 0.5 — five times less, for a Flask app
  doing synchronous Stripe and Supabase calls.
- It **spins down after 15 minutes without inbound traffic**, and waking it
  "takes about one minute" (Render's own docs). A renter tapping *Book* after a
  quiet spell waits a minute; a Stripe webhook hits a cold service. Stripe
  retries so the booking survives, but the experience does not.

### Already covered

Apple Developer Program and Google Play are **already paid**, so they are not
part of this decision. Supabase and EAS stay on free tiers to start.

## Two smaller things

**The repo is public and `SUPABASE_KEY` is a service_role key** — full database
access, bypassing RLS. Checked: `backend/.env` and `frontend/.env` have never
been committed on any branch and are gitignored, so nothing needs rotating
today. Keep it that way; the key belongs only in Render's env store.

**Consider adding a trivial `/api/health` route.** There is none, so Render has
no health-check path to point at, and "is it up?" currently means "try a real
endpoint". Ten lines, makes every future incident easier.

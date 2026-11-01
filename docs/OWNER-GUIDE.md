# ASH AI owner guide

## On this computer

1. Double-click `Start-ASH-AI.bat`.
2. A browser window opens at http://127.0.0.1:3035
3. Create an account with your email, a long password, and the **private access code** from `.env.local` (`ASH_PLATFORM_INVITE_CODE`, or the bootstrap key if they are the same).
4. Sign in. Chat, projects, files and memory stay on this computer.

You do not need to start two terminals.

## On your Android phone (same Wi-Fi)

There is no Android Studio on this PC, so a Play Store app / APK cannot be built here yet.

Use the installable website instead:

1. Keep ASH AI running on the PC.
2. Create a private HTTPS certificate for this PC’s Wi-Fi address (see `scripts/lan-https-proxy.mjs` comments / previous mobile notes).
3. Run `npm.cmd run lan-https`.
4. On the phone, open `https://YOUR-WIFI-IP:3443`, sign in with the **same email and password**, then use Chrome’s **Add to Home screen**.

Same account, same conversations. This is not mobile-data / public internet access.

## Cloud website

The website and API will run on **one Render service**. Files and accounts will live in **Supabase** (Paris). This PC still uses its own local database until you deploy.

Before Render can start, the three SQL files in `supabase/migrations` must be run in the Supabase SQL editor (or `npm.cmd run apply:supabase` with `DATABASE_URL` set). That has not been done from this computer yet because the database password is only in your Supabase dashboard.

Free Render apps sleep; the first visit after a pause can take about 50 seconds.

Never put database or AI keys in the phone or browser.

## Secrets

Never share `.env.local`. Cloud provider keys stay on the server, not in the phone app.

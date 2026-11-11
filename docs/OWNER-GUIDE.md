# ASH AI owner guide

## On this computer

1. Double-click `Start-ASH-AI.bat`.
2. A browser window opens at http://127.0.0.1:3035
3. Create an account with your email and a password of at least 12 characters. The first account on a new database is the owner. Later signups are ordinary users. Owner is a label only. It does not grant access to other people's chats or files. If `ASH_PLATFORM_INVITE_CODE` is set, registration asks for it. Login does not.
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

The website and API already run as **one Render service**. Hosted accounts use Supabase Postgres. Hosted files use the private Supabase bucket. This PC still uses its own SQLite database. A local backup is not a copy of hosted accounts.

New hosted registration requires the invite code already set on Render. Existing accounts sign in with email and password only. Do not put that code in Git, the frontend, or this guide.

Free Render apps sleep; the first visit after a pause can take about 50 seconds.

Team preview on a phone uses the hosted HTTPS site in Chrome, then **Add to Home screen**. There is no shared team workspace. Each account sees only its own chats, projects, memories, and files.

Never put database or AI keys in the phone or browser.

## Secrets

Never share `.env.local`. Cloud provider keys stay on the server, not in the phone app.

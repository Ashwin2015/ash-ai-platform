# Roadmap

## Now

ASH Chat stays the product. ASH AI Core 1.0.0 is the reusable library inside the same repository. New products copy a version. They do not import the live chat UI.

## Before the freeze

- One physical Android install, camera, PDF, keyboard, and offline check.
- One restore of a local SQLite snapshot into an empty folder, not over the live file.
- A hosted backup confirmed in the Supabase dashboard, without changing data.
- A small invited group using separate accounts.

Do not tag a release or write the final freeze report until those are done.

## Later, not part of this foundation

Conversation summarisation, a model tool-calling loop, general web crawl, voice-only offline mode, an APK, MFA, team roles, usage billing, and email password reset.

Other products (IDE, Crop Doctor, thesis, browser, music) get their own repositories when work starts. They link a core version. They do not wait for more ASH Chat features.

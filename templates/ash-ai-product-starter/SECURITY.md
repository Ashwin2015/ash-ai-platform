# Security checklist

- Keep API keys in `.env.local` or the host's secret store. Do not commit them.
- Do not send provider keys to the browser.
- Register a provider only when its key is present.
- Leave paid models out of automatic selection.
- Give each product its own database. Do not point two products at one production database.
- Scope stored rows and files by user.
- Treat uploaded text and web snippets as untrusted data.
- Do not cache private conversations or tokens in a service worker.
- Rate-limit authentication and chat in the application process.
- Back up that product's own data. A core export is source code, not a database backup.

# Workspace guide

The proposed layout is a folder you choose, for example `D:\ASH-WORKSPACE`. This repository is not moved.

```text
ASH-WORKSPACE/
  ASH-CORE/ash-ai-core-1.0.0/    pinned export created by init
  PRODUCTS/<name>/               one product per folder
  TEMPLATES/                     reserved for starters you copy by hand
  BACKUPS/                       project copies from the backup command
  registry.json                  names, paths, ports, core version
```

## Commands

Run from `ASH-AI-PLATFORM`:

```powershell
node scripts/ash-workspace.mjs init D:\ASH-WORKSPACE
node scripts/ash-workspace.mjs register D:\ASH-WORKSPACE ash-chat "C:\Users\Ashwin2014\Desktop\IDE Testing\ASH AI\ASH-AI-PLATFORM" 3035
node scripts/ash-workspace.mjs new D:\ASH-WORKSPACE my-product 3041
node scripts/ash-workspace.mjs link-core D:\ASH-WORKSPACE my-product
node scripts/ash-workspace.mjs check D:\ASH-WORKSPACE
node scripts/ash-workspace.mjs list D:\ASH-WORKSPACE
node scripts/ash-workspace.mjs backup D:\ASH-WORKSPACE my-product
```

`register` records an existing folder. It does not copy or relocate it. `new` copies `templates/ash-ai-product-starter` only.

`backup` copies one registered project into `BACKUPS`. It skips `node_modules`, `.git`, `.data`, `.env`, and `.env.local`. It keeps `.env.example`. The copy is not a restore test by itself.

## Independence

Give each product its own port, `.env.local`, Git repository, and database. `init` does not create those Git repositories. Create them when you are ready, inside that product folder. Never reuse the ASH Chat production database URL.

ASH IDE, Crop Doctor, Music Player, and Browser were not created or modified by these scripts.

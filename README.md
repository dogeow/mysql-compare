# MySQL Compare

A lightweight desktop MySQL client (Electron + React + TypeScript) inspired by Navicat / DBeaver. Focused on **MySQL only**, with first-class **SSH tunnel**, browse / edit, and **schema diff & sync**.

## Architecture

```
Renderer (React + Tailwind + zustand)
     │  window.api  (contextBridge, type-safe)
     ▼
Preload  (the only place using ipcRenderer)
     │  ipcMain.handle
     ▼
Main process
     ├─ ipc/         channel routing
     ├─ services/    connection / mysql / ssh / schema / diff / sync
     └─ store/       electron-store + safeStorage encryption
```

The renderer NEVER touches MySQL or SSH directly — every DB action is an IPC call.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run dist          # current OS
npm run dist:mac      # mac dmg
npm run dist:win      # win nsis
```

## Phase 1 (MVP, done)
- Connection CRUD with secure password storage (Electron `safeStorage`)
- Local MySQL + SSH tunnel (random local port, managed by `ssh-service`)
- DB / table tree, table search, table data with paging / where / sort
- Row insert / edit / delete (PK-based), batch delete with confirmation
- Table structure (columns / indexes / `CREATE TABLE`)
- Schema diff between two databases (any two connections)
- Sync plan preview + execute with progress log + multiple existing-table strategies

## Phase 2 (planned)
- Row-level data diff with primary key based pairing
- Foreign-key aware sync ordering
- SQL editor tab (Monaco) and query result tab
- Export (CSV / JSON / SQL dump) and import
- Saved query history
- More auth methods (SSH agent, jump host)

## Security Notes
- Passwords / keys are encrypted via OS keychain (`safeStorage`); only ciphertext is persisted.
- Renderer cannot read decrypted secrets — only `hasPassword` flags are exposed.
- All identifiers are whitelist-validated before being interpolated into SQL.
- Destructive sync strategies require explicit user selection + a confirmation dialog.

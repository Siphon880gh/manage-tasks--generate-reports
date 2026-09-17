# LedgerLane test users

Use these local accounts when exercising the Board, Reports, and role gates. They live only in this browser’s IndexedDB (`ledgerlane-db`). There is no shared server roster.

Create each account once with **Create account**, using the exact display name, username, passphrase, and account type below. After that, **Sign in**.

| Display name | Username | Passphrase | Account type |
| --- | --- | --- | --- |
| Admin User | `admin` | `admin-passphrase` | Admin |
| Morgan Lee (Demo User) | `morgan` | `local-demo-passphrase` | Editor |
| Viewer User | `viewer` | `viewer-passphrase` | View only |

## What each account is for

### Admin User

Full edit access. Use this to own the workspace: create projects, import and export, record the screen, and delete tasks. The header shows **Admin**.

### Morgan Lee

Standard editor. Same mutations as Admin, labeled **Editor**. Automated browser checks create a Morgan Lee account with a unique username so they do not collide with this documented one.

### Viewer User

Read-only. Can open Board and Reports, change report lenses, and **Copy for Notion**. Cannot create, edit, move, import, delete, or record. The header shows **View only**.

## Notes

- Passphrases are hashed with SHA-256 before storage. They are not sent anywhere.
- View-only signups do not seed demo tasks. Admin and Editor seed six demo tasks only when the workspace has none.
- If you already created Viewer User under another username (for example `riley-live`), that account still works. The table above is the canonical set going forward.
- Clearing site data deletes these accounts.

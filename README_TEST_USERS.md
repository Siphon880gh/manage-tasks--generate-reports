# LedgerLane test users

Use these local accounts when exercising the Board, Reports, and role gates. They live only in this browser’s IndexedDB (`ledgerlane-db`). There is no shared server roster.

Create each account once with **Create account**, using the exact display name, username, passphrase, and account type below. After that, **Sign in**. The first account on a device becomes the board admin. Later accounts wait under **People → Invite someone** until an admin invites them.

| Display name | Username | Passphrase | Account type |
| --- | --- | --- | --- |
| Admin User | `admin` | `admin-passphrase` | Admin |
| Morgan Lee (Demo User) | `morgan` | `local-demo-passphrase` | Editor |
| Viewer User | `viewer` | `viewer-passphrase` | View only |

## What each account is for

### Admin User

Invite this account to the board as **Admin** to manage people and edit work.

### Morgan Lee

If this is the first account on the device, it becomes the board admin even when signed up as Editor. Automated browser checks create a Morgan Lee account with a unique username so they do not collide with this documented one.

### Viewer User

Invite this account as **View only**. They can open Board, Reports, People, and **Copy for Notion**. They cannot create, edit, invite, or record.

## Notes

- Passphrases are hashed with SHA-256 before storage. They are not sent anywhere.
- View-only signups do not seed demo tasks. Admin and Editor seed six demo tasks only when the workspace has none.
- If you already created Viewer User under another username (for example `riley-live`), that account still works. The table above is the canonical set going forward.
- Clearing site data deletes these accounts.

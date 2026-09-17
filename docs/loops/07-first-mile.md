# Loop 07 — First mile

Jordan should know what to type, who to ask, and how to leave.

## Prompt

```
Drain LedgerLane auth, waiting, and the avatar.

Sign in: username, passphrase, submit. Do not explain first-admin on Welcome back.
Create account: name, username, passphrase, submit. Account type is a closed <details>, default Editor.
Waiting: one sentence, admin names (naturalJoin), a visible Sign out button. Do not point at People as if the waiter can open it.
Avatar: open an Account menu that names the person and offers Sign out. Confirm still uses askConfirm. aria-label is “Account menu”, not “Sign out”.

Keep passphrase wording. Keep test radio ids #role-editor, #role-admin, #role-viewer.
Update tests/verify-features.mjs signOut() to open the menu, then #sign-out-button, then confirm.
```

## Verify

- `#account-type-options` exists on signup and starts closed.
- `#account-button` does not open the confirm dialog by itself.
- Waiting copy includes an admin’s display name and `#waiting-sign-out`.
- Existing invite / role checks still pass.

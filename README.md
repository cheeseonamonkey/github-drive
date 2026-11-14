# RepoDrive

Mobile-first, browser-encrypted file storage hosted on GitHub Pages. This repository is a reusable [GitHub template](https://github.com/cheeseonamonkey/github-drive). Each copy has its own vault, Git history, and optional storage configuration.

**The website and repository can be public. The vault's contents and filenames remain encrypted.** The only exception is the deliberately unencrypted **Public files** folder.

## Getting started

1. Click **Use this template → Create a new repository**. A public repository works: encryption happens in the browser. If you prefer a private repository, Pages availability depends on your GitHub plan.
2. In the new repository, enable **Settings → Pages → Source: GitHub Actions**, then run the included **Pages** workflow. Open `https://YOURNAME.github.io/YOUR-REPO/` (replace the placeholders).
3. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with **Contents: Read and write** for **only the newly created repository**. Do not put it in Pages variables, source code, or GitHub Secrets. Enter it in the site's login form. The repository name is prefilled when built with the included workflow.
4. On the first visit, create a unique vault password (at least 14 characters), confirm it, and acknowledge the recovery/Git-history warning. The app generates a random salt and encrypts the initial empty index.
5. Upload files to the encrypted area. **Public files** is a deliberately unencrypted folder; uploading there requires an explicit confirmation.
6. On later visits, reconnect and unlock with the same vault password. Your browser or password manager may offer to save and autofill it. The app never stores the password or key in localStorage or the repository. Refreshing or disconnecting discards the live key and GitHub token.

**Git is persistent.** Deleted files can remain in Git history, forks, and backups. Do not upload sensitive files to **Public files**, even temporarily. Losing the vault password permanently loses access—there is no reset or escrow.

## Encryption architecture

- **Argon2id** derives a non-exportable AES-256-GCM key from the password and a random 128-bit salt (32 MiB memory, 3 iterations, parallelism 1).
- `.vault/state.json` holds public cryptographic parameters and an **authenticated, encrypted filesystem index** containing all private paths, filenames, file sizes, and opaque block references.
- Private files use individually authenticated AES-256-GCM blocks, with a fresh 96-bit nonce and block-specific authenticated context.
- Without R2, up to 10 MiB is stored in 1 MiB encrypted Git blocks under `.vault/blocks/`.
- With the optional R2 Worker, files up to 50 GiB use 8 MiB encrypted R2 blocks. **GitHub receives only the encrypted index**, not the block contents.
- The password and AES key are never sent to GitHub or the Worker. Changing a private file does not rewrite unrelated files.
- File uploads and folder edits require GitHub authorization. The password alone can decrypt data but cannot modify the repository.

**This is browser-side encryption, not a server-side permission system.** Anyone can inspect the public ciphertext and source code. GitHub can observe activity, commit times, approximate ciphertext sizes, and the number of blocks. Password strength matters: an attacker can try guessing the password offline against the public index. Encryption does not prevent rollback to an older valid encrypted snapshot.

## Optional large-file storage (Cloudflare R2)

**The Worker is implemented but not deployed or enabled by default.** The 10 MiB Git-backed path works without Cloudflare. Large-file storage requires your own Cloudflare account and private R2 bucket. The public [Cloudflare setup guide](https://developers.cloudflare.com/r2/get-started/cli/) covers prerequisites.

1. In a trusted terminal, authenticate to Cloudflare and create a private bucket:
   ```sh
   npx wrangler login
   npx wrangler r2 bucket create repodrive-blocks
   ```
2. In `storage-worker/`, copy `wrangler.example.jsonc` to `wrangler.jsonc`. Adjust bucket name, GitHub owner, and the exact Pages site URL if needed. The local config file is gitignored.
3. From `storage-worker/`, deploy and configure a **random Worker session-signing secret** (32+ characters):
   ```sh
   npx wrangler deploy
   npx wrangler secret put SESSION_SECRET
   ```
   Keep the R2 bucket private. Do not commit or print the secret.
4. In your new GitHub repository → Settings → Secrets and variables → Actions → **Variables**, set `VITE_BLOCK_WORKER_URL` to the deployed Worker's HTTPS URL, **including a trailing slash**. This is a public endpoint, not a secret.
5. Re-run the Pages workflow. Once the new frontend is deployed, uploads inside the encrypted drive use R2. `Public files` still uses GitHub's 10 MiB path.

### Transfer behavior

- Uploads are sequential and use at most one **8 MiB plaintext slice** at a time, plus encryption/network buffers.
- After every chunk, the browser stores an **AES-GCM-encrypted checkpoint** (block IDs, per-chunk SHA-256 hashes, and the logical path) in local browser storage. **Neither the encryption password nor the key is saved by the app.**
- Transient HTTP/network errors retry with exponential backoff. The Worker issues 30-minute signed sessions after verifying the GitHub account owner, so GitHub is **not queried for every block**.
- Cancel, refresh, or network loss: reconnect and unlock in the **same browser**, reselect the same local file, and successful chunks are verified and reused. A partially uploaded file is **not visible** until the encrypted index is committed.
- Private-file rename only changes the encrypted index. Downloading large private files streams to disk where the browser supports the File System Access API (primarily Chromium desktop). On other browsers, in-memory downloads are limited to 64 MiB to avoid crashes.
- Encrypted R2 blocks are **retained after deletion** because historical Git commits can reference them. Orphaned blocks from interrupted or discarded transfers are not yet automatically garbage-collected, and R2 storage/operations may incur charges.
- **Back up the R2 bucket alongside the Git repository.** A Git clone alone cannot restore files whose blocks live in R2. The Worker signing secret only authorizes R2 access; it is **not** an additional vault-encryption factor.

## Public files

Files under `Public files` in the interface are stored unencrypted under `public-files/` in Git. The app warns and asks for confirmation before uploading there. **Do not place private files in this folder, even temporarily.**

## Git is forever-ish

Deleting a file does **not** guarantee erasing its contents from the repository's history, forks, clones, caches, or backups. This is especially important for unencrypted public files. Git is not a replacement for secure deletion or a traditional backup system.

Overwriting or deleting encrypted files may also leave obsolete encrypted blocks in Git history. Failed/interrupted uploads can leave orphan ciphertext blocks in the current tree. The current implementation doesn't provide automatic garbage collection for interrupted writes.

**Password loss is permanent data loss.** There is no password reset, no key escrow, and no GitHub Actions encryption secret. Store the password securely elsewhere and retain a separate backup of important files.

## Authentication and Pages

Optional **Continue with GitHub** support uses a GitHub App, PKCE, and a separate code-exchange Worker. It is disabled until configured; a fine-grained token works without any Worker. GitHub Pages cannot access your GitHub login cookies or hold a private OAuth client secret.

1. [Register a GitHub App](https://github.com/settings/apps/new). Set its homepage and callback to your exact Pages URL, including the trailing `/`. Give it repository **Contents: Read and write** and install it on your storage repository.
2. Copy `auth-worker/wrangler.example.jsonc` to `auth-worker/wrangler.jsonc` (ignored by Git). Set `GITHUB_CLIENT_ID` and `SITE_URL` to match the GitHub App. From `auth-worker/`, run `npx wrangler deploy`, then `npx wrangler secret put GITHUB_CLIENT_SECRET`. Do not commit the secret.
3. Under GitHub **Settings → Secrets and variables → Actions → Variables**, set `VITE_GITHUB_CLIENT_ID` to the public client ID and `VITE_GITHUB_OAUTH_EXCHANGE_URL` to the Worker URL ending in `/exchange`. Re-run Pages.

The app validates OAuth state and uses PKCE; the Worker exchanges the code without exposing the app secret to the page. Disconnecting clears the in-memory token but does not revoke the GitHub App authorization. Neither OAuth nor the Worker is a second vault-encryption factor.

The Pages workflow builds React + TypeScript + Tailwind + Vite, runs the automated checks, and deploys to GitHub Pages. Commits touching only `.vault/**` or `public-files/**` are excluded from triggering a rebuild. The encrypted data is never included in the Pages artifact; only the app is deployed.

## Limits

- Without R2: 10 MiB encrypted or public files, with 1 MiB Git encryption blocks.
- With R2: 50 GiB maximum encrypted file size, 8 MiB blocks; public files remain capped at 10 MiB.
- 1,000 entries per folder via GitHub Contents API.
- Client-side filename search, not indexed global search.
- Concurrent manifest updates fail rather than silently overwrite each other; refresh or reconnect to reload.
- Private-file renames update the encrypted index atomically; public-file renames remain write-then-delete.
- Resume checkpoints require the same browser storage, vault password, and original local file selection.
- GitHub repositories are inefficient for large or frequently changing binary storage; use the R2 backend for those files.

## Development

Requires Node 22+.

```sh
npm ci
npm run check
npm run dev
```

The included Pages workflow builds and tests the app on source changes. Vault data commits (`.vault/**`, `public-files/**`) do not trigger frontend rebuilds. Each copy can use its own Pages URL, OAuth App, and R2 bucket without changing the frontend source.

## License

MIT.

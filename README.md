# RepoDrive

A minimal, mobile-first file manager for a GitHub repository. React, TypeScript, Tailwind CSS, Vite, and GitHub Pages. No server.

Browse folders, filter filenames, upload or replace files, download and preview images/text, create or remove empty folders, rename and delete files, and open GitHub's version history. Every write becomes a commit.

## Getting started

1. Click **Use this template** to create a **public** repository for the website.
2. Create a **separate private repository** for your files. Initialize it with a README so it has a default branch.
3. In the website repository, open **Settings → Pages** and choose **GitHub Actions** as the build/deployment source.
4. The included workflow deploys the frontend on pushes to `main`. Your site will be at `https://YOURNAME.github.io/YOUR-REPO/`.
5. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) restricted to the **storage repository**, with **Contents: Read and write**. Open the site and enter `owner/storage-repo` and the token.

The Pages site is public; your storage repo can be private. **Never** commit a token, add it to Pages build variables, or put private files in the website repository. Tokens are kept only in the running page's memory, and a refresh disconnects you.

## Develop

Requires Node.js 22+.

```sh
npm ci
npm run dev
npm run check   # tests, TypeScript, production build
```

The Pages workflow sets the correct Vite base path from the repository name. Local builds use `/`.

## Deliberate limits

- Uploads and renames are limited to **10 MiB** per file. This protects repo size and browser memory; it is not an API hard limit.
- GitHub's Contents API lists **at most 1,000 entries per directory**. Search filters the current directory; it is not a global index.
- Folder creation uses a hidden `.gitkeep` marker. Only empty folders created by this app can be removed.
- Renaming writes the new file and then deletes the old file. These are **two commits, not an atomic move**; if deletion fails, both files may remain.
- Git history retains deleted or replaced binary data. This is good for small documents/configuration, **not** large media, high-frequency backups, or a replacement for proper object storage.
- No OAuth backend, multiuser sharing, synchronization, trash, or automatic offsite backup.
- Private files and access tokens are handled in the browser. Use only on devices you trust; a malicious browser extension or injected script could access the session. The app does not store a token in cookies, localStorage, or sessionStorage.

If you need shared access, persistent login, or large files, add a proper authentication backend and object storage rather than extending the personal-token approach.

## License

MIT.

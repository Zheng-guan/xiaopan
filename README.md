<div align="right">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</div>

<h1 align="center">Xiaopan</h1>

<p align="center">
  A private, responsive personal cloud drive built with React, Supabase, and Netlify.
</p>

<p align="center">
  <a href="https://xiaopan-drive.netlify.app"><strong>Live Demo</strong></a>
</p>

## Overview

Xiaopan combines private file storage, resumable large-file uploads, cross-device text transfer, secure public sharing, and server-protected administration in one clean web interface.

Files are uploaded directly from the browser to Supabase Storage. They do not pass through a Netlify Function, so large uploads are not constrained by serverless request-body, response-body, or execution-time limits.

## Features

- Email/password registration, sign-in, sign-out, and session refresh
- Private files and folders for every user
- Folder navigation, list/grid views, search, sorting, and storage statistics
- Drag-and-drop and multi-file uploads
- Supabase TUS uploads with 6 MiB chunks
- Pause/resume, retry, upload progress, and live transfer speed
- Short-lived signed download URLs and browser-streamed downloads
- Rename, move, recursive delete, and multi-select operations
- **Quick Text Transfer:** paste on a phone, receive it on a computer, and copy it with one click
- Realtime text sync, recent history, refresh-on-focus, and deletion
- Public sharing for files, text, and web links
- Random capability tokens, expiration dates, view counts, and share revocation
- Password-only administrator entry in the UI
- Server-side administrator allowlist and management dashboard
- Responsive desktop, tablet, and mobile layouts
- Reduced-motion accessibility support

## Architecture

```text
Browser
  ├─ Supabase Auth
  ├─ Postgres Data API
  │    ├─ drive_items  ── user-scoped file metadata with RLS
  │    ├─ quick_texts  ── private cross-device text with RLS + Realtime
  │    └─ shares       ── owner-managed share records with RLS
  ├─ Supabase Storage TUS endpoint ── direct resumable uploads
  └─ /api/signed-download ── optional Netlify Function

Public visitor
  └─ public-share Supabase Edge Function
       ├─ resolves an unguessable UUID capability token
       └─ returns text/link data or a 60-second file URL

Administrator
  └─ admin-dashboard Supabase Edge Function
       ├─ validates the user JWT
       ├─ checks the server-side admin_users allowlist
       └─ reads statistics or removes users and their private objects
```

Storage object paths always follow:

```text
<user-id>/<stable-upload-token>/<safe-file-name>
```

Both Postgres RLS and Storage policies verify ownership. Modifying the frontend cannot grant access to another user's rows or objects.

## Tech Stack

- React 19
- TypeScript 5
- Vite 7
- Supabase Auth, Postgres, Realtime, and Storage
- `@supabase/supabase-js`
- `tus-js-client`
- Lucide Icons
- Netlify and Netlify Functions

## Requirements

- Node.js 22 or newer
- A Supabase project
- A Netlify account for deployment

## Local Setup

```bash
git clone git@github.com:Zheng-guan/xiaopan.git
cd xiaopan
npm install
cp .env.example .env.local
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Configure `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
VITE_STORAGE_QUOTA_BYTES=1073741824
VITE_MAX_FILE_SIZE_BYTES=52428800
VITE_ADMIN_EMAIL=admin@example.com
```

Use a Supabase publishable key in the browser. Never expose a secret key or service-role key through a `VITE_` variable.

Start the development server:

```bash
npm run dev
```

Then open `http://localhost:5173`.

Quality checks:

```bash
npm run typecheck
npm run build
```

## Supabase Setup

### 1. Apply database migrations

Migration files are stored in `supabase/migrations/`.

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migrations create:

- The private `drive` Storage bucket
- `drive_items`, `shares`, `quick_texts`, and `admin_users`
- Ownership constraints, indexes, and helper functions
- Postgres RLS policies
- Storage read/write policies
- Realtime publication for private quick-text inserts
- Server-only administrator functions and permissions

### 2. Deploy Edge Functions

The administrator function must require a valid JWT:

```bash
npx supabase functions deploy admin-dashboard
```

The public-share function uses an unguessable capability token and therefore accepts requests without a user JWT:

```bash
npx supabase functions deploy public-share --no-verify-jwt
```

Anonymous users do not have direct access to the `shares` table. The function only returns active share data and never exposes owner email addresses, Storage paths, or service credentials.

### 3. Configure authentication URLs

In **Authentication → URL Configuration**, add:

- Local development: `http://localhost:5173/**`
- Production: `https://xiaopan-drive.netlify.app/**`

### 4. Configure the administrator

Add the normalized administrator email to `admin_users`, then set the same value in `VITE_ADMIN_EMAIL`.

The administrator entry displays only a password field. The fixed email is used internally for Supabase Auth, while actual authorization is enforced by the server-side allowlist—not by frontend metadata or an editable email field. Never store the administrator password in source code.

## Resumable Uploads and Limits

Xiaopan follows Supabase's current Storage recommendations:

- Resumable TUS uploads are recommended for files larger than 6 MB or unreliable networks.
- Supabase currently requires a **6 MB** TUS chunk size.
- A resumable upload URL remains valid for up to **24 hours**.
- The Free plan's maximum global file-size setting is **50 MB**.
- Pro and Team projects can configure limits up to **500 GB**.
- A bucket-level limit cannot exceed the project's global limit.

The browser stores upload fingerprints locally. Re-selecting the same file after an interruption resumes it from the uploaded position.

Official references:

- [Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

## Netlify Deployment

The included `netlify.toml` configures:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- SPA route fallback
- Security and immutable-asset headers

Add these build variables in Netlify:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_STORAGE_QUOTA_BYTES
VITE_MAX_FILE_SIZE_BYTES
VITE_ADMIN_EMAIL
```

Optional server-side signed-download variables:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

Deploy a preview first:

```bash
npx netlify status
npx netlify deploy
```

After verification:

```bash
npx netlify deploy --prod
```

## Security Notes

- Every exposed user-data table has RLS enabled.
- Authenticated policies always include an ownership predicate.
- Anonymous roles have no direct access to private file, text, or share records.
- The Storage bucket remains private.
- Secret/service-role keys are server-side only.
- Administrator authorization comes from `admin_users`, not `user_metadata`.
- Public shares use high-entropy UUID capability tokens and short-lived file URLs.
- Quick Text records are private to the signed-in account and do not become public shares automatically.

## Project Structure

```text
src/
  App.tsx                 Main authentication and drive interface
  QuickTextCenter.tsx     Cross-device private text transfer
  ShareCenter.tsx         Owner share management
  PublicShareView.tsx     Public capability-link view
  AdminApp.tsx            Server-authorized administration UI
  lib/                    Supabase, drive, upload, share, and text helpers
netlify/functions/        Optional signed-download function
supabase/functions/       Administrator and public-share Edge Functions
supabase/migrations/      Database, RLS, Storage, and Realtime migrations
```

## Support

Issue report email: [raimanncostigan@gmail.com](mailto:raimanncostigan@gmail.com)

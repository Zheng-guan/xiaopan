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

Files are uploaded directly from the browser to Cloudflare R2 with server-signed multipart URLs. File bytes do not pass through a Netlify Function, so large uploads are not constrained by serverless request-body or response-body limits. Supabase provides authentication, metadata, row-level security, realtime text transfer, and quota transactions.

## Features

- Two-step registration with Cloudflare Turnstile, an eight-digit email code, and password setup after verification
- Password sign-in, sign-out, and session refresh
- Private files and folders for every user
- Folder navigation, list/grid views, search, sorting, and storage statistics
- Drag-and-drop and multi-file uploads
- Cloudflare R2 multipart uploads with adaptive 10 MiB-or-larger parts
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
  ├─ Netlify Functions ── validate Supabase JWTs and sign R2 requests
  └─ Cloudflare R2 ── direct browser multipart upload/download

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

New R2 object keys always follow:

```text
<user-id>/<random-token>/file.<ascii-extension>
```

Supabase RLS protects metadata. Netlify verifies the caller's Supabase JWT and user-prefixed R2 key before signing any private object operation. The schema retains a legacy provider path for installations that have not yet migrated old Supabase Storage objects.

## Tech Stack

- React 19
- TypeScript 5
- Vite 7
- Supabase Auth, Postgres, and Realtime
- Cloudflare R2 multipart object storage
- `@supabase/supabase-js`
- AWS SDK for JavaScript (server-side R2 signing only)
- Lucide Icons
- Netlify and Netlify Functions

## Requirements

- Node.js 22 or newer
- A Supabase project
- A Cloudflare account and R2 bucket
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
VITE_MAX_FILE_SIZE_BYTES=10000000000
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
- Atomic upload reservations and server-enforced per-account/global quotas
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

### 3. Configure registration verification codes

In **Authentication → Sign In / Providers → Email**, enable **Confirm email**. Registration must not be allowed to create an authenticated session before the email is verified.

Then open **Authentication → Email Templates → Confirm signup** and use a code-only template. Do not include `{{ .ConfirmationURL }}`:

```html
<h2>Xiaopan registration code</h2>
<p>Enter this eight-digit code to finish creating your account:</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">
  {{ .Token }}
</p>
<p>This code expires shortly. Do not share it.</p>
```

The first step asks only for a display name, email address, and CAPTCHA. Supabase receives a cryptographically random bootstrap password so it can issue the signup challenge. After `verifyOtp` succeeds, the frontend immediately replaces that bootstrap value with the password chosen by the user. The chosen password is never stored in Web Storage, and the project does not implement a custom OTP table.

> **Supabase Free plan note:** For new Free projects created on or after June 3, 2026, Supabase's default SMTP does not allow custom authentication email templates. Configure a custom SMTP provider in **Authentication → Emails → SMTP Settings** before saving the code-only template. Never put SMTP credentials in browser environment variables.

For local Supabase development, `supabase/config.toml` enables email confirmation and uses `supabase/templates/confirmation.html`.

Official references:

- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Changes to email template customization on Free tier](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)

### 4. Configure Cloudflare Turnstile

1. Create a **Managed** Turnstile widget in Cloudflare and allow the production hostname plus `localhost` for local testing.
2. Put the public **Site key** in `VITE_TURNSTILE_SITE_KEY`.
3. In Supabase, open **Authentication → Bot and Abuse Protection**, enable CAPTCHA protection, select **Turnstile**, and enter the matching Cloudflare **Secret key**.

The site key is browser-safe. The secret key must exist only in Supabase Auth settings and must never use a `VITE_` variable.

### 5. Configure authentication URLs

In **Authentication → URL Configuration**, add:

- Local development: `http://localhost:5173/**`
- Production: `https://xiaopan-drive.netlify.app/**`

### 6. Configure the administrator

Add the normalized administrator email to `admin_users`, then set the same value in `VITE_ADMIN_EMAIL`.

The administrator entry displays only a password field. The fixed email is used internally for Supabase Auth, while actual authorization is enforced by the server-side allowlist—not by frontend metadata or an editable email field. Never store the administrator password in source code.

## Cloudflare R2 Setup

1. In **R2 → Manage R2 API Tokens**, create an S3 API token with **Object Read & Write** access limited to the `xiaopan` bucket.
2. Copy the Access Key ID and Secret Access Key when shown. Store them only as Netlify server variables.
3. Configure this CORS policy on the `xiaopan` bucket:

```json
[
  {
    "AllowedOrigins": [
      "https://xiaopan-drive.netlify.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ETag` exposure is required to complete multipart uploads. Add each real preview/custom origin before testing it; do not make the bucket public.

## Resumable Uploads and Limits

New files upload directly from the browser to R2 through server-signed multipart URLs:

- Base part size is **10 MiB**, increasing automatically before the 10,000-part limit.
- Failed parts retry with fresh one-hour signed URLs.
- Pause/resume state and completed part ETags are retained in R2. Re-select the same local file to continue after a refresh.
- R2 supports multipart objects up to **5 TiB**. Browser, network, account billing, and the configured UI limit can impose lower practical limits.
- Xiaopan enforces a **10 GB decimal shared pool**. Each non-admin account is limited to **200 MB**. The administrator receives the unallocated balance: `10 GB − 200 MB × non-admin account count`.
- The administrator's single-file ceiling is **10 GB**. A non-admin account remains limited to **200 MB total**, so its effective single-file limit cannot exceed its remaining account quota.
- The effective limit is the lower of `VITE_MAX_FILE_SIZE_BYTES` and the account's remaining quota. The drive UI shows total account usage without a separate single-file-limit label.
- Quota is reserved atomically before part URLs are issued. The completed R2 object size is verified before its metadata is committed.
- Incomplete multipart uploads are automatically aborted after seven days by R2.

Official references:

- [R2 upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

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
VITE_MAX_FILE_SIZE_BYTES
VITE_ADMIN_EMAIL
```

Required server-only signing variables:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
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
- Netlify file operations use the caller's Supabase JWT and narrowly scoped security-definer RPCs; no Supabase service-role key is required in Netlify.
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

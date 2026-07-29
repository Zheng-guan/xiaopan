# Xiaopan Agent Guide

## Purpose

Xiaopan is a private personal cloud drive. It supports Supabase authentication, per-user file storage, resumable uploads, downloads, public sharing, cross-device text transfer, and password-gated administration.

This file is the operating guide for anyone changing the repository. Preserve the privacy model before adding features or changing the interface.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Authentication, drive workspace, navigation, upload UI, theme toggle host. |
| `src/ThemeToggle.tsx` | Persists `xiaopan:theme`, follows the system preference on first visit, and synchronizes tabs. |
| `src/ShareCenter.tsx`, `src/QuickTextCenter.tsx` | Sharing and private cross-device text transfer. |
| `src/AdminApp.tsx`, `src/lib/admin.ts` | Administrator UI and calls to the protected Supabase Edge Function. |
| `src/lib/drive.ts`, `src/lib/upload.ts` | Drive operations and the direct-to-R2 multipart upload client. |
| `src/styles.css` | Design tokens, responsive UI, and dark-theme overrides. |
| `supabase/migrations/` | Ordered database schema, RLS, and Storage-policy changes. |
| `supabase/functions/` | Supabase Edge Functions for administration and public sharing. |
| `netlify/functions/` | Authenticated R2 multipart, download, cleanup, and administration endpoints. |
| `netlify.toml` | Vite build, Netlify Functions, SPA redirect, and security headers. |

## Non-negotiable security rules

1. Never expose `SUPABASE_SECRET_KEY`, a service-role key, Netlify tokens, or user credentials in browser code, commits, README examples, screenshots, or logs.
2. Browser code may use only the Supabase URL and publishable key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
3. Treat Postgres RLS and server-side R2 signing as the authorization boundary. Client-side checks are only UX conveniences.
4. Keep R2 objects under the authenticated owner's UUID prefix. Never accept an arbitrary key without verifying this prefix or its database ownership.
5. Keep privileged tasks server-side. R2 API keys may exist only in Netlify runtime variables; signed URLs should be short lived.
6. Administrator authority is enforced through the `admin_users` database allowlist and the `admin-dashboard` Edge Function. Do not implement administrator access based only on a client-side email check.

## Development workflow

```bash
npm ci
npm run dev
npm run build
```

- Copy `.env.example` to `.env.local` for local work. Do not commit `.env.local`.
- Run `npm run build` before handing off or deploying.
- Use the existing React/Vite conventions: TypeScript, functional components, and CSS in `src/styles.css`.
- Keep touch targets at least 40px where practical and preserve keyboard focus styles.

## UI and theme rules

- Reuse CSS variables such as `--canvas`, `--panel`, `--ink`, `--line`, and `--green` before introducing new colors.
- Add a matching `[data-theme="dark"]` treatment whenever a new light-only surface, border, or input is introduced.
- The root toggle is intentionally global so it is available on authentication, drive, sharing, quick-text, administration, and public-share screens.
- Do not remove the short inline theme initializer in `index.html`; it prevents a light-mode flash before React loads.
- Maintain the existing quiet green visual language. Do not turn functional status colors into general decoration.

## Supabase change rules

- Add a new timestamped SQL migration; never rewrite an already-applied migration.
- Review both table RLS and Storage policies for every new data path.
- Deploy changed Edge Functions after applying migrations.
- For public sharing, validate expiry, token, and item visibility on the server or in RLS; never trust a URL parameter alone.

## Environment-variable boundary

| Browser-safe build variables | Server-only Netlify variables |
| --- | --- |
| `VITE_SUPABASE_URL` | `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |
| `VITE_STORAGE_QUOTA_BYTES` | `SUPABASE_SECRET_KEY` |
| `VITE_MAX_FILE_SIZE_BYTES` | `R2_ACCOUNT_ID` |
| | `R2_BUCKET_NAME` |
| | `R2_ACCESS_KEY_ID` |
| | `R2_SECRET_ACCESS_KEY` |

`VITE_ADMIN_EMAIL` is presentation-only. It must not be used as an authorization mechanism.

## Deployment checklist

1. Confirm `npm run build` succeeds.
2. Review the staged diff for accidental environment files, generated output, or secrets.
3. Commit and push `main` to GitHub.
4. Deploy the linked Netlify site from the project root using `netlify deploy --prod`, or allow the GitHub integration to build it.
5. Confirm the production page returns HTTP 200 and manually smoke-test login, upload UI, theme switching, and a signed download.

## 中文速记

- 安全边界在 Supabase RLS、Storage Policy 与服务端函数，不能只靠前端判断。
- 不提交 `.env.local`，不把 `SUPABASE_SECRET_KEY` 放进浏览器代码。
- 改数据库请新增迁移文件；改样式要同时检查深色模式和手机端。
- 上线前执行 `npm run build`，上线后检查登录、上传、下载、分享和主题切换。

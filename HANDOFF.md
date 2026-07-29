# Xiaopan Handoff

Last updated: 2026-07-30 (Asia/Shanghai)

## Current release

| Item | Status |
| --- | --- |
| GitHub repository | `https://github.com/Zheng-guan/xiaopan` |
| Production site | `https://xiaopan-drive.netlify.app` |
| Netlify site | `xiaopan-drive` (`5fe119cb-b071-4efd-9414-48ca9de48890`) |
| Source branch | `main` |
| Current release scope | R2 migration, server quotas, and upload-limit UI |
| Deployment method | Linked Netlify CLI production deployment |

All production file objects are now in Cloudflare R2. The two legacy Supabase
Storage objects (6,572,462 bytes total) were copied, verified with R2 `HEAD`,
switched to provider `r2`, and removed from Supabase Storage. The one-time
migration endpoint was removed after completion. The `xiaopan` bucket CORS allows
the production origin and local Vite development and exposes `ETag`.

## Delivered capabilities

- Email/password registration, sign-in, sign-out, and session persistence through Supabase Auth.
- Private per-user drive with folders, rename, dialog-based and drag-based move, delete, multi-select, search, sorting, and usage display.
- Direct browser-to-R2 multipart uploads with progress, speed, retries, pause/resume, and re-selection recovery.
- Direct and signed streaming download paths.
- File, text, and link sharing; a public-share view; and private cross-device text transfer.
- Server-protected administrator dashboard backed by the `admin_users` allowlist.
- Responsive light/dark theme. The first visit follows system preference; later choices are stored as `xiaopan:theme`.
- R2 private/public downloads, deletion, and administrator cleanup through protected Netlify Functions.
- A 10 GB decimal global pool, 200 MB per non-admin account, and a dynamic administrator allocation of `10 GB − 200 MB × non-admin account count`.
- Atomic upload reservations, actual R2 object-size verification, and visible effective single-file limits.

## Required configuration

Do not place values in this document. Set browser variables in the Vite/Netlify build environment and server variables only in Netlify:

| Browser build variables | Netlify server variables |
| --- | --- |
| `VITE_SUPABASE_URL` | `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |
| `VITE_MAX_FILE_SIZE_BYTES` | |

Use `.env.example` as the variable-name reference. `.env.local` is local-only and ignored by Git.

Additional required Netlify server variables:

```text
R2_ACCOUNT_ID=40c2930d265796bcdd131c24aed986d0
R2_BUCKET_NAME=xiaopan
R2_ACCESS_KEY_ID=<bucket-scoped key>
R2_SECRET_ACCESS_KEY=<bucket-scoped secret>
```

## Supabase deployment state to preserve

Apply migrations in filename order. The repository currently includes:

1. `20260727131858_initial_drive.sql`
2. `20260727142246_fix_drive_parent_index.sql`
3. `20260728020430_add_admin_management.sql`
4. `20260728022633_add_explicit_admin_deny_policy.sql`
5. `20260728045910_add_multi_type_shares.sql`
6. `20260728050842_add_share_foreign_key_index.sql`
7. `20260728075355_add_quick_text_transfer.sql`
8. `20260729170000_add_r2_storage_provider.sql`
9. `20260729235800_enforce_drive_quotas.sql`
10. `20260730170000_allow_authenticated_quota_rpcs.sql`
11. `20260730173000_resolve_public_r2_share.sql`

Supabase Edge Functions to deploy when changed:

- `admin-dashboard`
- `public-share`

The R2 Netlify Functions validate Supabase sessions or public share tokens before signing object operations. Never expose R2 credentials through `VITE_` variables.

## Routine maintenance

```bash
npm ci
npm run build
```

For a manual production deploy from the linked project root:

```bash
npx netlify-cli deploy --prod
```

After deployment, verify:

1. `https://xiaopan-drive.netlify.app` loads over HTTPS.
2. Login and logout work with the configured Supabase project.
3. Upload UI appears, can pause/resume, and does not permit a file over the configured client-side limit.
4. Download and public-share links respect the expected permission or expiry.
5. The moon/sun control switches between themes and the choice survives refresh.
6. On mobile, new-folder and download controls remain visible; long-press a file or folder icon and drag it onto a folder or breadcrumb destination.
7. On desktop, dragging selected or individual items onto folders and breadcrumb destinations moves them without opening the upload overlay.

## Current follow-up items

- Rotate both Cloudflare tokens because their values were pasted into a chat, then update the two secret Netlify variables.
- Smoke-test an 80 MB `.exe` upload, pause/resume, private download, public-share download, and deletion with a real signed-in account.
- `npm ci` reported 16 dependency advisories (2 low, 14 high) on 2026-07-28. They did not block the production build. Review `npm audit` and upgrade deliberately in a separate change; do not apply `npm audit fix --force` without testing.
- Quotas are enforced server-side with atomic reservations. The client display is only an early convenience check.
- Supabase currently reports leaked-password protection as disabled; enable it in Auth settings if the project plan supports it.
- Keep the live Supabase Auth redirect URLs aligned with the Netlify production URL and any preview domains used for testing.
- Smoke-test mobile long-press drag and desktop drag-to-move with real signed-in accounts after every related UI change.

## Safe next handoff

Before another feature change, read `AGENT.md`, inspect the Git diff, and run `npm run build`. For any change involving files, sharing, or administration, review the relevant RLS/Storage policy and server function at the same time as the UI change.

## 中文摘要

当前线上站点已部署并可访问。下一位维护者应先阅读 `AGENT.md`，不要泄露环境变量；改文件权限、分享或后台功能时，必须同时检查 Supabase 的 RLS、Storage Policy 和服务端函数。发布前构建，发布后检查登录、上传、下载、分享和深浅色切换。

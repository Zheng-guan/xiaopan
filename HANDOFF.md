# Xiaopan Handoff

Last updated: 2026-07-29 (Asia/Shanghai)

## Current release

| Item | Status |
| --- | --- |
| GitHub repository | `https://github.com/Zheng-guan/xiaopan` |
| Production site | `https://xiaopan-drive.netlify.app` |
| Netlify site | `xiaopan-drive` (`5fe119cb-b071-4efd-9414-48ca9de48890`) |
| Last source commit | `5555d29 feat: add light and dark themes` |
| Last production deploy | `6a68d2012c8df878eca872da` — ready |
| Deployment method | Netlify CLI production deploy; Vite build and `signed-download` function bundled successfully |

The current production site was verified after deployment: it returned HTTP 200 and included the persisted theme initializer.

## Delivered capabilities

- Email/password registration, sign-in, sign-out, and session persistence through Supabase Auth.
- Private per-user drive with folders, rename, move, delete, multi-select, search, sorting, and usage display.
- Drag-and-drop TUS resumable uploads with progress, speed, retries, pause/resume, and local continuation support.
- Direct and signed streaming download paths.
- File, text, and link sharing; a public-share view; and private cross-device text transfer.
- Server-protected administrator dashboard backed by the `admin_users` allowlist.
- Responsive light/dark theme. The first visit follows system preference; later choices are stored as `xiaopan:theme`.

## Required configuration

Do not place values in this document. Set browser variables in the Vite/Netlify build environment and server variables only in Netlify:

| Browser build variables | Netlify server variables |
| --- | --- |
| `VITE_SUPABASE_URL` | `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |
| `VITE_STORAGE_QUOTA_BYTES` | `SUPABASE_SECRET_KEY` |
| `VITE_MAX_FILE_SIZE_BYTES` | |

Use `.env.example` as the variable-name reference. `.env.local` is local-only and ignored by Git.

## Supabase deployment state to preserve

Apply migrations in filename order. The repository currently includes:

1. `20260727131858_initial_drive.sql`
2. `20260727142246_fix_drive_parent_index.sql`
3. `20260728020430_add_admin_management.sql`
4. `20260728022633_add_explicit_admin_deny_policy.sql`
5. `20260728045910_add_multi_type_shares.sql`
6. `20260728050842_add_share_foreign_key_index.sql`
7. `20260728075355_add_quick_text_transfer.sql`

Supabase Edge Functions to deploy when changed:

- `admin-dashboard`
- `public-share`

The Netlify function `signed-download` is deployed with the Netlify site. It needs all three server-side variables above and must retain its caller/session validation before it signs a file URL.

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

## Current follow-up items

- `npm ci` reported 16 dependency advisories (2 low, 14 high) on 2026-07-28. They did not block the production build. Review `npm audit` and upgrade deliberately in a separate change; do not apply `npm audit fix --force` without testing.
- The client quota and per-file limit are pre-upload UX checks. Confirm real limits in Supabase Storage whenever the plan or bucket settings change.
- Keep the live Supabase Auth redirect URLs aligned with the Netlify production URL and any preview domains used for testing.

## Safe next handoff

Before another feature change, read `AGENT.md`, inspect the Git diff, and run `npm run build`. For any change involving files, sharing, or administration, review the relevant RLS/Storage policy and server function at the same time as the UI change.

## 中文摘要

当前线上站点已部署并可访问。下一位维护者应先阅读 `AGENT.md`，不要泄露环境变量；改文件权限、分享或后台功能时，必须同时检查 Supabase 的 RLS、Storage Policy 和服务端函数。发布前构建，发布后检查登录、上传、下载、分享和深浅色切换。

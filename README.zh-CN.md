<div align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</div>

<h1 align="center">小盘</h1>

<p align="center">
  基于 React、Supabase 与 Netlify 构建的私密、响应式个人云盘。
</p>

<p align="center">
  <a href="https://xiaopan-drive.netlify.app"><strong>在线体验</strong></a>
</p>

## 项目简介

小盘将私有文件存储、大文件断点续传、跨设备文字快传、安全公开分享和服务端后台管理整合在一个简洁的网站中。

文件通过服务端签发的分片地址，由浏览器直接上传到 Cloudflare R2。文件内容不经过 Netlify Function，因此大文件不会受到 Serverless 请求体或响应体限制。Supabase 负责用户登录、文件元数据、RLS、文字实时同步和额度事务。

## 主要功能

- 先通过 Cloudflare Turnstile 人机验证获取 8 位邮箱验证码，验证后再设置登录密码
- 密码登录、退出和会话自动续期
- 每位用户独立的私有文件与文件夹空间
- 文件夹导航、列表/网格视图、搜索、排序和容量统计
- 拖拽上传和多文件上传
- 基于 Cloudflare R2 的分片上传，基础分片为 10 MiB 并可自动增大
- 暂停/继续、失败重试、取消并清理已上传分片、上传进度和实时速度
- 短时签名 URL 下载和浏览器流式下载
- 重命名、移动、递归删除和多选操作
- **文字快传：**手机粘贴保存，电脑实时收到并一键复制
- 最近文字记录、实时同步、重新聚焦刷新和删除
- 文件、文字和网页链接三种公开分享类型
- 随机能力令牌、有效期、查看次数和随时取消分享
- 管理员入口在界面上只显示密码框
- 服务端管理员白名单和后台管理
- 响应式桌面、平板和手机界面
- 减少动态效果的无障碍支持

## 系统架构

```text
浏览器
  ├─ Supabase Auth
  ├─ Postgres Data API
  │    ├─ drive_items  ── RLS 保护的文件元数据
  │    ├─ quick_texts  ── RLS + Realtime 保护的文字快传
  │    └─ shares       ── 仅所有者管理的分享记录
  ├─ Netlify Functions ── 验证 Supabase JWT 并签发 R2 请求
  └─ Cloudflare R2 ── 浏览器直连分片上传与下载

公开访问者
  └─ public-share Supabase Edge Function
       ├─ 校验不可猜测的 UUID 能力令牌
       └─ 返回文字/链接或 60 秒文件下载地址

管理员
  └─ admin-dashboard Supabase Edge Function
       ├─ 验证用户 JWT
       ├─ 检查服务端 admin_users 白名单
       └─ 读取统计或删除用户及其私有对象
```

新的 R2 对象 key 固定为：

```text
<user-id>/<random-token>/file.<ascii-extension>
```

Supabase RLS 保护文件元数据。Netlify 在签发任何 R2 私有对象操作前都会验证 Supabase JWT 和用户路径前缀。数据结构仍保留旧 Supabase Storage 文件的兼容路径，便于尚未迁移的安装使用。

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Supabase Auth、Postgres 和 Realtime
- Cloudflare R2 分片对象存储
- `@supabase/supabase-js`
- AWS SDK for JavaScript（只在服务端签名）
- Lucide Icons
- Netlify 与 Netlify Functions

## 环境要求

- Node.js 22 或更高版本
- 一个 Supabase 项目
- 一个 Cloudflare 账户和 R2 存储桶
- 用于部署的 Netlify 账户

## 本地运行

```bash
git clone git@github.com:Zheng-guan/xiaopan.git
cd xiaopan
npm install
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

填写 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
VITE_MAX_FILE_SIZE_BYTES=10000000000
```

浏览器只能使用 Supabase publishable key。绝不能通过带 `VITE_` 前缀的变量暴露 Secret Key 或 service-role key。

启动开发环境：

```bash
npm run dev
```

访问 `http://localhost:5173`。

类型检查和生产构建：

```bash
npm run typecheck
npm run build
```

## 配置 Supabase

### 1. 应用数据库迁移

迁移文件位于 `supabase/migrations/`：

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

迁移会创建：

- 私有 `drive` Storage bucket
- `drive_items`、`shares`、`quick_texts` 和 `admin_users`
- 所有权约束、索引和辅助函数
- Postgres RLS policies
- Storage 读写 policies
- 原子上传预留和服务端强制执行的账户/全站额度
- 用于文字快传的 Realtime publication
- 仅限服务端调用的管理员函数和权限

### 2. 部署 Edge Functions

管理员函数必须开启 JWT 验证：

```bash
npx supabase functions deploy admin-dashboard
npx supabase functions deploy registration-availability --no-verify-jwt
```

公开分享使用不可猜测的能力令牌，因此允许没有用户 JWT 的请求：

```bash
npx supabase functions deploy public-share --no-verify-jwt
```

匿名用户不能直接读取 `shares` 表。函数只返回仍然有效的分享内容，不会公开用户邮箱、Storage 路径或服务端密钥。

### 3. 配置注册验证码

在 **Authentication → Sign In / Providers → Email** 中开启 **Confirm email（确认邮箱）**。开启后，新账户必须先验证邮箱，不能在未验证时直接获得登录会话。

然后进入 **Authentication → Email Templates → Confirm signup**，把确认注册邮件改为只包含验证码的模板。不要放入 `{{ .ConfirmationURL }}`：

```html
<h2>小盘注册验证码</h2>
<p>请输入以下 8 位验证码完成注册：</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">
  {{ .Token }}
</p>
<p>验证码将在短时间后失效，请勿转发。</p>
```

第一步只收集称呼、邮箱和人机验证结果。为了让 Supabase 发起注册验证，前端会在内存中生成高强度随机的临时密码；`verifyOtp` 验证成功后立即替换成用户在第二步设置的密码。用户设置的密码不会写入 Web Storage，项目也不自建验证码表。

> **Supabase 免费版注意事项：**2026 年 6 月 3 日及以后创建的新 Free 项目，如果使用 Supabase 默认 SMTP，就不能自定义身份验证邮件模板。必须先在 **Authentication → Emails → SMTP Settings** 中配置自定义 SMTP，再保存上面的纯验证码模板。SMTP 凭据只能保存在服务端配置中，不能放入浏览器环境变量。

本地 Supabase 开发环境已经在 `supabase/config.toml` 中开启邮箱确认，并使用 `supabase/templates/confirmation.html`。

官方资料：

- [Supabase 邮件模板](https://supabase.com/docs/guides/auth/auth-email-templates)
- [免费版邮件模板自定义变更](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)

### 4. 配置 Cloudflare Turnstile

1. 在 Cloudflare 创建一个 **Managed（托管）** Turnstile 组件，把正式网站域名和本地测试所需的 `localhost` 加入允许列表。
2. 将公开的 **Site key** 配置为 `VITE_TURNSTILE_SITE_KEY`。
3. 进入 Supabase 的 **Authentication → Bot and Abuse Protection**，开启 CAPTCHA，选择 **Turnstile**，填入对应的 Cloudflare **Secret key**。

Site key 可以放在浏览器环境变量中；Secret key 只能保存在 Supabase Auth 设置中，绝不能使用 `VITE_` 前缀。

### 5. 配置 Auth 地址

在 **Authentication → URL Configuration** 中加入：

- 本地开发：`http://localhost:5173/**`
- 正式网站：`https://xiaopan-drive.netlify.app/**`

### 6. 配置管理员

将规范化的小写管理员邮箱添加到 `admin_users`，再把同一邮箱配置到 `VITE_ADMIN_EMAIL`。

管理员入口只显示密码框，固定邮箱仅在内部用于 Supabase Auth 登录。真正的管理员权限来自服务端白名单，而不是前端邮箱字段或可编辑的用户元数据。不要把管理员密码写进源码。

## 配置 Cloudflare R2

1. 进入 **R2 → Manage R2 API Tokens**，创建一个仅限 `xiaopan` 存储桶、权限为 **Object Read & Write** 的 S3 API Token。
2. 创建后立即复制 Access Key ID 和 Secret Access Key，只保存到 Netlify 服务端环境变量。
3. 给 `xiaopan` 存储桶设置下面的 CORS：

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

必须暴露 `ETag`，否则浏览器无法完成分片合并。测试预览域名或自定义域名前，应把真实来源加入列表；不要把存储桶设为公开。

## 大文件断点续传与限制

新文件通过服务端签名的分片地址，由浏览器直接上传到 R2：

- 基础分片大小为 **10 MiB**，大文件会自动增大分片，避免超过 10,000 个分片。
- 10 MiB 是分片边界，不是带宽限速。文件由浏览器直接传到 R2，实际速度取决于用户上行带宽、浏览器、到 Cloudflare 的网络线路，以及当前逐片顺序上传的策略。
- 失败的分片会使用新的一小时临时签名地址重试。
- R2 保存已完成分片；刷新后重新选择同一个本地文件即可继续。
- 取消任务会终止 R2 分片上传、删除已经上传的分片、释放数据库预留容量、移除本地续传会话，并清除任务记录。
- R2 分片上传的单对象官方上限为 **5 TiB**。浏览器、网络、账户计费和前端配置可能让实际可用上限更低。
- 小盘强制使用 **10 GB（十进制）共享池**。每个普通账户最多 **200 MB**；管理员额度为剩余未分配空间：`10 GB − 200 MB × 普通账户数`。
- 管理员单文件上限为 **10 GB**。普通账户总额度仍为 **200 MB**，所以其单文件实际上限不会超过账户当前剩余空间。
- 实际限制取 `VITE_MAX_FILE_SIZE_BYTES` 与账户剩余空间中的较小值。云盘界面只显示账户总容量使用情况，不再单独显示单文件上限标识。
- 服务端会在签发分片地址前原子预留额度，并在写入文件记录前核验 R2 对象的实际大小。
- 未完成的分片上传会由 R2 在七天后自动终止。

官方资料：

- [R2 上传对象](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [R2 预签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 S3 API 兼容性](https://developers.cloudflare.com/r2/api/s3/api/)

## 部署到 Netlify

项目内的 `netlify.toml` 已配置：

- 构建命令：`npm run build`
- 发布目录：`dist`
- Functions 目录：`netlify/functions`
- SPA 路由回退
- 安全响应头和静态资源长期缓存

在 Netlify 中添加以下构建变量：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAX_FILE_SIZE_BYTES
VITE_ADMIN_EMAIL
```

必需的服务端签名变量：

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

先发布预览：

```bash
npx netlify status
npx netlify deploy
```

确认正常后发布正式版本：

```bash
npx netlify deploy --prod
```

## 安全说明

- 所有公开 schema 中的用户数据表都开启了 RLS。
- Netlify 文件操作使用调用者的 Supabase JWT 和最小权限的 security-definer RPC；Netlify 不需要保存 Supabase service-role key。
- 登录用户策略始终包含所有权判断。
- 匿名角色不能直接读取私有文件、文字或分享记录。
- Storage bucket 保持 Private。
- Secret/service-role keys 只能存在于服务端。
- 管理员权限来自 `admin_users`，不依赖 `user_metadata`。
- 公开分享使用高强度 UUID 能力令牌和短时文件地址。
- 文字快传仅同一登录账号可见，不会自动变成公开分享。

## 项目结构

```text
src/
  App.tsx                 登录和云盘主界面
  QuickTextCenter.tsx     跨设备私密文字快传
  ShareCenter.tsx         分享管理
  PublicShareView.tsx     公开分享页面
  AdminApp.tsx            服务端授权的管理后台
  lib/                    Supabase、云盘、上传、分享和文字工具
netlify/functions/        可选签名下载函数
supabase/functions/       管理员和公开分享 Edge Functions
supabase/migrations/      数据库、RLS、Storage 和 Realtime 迁移
```

## 问题申报

问题申报邮箱：[raimanncostigan@gmail.com](mailto:raimanncostigan@gmail.com)

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

文件由浏览器直接上传到 Supabase Storage，不经过 Netlify Function，因此大文件不会受到 Serverless 请求体、响应体或执行时间限制。

## 主要功能

- 邮箱密码注册、登录、退出和会话自动续期
- 每位用户独立的私有文件与文件夹空间
- 文件夹导航、列表/网格视图、搜索、排序和容量统计
- 拖拽上传和多文件上传
- 基于 Supabase TUS 的 6 MiB 分片上传
- 暂停/继续、失败重试、上传进度和实时速度
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
  ├─ Supabase Storage TUS ── 浏览器直传与断点续传
  └─ /api/signed-download ── 可选 Netlify Function

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

Storage 对象路径固定为：

```text
<user-id>/<stable-upload-token>/<safe-file-name>
```

Postgres RLS 和 Storage policies 都会校验所有权。即使前端代码被修改，也无法读取其他用户的数据或文件。

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Supabase Auth、Postgres、Realtime 和 Storage
- `@supabase/supabase-js`
- `tus-js-client`
- Lucide Icons
- Netlify 与 Netlify Functions

## 环境要求

- Node.js 22 或更高版本
- 一个 Supabase 项目
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
VITE_STORAGE_QUOTA_BYTES=1073741824
VITE_MAX_FILE_SIZE_BYTES=52428800
VITE_ADMIN_EMAIL=admin@example.com
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
- 用于文字快传的 Realtime publication
- 仅限服务端调用的管理员函数和权限

### 2. 部署 Edge Functions

管理员函数必须开启 JWT 验证：

```bash
npx supabase functions deploy admin-dashboard
```

公开分享使用不可猜测的能力令牌，因此允许没有用户 JWT 的请求：

```bash
npx supabase functions deploy public-share --no-verify-jwt
```

匿名用户不能直接读取 `shares` 表。函数只返回仍然有效的分享内容，不会公开用户邮箱、Storage 路径或服务端密钥。

### 3. 配置 Auth 地址

在 **Authentication → URL Configuration** 中加入：

- 本地开发：`http://localhost:5173/**`
- 正式网站：`https://xiaopan-drive.netlify.app/**`

### 4. 配置管理员

将规范化的小写管理员邮箱添加到 `admin_users`，再把同一邮箱配置到 `VITE_ADMIN_EMAIL`。

管理员入口只显示密码框，固定邮箱仅在内部用于 Supabase Auth 登录。真正的管理员权限来自服务端白名单，而不是前端邮箱字段或可编辑的用户元数据。不要把管理员密码写进源码。

## 大文件断点续传与限制

小盘按照 Supabase 当前 Storage 官方建议实现：

- 超过 6 MB 或网络不稳定时，推荐使用 TUS 可恢复上传。
- Supabase 当前要求 TUS 分片大小为 **6 MB**。
- 单个可恢复上传地址最长有效 **24 小时**。
- Free 方案的全局单文件上限最高为 **50 MB**。
- Pro 和 Team 方案最高可以设置为 **500 GB**。
- Bucket 限制不能高于项目的全局限制。

浏览器会在本地保存上传指纹。上传中断后重新选择同一个文件，即可从已经上传的位置继续。

官方资料：

- [可恢复上传](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Storage 文件限制](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Storage 访问控制](https://supabase.com/docs/guides/storage/security/access-control)

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
VITE_STORAGE_QUOTA_BYTES
VITE_MAX_FILE_SIZE_BYTES
VITE_ADMIN_EMAIL
```

可选的服务端签名下载变量：

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
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

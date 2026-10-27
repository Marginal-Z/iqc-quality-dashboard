# Cloudflare Access 登录接入

## 当前状态与边界

本仓库目前仍由 GitHub Pages 发布。公开 DNS 查询显示 `namecheap.xin` 的权威 nameserver 是 `ns7.alidns.com` 和 `ns8.alidns.com`，`iqc.namecheap.xin` 指向 `z-yo-yi.github.io`。因此当前生产域名还没有经过 Cloudflare Access；在完成下面的切换之前，网站仍是公开站点。

不要在静态 HTML 或 JavaScript 中增加固定用户名、密码或本地登录判断。这类页面无法验证登录身份，也无法阻止直接访问静态资源。Cloudflare Access 在边缘验证身份，计划使用邮箱一次性验证码，并仅允许 `@sharetronic.com`。

本地代码库不包含 `iqc-proxy.yyiqc1927.workers.dev` 的 Worker 源码。Access 保护看板主机后，仍须单独核实 QMS Worker 是否拒绝未授权的直接请求；CORS 来源限制本身不能作为身份验证。完成 Worker 鉴权前，不应声称 QMS 数据接口也受看板登录保护。

## 分阶段切换

1. 在 Cloudflare 将 `namecheap.xin` 加入一个**活跃 Zone**。在修改注册商 nameserver 之前，先从 AliDNS 导出并核对完整 DNS 区域，迁移所有现用记录，包括网站、验证 TXT、邮件 MX/SPF/DKIM/DMARC，以及其他子域和服务。不能仅凭公开 DNS 查询推断完整记录清单。仅在全部记录核实后，才在域名注册商处切换到 Cloudflare 分配的 nameserver，并验证 DNS 与邮件等现有服务。
2. 在 Cloudflare Workers & Pages 创建 Direct Upload 类型的 Pages 项目，项目名 `iqc-quality-dashboard`，生产分支 `main`。先部署无敏感数据的占位页面以创建项目；不要在 Access 规则就绪前上传真实看板数据。
3. 将 `iqc.namecheap.xin` 添加为 Pages 自定义域名并等待验证。Cloudflare 文档要求自定义域名属于活跃 Cloudflare zone；不要先对该主机启用 Access，再尝试添加到 Pages。按 Cloudflare Pages 页面显示的目标配置 DNS。
4. 为生产 `<project>.pages.dev` 配置 Access：在 Pages 项目 Settings 启用 access policy，在 Access Applications 里将应用主机从 `*.pages.dev` 通配符改为精确的生产 `<project>.pages.dev`；再回到 Pages 设置重新启用预览策略，让生产主机和预览主机分别受保护。为 `iqc.namecheap.xin` 另建 Self-hosted Access 应用与 Allow 策略。只允许 email domain `sharetronic.com`，并启用邮箱一次性 PIN 登录。验证未登录访问会跳到 Access，非公司邮箱被拒绝，公司邮箱可以登录。
5. 创建 Cloudflare API Token，仅授予该账户的 **Cloudflare Pages: Edit** 权限；在 GitHub 仓库 Actions 配置中新增 secret `CLOUDFLARE_API_TOKEN` 和 variable `CLOUDFLARE_ACCOUNT_ID`。不要把 token 发到聊天、提交到 Git 或写进工作流。
6. 在 GitHub Actions 以 `main` 为 ref 手动运行 **Deploy Cloudflare Pages**。只有确认 Pages 自定义域名和生产 `pages.dev` 主机均已由 Access 保护后，才勾选工作流的保护就绪确认项。
7. 在切换生产流量前，验证 Pages 页面、QMS 数据、刷新、大屏和退出登录行为；另行确认 Worker API 未认证请求被拒绝。再计划 GitHub Pages 下线与 DNS 切换，避免旧 `github.io` 页面成为绕过登录的公开副本。DNS 或发布切换若异常，应按维护窗口回滚到已验证记录。

任何名称服务器切换、GitHub Pages 下线或生产域名重新绑定都可能影响现有服务。目前没有 AliDNS 完整 Zone 导出、Cloudflare 活跃 Zone 状态或 Worker 源码证据；这些检查完成前不要执行最终切换。

## GitHub Actions 凭证

工作流只接受仓库 Actions Secret `CLOUDFLARE_API_TOKEN` 和 Actions Variable `CLOUDFLARE_ACCOUNT_ID`。Token 从 Cloudflare Account API Tokens 创建，权限范围选择 Account > Cloudflare Pages > Edit。Pages 项目必须先在 Cloudflare 控制台创建。部署工作流只允许手动从 `main` 运行，并要求操作者确认 Access 策略已就绪；该确认是流程护栏，不替代真实的访问测试。

## 官方说明

- [Cloudflare Pages 自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare Pages 预览部署与 Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Pages Access 已知限制](https://developers.cloudflare.com/pages/platform/known-issues/)
- [Cloudflare Pages Direct Upload 与 CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

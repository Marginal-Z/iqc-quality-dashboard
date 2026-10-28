# 独立账号登录部署与维护

## 当前部署记录（2026-10-28）

- 新站：[iqc-quality-dashboard.pages.dev](https://iqc-quality-dashboard.pages.dev/)，通过官方 Wrangler Direct Upload 部署。账户使用免费额度，未启用付费计划或 Access。
- 正式 D1：`iqc-auth`，绑定名称 `AUTH_DB`；现有 `iqc-proxy` 通过 `QMS_PROXY` 服务绑定连接。生产配置记录在仓库根目录 `wrangler.jsonc`，其中数据库 ID 不是认证凭据。
- 隔离云端测试通过 20 项检查，覆盖原生 scrypt、管理员/查看者权限、CSRF、密码重置、账号停用和会话撤销；隔离测试不绑定生产 QMS。
- 现有 QMS 内部绑定通过工厂字典及单页记录的只读请求验证。新站主域和独立部署 URL 均验证了未登录时拒绝页面资源和数据接口。
- 首个管理员由负责人在本地浏览器自行建立。原 `iqc.namecheap.xin` 域名、旧 GitHub Pages 和公开 QMS Worker 入口尚待完成切换，不能把新站已部署等同于旧公开入口已关闭。
- Cloudflare 已关联 `iqc.namecheap.xin`，当前等待外部 DNS 设置。现有权威 DNS 为 `ns7.alidns.com` / `ns8.alidns.com`；待新站初始化及验证完成后，仅将 `iqc` 的 CNAME 从 `z-yo-yi.github.io` 改为 `iqc-quality-dashboard.pages.dev`，不改主域名称服务器。DNS 服务商账号需由负责人在本地浏览器登录。
- 常规预览环境在 `wrangler.jsonc` 中明确不绑定数据库和 QMS，默认返回 503；测试时必须使用单独配置与临时账号库。
- 云端虚构账号测试部署和临时账号库已经删除；临时探测 Worker 已移除 QMS 服务绑定，并关闭公开 workers.dev 和版本预览 URL。

## 架构与边界

登录版运行在 Cloudflare Pages 的高级模式 `_worker.js`，使用 D1 保存用户、密码哈希、会话、尝试次数和审计记录。静态 GitHub Pages 版继续保留作迁移前的基线，不提供账号保护。

```text
浏览器 ── HTTPS + HttpOnly Cookie ── Pages Worker
                                      ├── AUTH_DB：D1 用户与会话
                                      ├── ASSETS：受保护看板资源
                                      └── QMS_PROXY：现有 iqc-proxy 服务绑定 ── QMS
```

登录不使用 Cloudflare Access，不要求接入 Zero Trust。免费产品受 Cloudflare 当前额度限制；不自动启用付费计划或超额付费。D1 不保存检验记录，只保存账号与安全状态。QMS 凭证继续保存在原 iqc-proxy 的 Worker Secrets 中。

## 安全行为

- 不提供公开注册或默认账号。维护人员使用一次性初始化链接，由负责人自行设置首个管理员密码。数据库初始化后永久关闭初始化入口。
- 用户名为 3–64 位 ASCII 字母、数字或 `. _ @ -`，不区分大小写。密码为 15–128 个 Unicode 字符，UTF-8 不超过 512 字节，不截断、不去空格；允许粘贴和密码管理器。
- 密码使用原生 `node:crypto` scrypt，参数 `N=32768, r=8, p=3`，随机 16 字节盐、32 字节派生值。数据库和日志不保存明文密码。
- 会话为 32 字节随机令牌，数据库仅保存令牌 SHA-256 哈希。正式 Cookie 为 `__Host-iqc_session; Secure; HttpOnly; SameSite=Strict; Path=/`，最长 7 天，连续 12 小时没有活动失效。
- 写操作要求同源 Origin 与会话 CSRF 令牌。登录和初始化要求同源 JSON；请求体上限 16 KiB。账号和客户端 IP 维度限制尝试次数，错误不区分未知、停用或密码错误的账号。
- 查看者可以访问业务看板；管理员可以新增、停用、启用账号及重置密码。不能停用当前管理员，服务端额外保证至少保留一位可用管理员。
- 停用、重置密码和个人修改密码会撤销该账号所有会话。退出登录撤销当前会话，并通知同源其他标签页退出。
- 登录版不向 localStorage 保存 QMS 工厂列表或检验快照，退出时清理旧版本业务缓存。界面语言偏好可继续保存。会话和密码不写入 Web Storage。
- 仅转发工厂字典和检验记录查询两个现有 QMS 路径。浏览器 Cookie、会话令牌和 CSRF 令牌不会转发给 QMS Worker。
- 登录与初始化审计只记录用户 ID、动作和时间，登录时清理 90 天前记录及过期会话、限流项。无邮件重置功能；用户忘记密码由管理员重置。所有管理员不可用时，维护人员通过 D1 恢复已有管理员，不能重新开放初始化替代恢复。

## 部署准备

需要已有 Cloudflare 账号和 `iqc-proxy` Worker。新建 Pages 项目，例如 `iqc-quality-dashboard`，构建命令 `node scripts/build-auth.mjs`、输出目录 `dist-auth`。可使用仅授权此仓库的 Git 集成，或使用 Wrangler Direct Upload；Pages 项目创建后不能把 Direct Upload 项目直接转换为 Git 集成项目，应在首次创建前确定方式。

在 Pages 的生产环境配置：

| 项目 | 值 |
| --- | --- |
| Compatibility date | `2026-10-28` 或经过验证的更新日期 |
| Compatibility flags | `nodejs_compat` |
| D1 binding | `AUTH_DB`，绑定独立生产数据库，例如 `iqc-auth` |
| Service binding | `QMS_PROXY`，指向现有 `iqc-proxy` 的生产环境 |
| 变量/Secret | `SETUP_TOKEN_HASH`，一次性初始化令牌的 SHA-256 十六进制哈希 |

预览环境不能绑定生产 D1，也不要绑定真实 QMS；若需账号预览，建立独立测试库和虚构数据服务。未绑定 `AUTH_DB` 时所有入口返回 503，避免未配置就公开看板。

在 PowerShell 7 或 WSL Ubuntu 执行（数据库名必须替换为实际创建名称）：

```sh
pnpm install --frozen-lockfile
node scripts/check.mjs
node --test tests/*.test.cjs
node scripts/build-auth.mjs --init
pnpm exec wrangler d1 execute iqc-auth --remote --file server/schema.sql
```

`--init` 在被 Git 忽略的 `.wrangler/first-admin-token.txt` 生成随机一次性令牌，只把哈希编入服务端构建。重复构建复用本机令牌，不会清空数据库或修改已建账号。也可由受控环境变量 `IQC_SETUP_TOKEN_HASH` 注入哈希，或用服务端 Secret `SETUP_TOKEN_HASH` 覆盖。常规后续构建不需要再次初始化。

严禁提交初始化令牌、数据库导出、OAuth 凭据、Cookie、密码或 `.wrangler/`。向负责人在本机浏览器打开 `https://<新站点>/setup#token=<一次性令牌>`；令牌通过 fragment 传递，不进入服务端 URL 日志，页面加载后立即清除地址栏。负责人自行填写并提交首个管理员密码，不在聊天中发送密码。初始化完成后清除本机一次性令牌文件和服务端初始化 Secret；数据库状态仍阻止再次初始化。

## 切换生产入口

1. 先在新站点验证免费账户实际运行时的 scrypt 登录、D1 读写、Cookie、未登录拒绝、查看者权限、停用/重置撤销和真实 QMS 只读查询；观察是否出现 Worker CPU 或额度错误。临时运行时的兼容性探测不能替代正式账户验证。
2. 在 Pages 添加 `iqc.namecheap.xin` 自定义域名，再将现有 DNS 服务商中的 `iqc` CNAME 改为 Pages 提供的目标。子域名可保留外部权威 DNS，不需要修改整个 `namecheap.xin` 的名称服务器。确认 HTTPS 和登录正常后再继续。
3. 禁用原 `iqc-proxy` 的公开 workers.dev URL、预览 URL 和其他公开路由，只保留新 Pages 的服务绑定访问。必须同时检查 Worker 的路由和自定义域名，不能仅用 CORS 代替认证。
4. 关闭旧 GitHub Pages 发布入口，防止绕过登录使用旧公开站点。旧缓存或旧 JS 中的代理地址应已无法访问业务数据。
5. 分别验证 `pages.dev`、自定义域名、部署预览域名都要求登录；原 Worker 公开 URL 不再返回 QMS 数据。完成这些检查才能宣称正式启用登录。

## 更新、回滚和故障处理

`.github/workflows/ci.yml` 验证两种构建；原 GitHub Pages 发布工作流和 CNAME 文件已从源码移除，避免恢复未认证站点。正式发布使用经授权的 Cloudflare Pages Direct Upload；`dist/` 仅用于界面预览，不能代替 `dist-auth/`。

当前选择 Direct Upload，不额外申请 GitHub App 或 CI 部署密钥。后续在已经通过 CI 的提交上，通过已授权的官方 CLI 发布。在 PowerShell 7 或 WSL Ubuntu 中执行：

```sh
pnpm install --frozen-lockfile
node scripts/check.mjs
node --test tests/*.test.cjs
node scripts/build-auth.mjs
pnpm exec wrangler pages deploy dist-auth --project-name iqc-quality-dashboard --branch main
```

常规更新不使用 `--init`，不重新创建或清空 D1；已经初始化的管理员和会话保留。Windows CLI OAuth 凭据使用系统凭据管理器加密存储，不能复制进仓库或 GitHub Secrets。若官方 CLI 的本机回调不可用，可使用 `wrangler login --device --use-keyring` 在独立浏览器标签页完成官方设备授权；只申请实际需要的账户读取、Pages、D1 和 Worker 脚本权限。

数据库采用可重复执行的初始 schema。后续增加字段应使用版本化迁移，先检查 D1 Time Travel/备份能力和可恢复点；不得为了更新界面删除数据库。常规前端更新不应重建数据库、不应更换 QMS 凭证。

部署失败可回滚 Pages 上一认证版本；数据库结构变化需评估兼容性。认证服务故障时保持拒绝访问，不恢复未登录公开接口。`/healthz` 返回服务与初始化状态，不含业务数据；接口失败日志只记录路径和错误类别，不能开启请求体或认证信息日志。

## 本地验证

在 PowerShell 7 或 WSL Ubuntu 执行：

```sh
node scripts/serve-auth.mjs
```

本地服务只监听 `127.0.0.1:8767`，使用 Node SQLite 内存库和虚构空 QMS 响应。终端给出本机初始化链接。停止后账号清空，不要使用正式密码。测试 Cookie 仅在 `LOCAL_DEV === true` 且 HTTP localhost 时使用无 Secure 的独立名称，不能把此设置用于线上。

`tests/auth.test.cjs` 用真实 SQLite 语句和事务验证认证、权限、会话撤销、一次性初始化及网关约束；还需在 Cloudflare Workers 实际运行时验证兼容性、绑定和免费额度，不把本机成功等同于上线成功。

参考：[Pages 高级模式](https://developers.cloudflare.com/pages/functions/advanced-mode/)、[服务绑定](https://developers.cloudflare.com/pages/functions/bindings/)、[自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

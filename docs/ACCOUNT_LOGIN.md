# 独立账号登录部署与维护

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

现有 `.github/workflows/ci.yml` 验证两种构建；GitHub Pages 工作流只发布静态 `dist/`，不会发布认证后端。认证版上线后应使用选定的 Pages Git 集成或经授权的部署工作流，并停止旧 Pages 工作流发布。不要把两种产物混用。

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

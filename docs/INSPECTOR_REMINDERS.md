# 飞书检验员待检提醒

## 提醒规则

后台每分钟检查所选工厂的待检任务（QMS 状态 `0`、`2`），完整分页成功后才生成私信。时间以 `Asia/Bangkok`（UTC+7，泰国时间）为准，不依赖浏览器打开，也不采用浏览器缓存。

- 每位已映射的飞书用户，在当天首次检测到其有待检任务时提醒一次。同一 Open ID 的多个姓名或工厂映射合并为一条私信。
- 当天后续新增物料不重复提醒；次日仍有待检任务时再次提醒。空任务不占用当天提醒次数。
- 每日开始检查时间默认 `00:00`，可调整以避免夜间通知。例如设为 `08:00`，当天第一次成功检查到存量或新增任务时发送，之后仍遵守一天一次。
- 启用时已经存在的待检任务会进入当天首次提醒；当天提醒成功后修改映射或关闭再开启，不会重发给同一飞书用户。
- 未映射姓名、未分配任务只在预览中提示，不发送给其他人。姓名必须与 QMS 完全匹配；Open ID 必须来自当前飞书应用，不能使用其他应用的 Open ID、手机号或 user ID 替代。
- 私信包含泰国日期、检验员、工厂、待检/加急/超时数量和最多 15 条物料明细，以及需要账号登录的看板链接。正文使用中文，管理页面支持中文、英文、泰文。

计划任务和上游请求存在调度、网络延迟，所以这是每分钟检查的提醒，并非 QMS 事件实时推送。所有已选工厂完整查询失败时，本轮不发送部分结果。单轮最多发送 20 人，剩余人员由后续轮次处理；配置最多 50 条姓名映射。

## 首次配置

1. 企业管理员在 [飞书开放平台](https://open.feishu.cn/app) 创建或选择企业自建应用，开启机器人能力；按飞书流程申请 `im:message:send_as_bot` 权限，配置应用可用范围并发布，使目标检验员可使用机器人。群自定义机器人的 Webhook 不支持本功能的逐人私信。
2. 按 [飞书 Open ID 指南](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-obtain-openid) 获取检验员在该应用下的 `ou_...` Open ID。人员与应用可用范围由企业管理员确认；不需要为了发送消息给本应用额外授予全员通讯录读取权限。
3. 用看板管理员账号登录，在右下角设置选择 **机器人提醒**，或打开 [提醒配置页](https://iqc.namecheap.xin/reminders)。填写 App ID、App Secret，选择工厂，填写“QMS 检验员姓名 → 飞书 Open ID”映射，保持停用并保存。
4. 点击 **检查连接**，验证应用凭据。此操作仅获取应用访问令牌，不发送消息；凭据通过不等于机器人权限、发布状态和接收者可达性均已验证。
5. 点击 **预览待检提醒**，核对每条消息的接收者、姓名和物料范围。预览是只读查询，不会发送，也不会消耗当天提醒次数。未映射任务需要补齐正确映射。
6. 确认后勾选启用并保存。下一次成功后台检查会按规则发送真实私信。在发送记录查看确认结果；首次启用后应由对应检验员确认实际收到消息。

App Secret 由管理员直接填入 HTTPS 管理页面；不在聊天、截图、代码、工单或终端中传递。保存后输入框清空，页面不会回读密钥。空输入表示保留现有密钥；更换应用或 Secret 后必须重新检查连接。没有真实应用配置和实际发送确认时，不应宣称已完成飞书联调。

## 状态与故障处理

| 状态 | 含义与处理 |
| --- | --- |
| pending / sending | 已建立当天发送记录，等待或正在发送 |
| sent | 飞书接口返回成功及消息 ID，已清除持久化消息正文；是否被阅读由飞书客户端决定 |
| retry | 可重试错误；保存原正文和同一 UUID，指数退避，最多尝试 6 次 |
| failed | 明确拒绝或未成功；检查应用权限、发布、可用范围、Open ID 和错误代码，修正并保存配置后可重试当天明确失败的记录 |
| uncertain | 无法确认是否已送达，停止自动重试，人工联系接收者确认；不会因重新保存配置而重发 |
| cancelled | 尚未尝试发送的任务已不在当前有效待检范围内 |

“最近检查”显示后台成功查询或失败时间；停用、每日开始时间之前不会持续更新时间。页面点击刷新记录才重新读取，页面本身不自动刷新管理信息。

飞书 UUID 在一小时内去重。本功能固定正文及 UUID，并把重试窗口限制为首次尝试后的 55 分钟；超窗未知结果不换 UUID 重发。数据库锁避免并发轮次同时取得同一任务。飞书确认成功但数据库写回失败也沿用原 UUID 重试。不存在跨飞书和数据库的原子事务，无法保证未知结果最终必达；优先防止重复骚扰。

确认停用后，新的发送领取会被数据库拒绝；正在执行的外部请求可能已送达。紧急停止可先停用，必要时再撤销飞书应用发送权限或关闭该 Worker 的 Cron，不要删除账号库或 QMS Secret。

错误仅记录类别或飞书数字代码，不记录访问令牌、App Secret、请求正文或上游私有错误详情。保存冲突提示配置已改变时，刷新读取新版本后重做修改，避免覆盖其他管理员。

## 部署结构与密钥

```text
管理员 → 受保护的 Pages /api/admin/reminders
            └── REMINDERS 内部绑定 + 服务密钥 → iqc-inspector-reminders
                  ├── Cron：每分钟
                  ├── REMINDER_DB：独立 D1 iqc-reminders
                  ├── QMS_PROXY：现有 iqc-proxy 内部绑定
                  └── 飞书官方 HTTPS API：应用令牌与机器人私信
```

提醒 Worker 的 `workers_dev` 和版本预览 URL 均关闭，无公开路由；内部接口还要求独立服务密钥和管理员标识。Pages 验证管理员权限、同源 Origin 和 CSRF 后才转发，不向内部 Worker 透传登录 Cookie。飞书应用密钥与待发正文采用 AES-256-GCM 加密存入独立 D1；发送成功或最终失败后清除正文，去重记录保留 90 天。姓名、Open ID、数量和错误状态属于业务元数据，仅管理员可见。

| 绑定 / Secret | 所在服务 | 用途 |
| --- | --- | --- |
| REMINDERS | Pages | 内部调用 `iqc-inspector-reminders` |
| REMINDER_GATEWAY_SECRET | Pages 与提醒 Worker，相同值 | 私有服务鉴权 |
| REMINDER_ENCRYPTION_KEY | 仅提醒 Worker | 随机 32 字节 Base64 AES 密钥 |
| REMINDER_DB | 提醒 Worker | 独立提醒设置与发送记录 |
| QMS_PROXY | 提醒 Worker | 内部只读访问现有 QMS 代理 |

数据库 ID、绑定名称可提交；密钥值不得提交。初次运行 `scripts/provision-reminders.mjs` 通过官方 CLI 标准输入配置随机密钥，不把值写入仓库。重复运行保留现有加密密钥；发现密钥缺失而数据库仍有密文时停止，要求恢复原密钥。服务网关密钥仅在一端缺失时重新配对；重新配对后需重新部署 Pages。

加密密钥必须保留在受控的密码管理或密钥恢复流程中。Cloudflare Secret 不能直接回读；数据库备份不能替代加密密钥备份。**不得在普通发布时重新生成加密密钥**；有密文时轮换需执行受控的解密重加密迁移，本项目没有自动轮换工具。现有 QMS 凭据和账号库独立管理，不由本功能初始化脚本修改。

## 发布与回滚

以下命令在 **PowerShell 7 或 WSL Ubuntu** 的项目根目录执行，需安装锁定依赖并通过官方 Wrangler 登录。当前 Windows 环境使用 PowerShell 7；不在旧版 Windows PowerShell 5.1 中执行。

首次部署新环境先创建独立数据库，将返回 ID 填入 `wrangler.reminders.jsonc`。不要复用 `iqc-auth`，不要对现有账号库执行提醒 schema：

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler d1 create iqc-reminders
pnpm exec wrangler d1 execute iqc-reminders --remote --config wrangler.reminders.jsonc --file server/reminders/schema.sql
pnpm exec wrangler deploy --config wrangler.reminders.jsonc
node scripts/provision-reminders.mjs
```

该 schema 用于首次建库。后续结构变化使用版本化迁移，先确认备份与可恢复点，不通过删除表或重建库完成升级。首次部署默认停用，在管理员保存启用前 Cron 不查询 QMS 或发送飞书消息。

常规更新在已通过 CI 的提交上执行，不重复建库和初始化密钥：

```sh
node scripts/check.mjs
node --test tests/*.test.cjs
node scripts/build.mjs
node scripts/build-auth.mjs
pnpm exec wrangler deploy --config wrangler.reminders.jsonc --dry-run
pnpm exec wrangler deploy --config wrangler.reminders.jsonc
pnpm exec wrangler pages deploy dist-auth --project-name iqc-quality-dashboard --branch main
git diff --check
```

新环境还需按账号指南建立 Pages/AUTH_DB；现有正式环境保留账号及 QMS。默认预览不绑定正式服务和数据库，不能用预览部署触发正式提醒。Cron 变更可能需要 [最多 15 分钟传播](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。发布后检查匿名拒绝、查看者拒绝、管理员页面、连接检查、真实只读预览、Cron 最近检查及实际发送记录；本机或云端模拟成功不替代真实飞书联调。

回滚前在管理页停用提醒，回滚提醒 Worker 和 Pages 至兼容版本，保留 D1、加密密钥及每日去重记录。不要回滚为公开静态站，也不要把本仓库代码部署到原 `iqc-proxy`。

## 额度与验证

单轮 QMS 请求预算 24，最多 20 条消息；D1 批量入队只计一次查询，最多 50 个映射下单轮不超过 48 次数据库调用。超过分页预算或上游数据不完整会停止该轮并显示错误，不发送截断结果。Worker/D1 仍受免费计划的 CPU、请求、读取行数和写入行数等限制；观察运行日志与用量，不自动升级付费计划。大工厂或多工厂持续超预算时需单独评估，不能简单删掉完整性检查。

验证覆盖权限、CSRF、服务鉴权、密钥不回读、完整分页、按人隔离、泰国午夜、空任务、并发领取、重试 UUID、未知结果和停用。2026-11-12 的隔离云端验证使用 300 条虚构任务、7 名虚构检验员，15 项检查通过；真实 D1 和 Worker 运行时验证，不连接真实 QMS 或飞书，测试资源在验证后清理。管理界面在桌面和手机宽度验证，并检查中英泰语言切换。

官方参考：[飞书私信接口](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[应用访问令牌](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)。

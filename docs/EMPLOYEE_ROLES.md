# 员工检索与通知角色

管理员从设置中心分别进入 **QC 通知员工**（`/settings/qc`）和 **仓库通知员工**（`/settings/warehouse`）。原 `/settings/employees` 与 `/reminders` 链接继续进入 QC 管理。查看者不能访问人员、通讯录和通知管理接口。

## 添加与编辑

1. 点击对应角色的添加按钮，输入飞书姓名，从公司通讯录的搜索结果中选中员工。
2. QC 可分别选择新待检任务、手动急料提醒；QMS 姓名不同可展开别名设置，每行一个姓名。同一 QMS 姓名不能绑定给两个人。
3. 仓库员工可分别选择合格、特采、退货结果；当前完成通知的数据源仍限泰国工厂。
4. 保存后生效。可以编辑功能、停用或移除该角色；同一人在另一个角色的配置和其他员工保持独立。

通讯录可检索不等于订阅通知。只有明确添加并启用的接收者才会收到所选通知。启用通知必须至少选择一个功能；新增或重新启用仓库人员先建立自己的基线，不补发历史结果。每个工厂与接收账号只能有一个仓库绑定，目前最多 20 位仓库接收者。QC 保留最多 50 条 QMS 姓名映射的现有上限。

选择和保存使用服务端验证的飞书姓名与 Open ID，不接受浏览器提交的任意显示姓名。编辑时账号与工厂锁定，变更接收身份请新增绑定。保存带版本检查，遇到其他管理员修改需刷新后重新编辑。

## 公司通讯录

使用飞书既有应用身份只读权限：`contact:contact.base:readonly` 与 `contact:user.basic_profile:readonly`。通讯录数据权限必须覆盖需要检索的员工，机器人可用范围必须覆盖需要通知的员工；代码不能越过飞书授权。若配置为数据范围跟随应用可用范围，公司级检索需要企业管理员将可用范围发布为全体成员。扩大范围可能产生应用使用邀请和企业审核，不会自动添加看板接收者。

独立私有 Worker `iqc-feishu-directory` 每分钟通过服务绑定调用 `DirectorySource.sync()`，分批枚举授权人员及部门，再获取姓名。每次调用最多 8 次飞书读取，每轮最多两次调用；通讯录任务不会占用检验任务提醒的轮询。默认每天重建一次，可点击“同步飞书通讯录”提前更新。

姓名查询在服务端执行，每次返回最多 30 位候选，重名可通过附加信息区分。索引只保存姓名、英文姓名和应用内 Open ID，不保存手机、邮箱或人事字段。初次同步显示进度；重建失败时保留上次完整通讯录，保存员工时仍实时复核权限。当前保护上限为两万人员、两千部门，超限停止同步并报告，不把截断结果标记为完整。

## 现有环境升级

在 **PowerShell 7 或 WSL Ubuntu** 中执行。先备份 `iqc-reminders`，在仓库目录运行：

```sh
pnpm exec wrangler d1 execute iqc-reminders --remote --config wrangler.reminders.jsonc --file server/reminders/migrations/0004-role-policies.sql
pnpm exec wrangler d1 execute iqc-reminders --remote --config wrangler.reminders.jsonc --file server/reminders/migrations/0005-company-directory.sql
pnpm exec wrangler deploy --config wrangler.reminders.jsonc
pnpm exec wrangler deploy --config wrangler.directory.jsonc
node scripts/release-pages.mjs
```

0004 为原 QC 绑定增加默认功能策略，并将原仓库绑定、基线、观察记录和加密队列复制到按接收者隔离的新表。UUID、未知结果和重试状态保留；旧表不删除。迁移与切换期间应领取仓库运行租约，等在途发送完成后再复制，避免旧发送器在复制后继续写旧队列。切换成功后释放维护租约，核对通知开关、基线、队列和 Cron 最近检查。

0005 增加通讯录索引与同步游标。两个迁移均可重复执行，不改变现有凭据、账号、QMS 查询或提醒去重记录。新环境 `server/reminders/schema.sql` 已包含结构。提醒 Worker 必须先发布，确保具名 RPC 入口存在，再发布通讯录 Worker。两个 Worker 都不提供公开访问入口。

回退时需先停用通知并确认新仓库队列没有待发或未知消息；旧版本不读取按角色隔离的队列，不能直接切回旧发送器并重新补发。保留数据库和密钥，使用兼容队列的修复版本处理故障。

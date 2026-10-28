# IQC 来料检验看板

面向工厂质量团队的来料检验与供应商质量可视化平台。连接 QMS 检验数据，集中展示检验任务、质量指标与供应商风险，支持日常业务查看和车间大屏展示。

[![CI](https://github.com/Marginal-Z/iqc-quality-dashboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Marginal-Z/iqc-quality-dashboard/actions/workflows/ci.yml)

[在线访问](https://iqc.namecheap.xin/) · [快速开始](#快速开始) · [维护指南](docs/MAINTENANCE.md) · [更新日志](CHANGELOG.md)

## 项目概览

项目采用轻量级 HTML/CSS/JavaScript 前端，运行于 Cloudflare Pages。服务端验证账号和会话，通过内部服务绑定读取 QMS；ECharts 展示质量趋势与供应商分析，GitHub Actions 负责自动验证和构建。

| 模块 | 功能 |
| --- | --- |
| 质量总览 | 今日送检、待检、超时、合格率与加急指标，检验流转、质量趋势及异常预警 |
| 检验任务 | 按日期、状态、加急和关键词筛选，支持排序、分页、详情查看及 CSV 导出 |
| 供应商质量 | 供应商指标、月度趋势、风险矩阵、质量排名、风险列表与供应商详情 |
| 来料检验大屏 | 全部筛选任务连续循环滚动；检验结果、全部检验员待检统计和供应商排行三块等宽并排 |
| 供应商质量大屏 | 固定高度的图表与风险区域，列表在区域内部滚动，适用于持续展示 |
| 多工厂与多语言 | 支持切换工厂；通过右下角设置选择中文、英文、泰文和中泰双语 |
| 界面设置 | 原始浅色 UI；右下角设置集中管理语言，自动记住选择 |
| 账号与权限 | 管理员开通、停用、启用账号及重置密码；查看者访问看板；个人修改密码和退出登录 |

待检与超时任务每 30 秒轮询一次，月度统计每 5 分钟完整同步，也可手动刷新；页面在后台时暂停自动请求。当前为定时轮询，并非 QMS 事件推送。界面保留 QMS 返回的供应商名称、料号等业务原始信息，不自动翻译业务数据。

界面使用原始浅色背景与实色卡片，不提供额外主题或透明度调节，不使用渐变背景。环形统计图采用纯色 SVG 分段展示数据占比。

点击右下角 **设置** 可展开语言设置，普通页面及两种大屏均可使用，语言选择会自动保存。点击面板外部、关闭按钮或按 Escape 可收起设置。

## 技术架构

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| 页面与交互 | HTML、CSS、原生 JavaScript | 页面布局、筛选、状态管理与多语言 |
| 数据可视化 | ECharts | 趋势、排名及风险图表 |
| 账号服务 | Cloudflare Pages Worker、D1 | 账号、会话、权限与同源查询网关 |
| 接口代理 | 独立 Cloudflare Worker | 内部服务绑定访问 QMS，保存 QMS Secrets |
| 数据源 | QMS | 提供工厂字典与检验记录 |
| 检查与测试 | Node.js 内置工具 | 语法检查、资源校验与回归测试 |
| 持续集成与部署 | GitHub Actions、Cloudflare Pages | CI 验证，官方 Wrangler Direct Upload 发布 |

浏览器登录后向同源 `/api/qms` 发送查询条件，QMS 登录凭证保存在独立 Worker Secrets 中。本仓库包含前端、账号服务、数据库结构、测试及部署配置；QMS 代理仍独立部署，通过服务绑定访问。

## 快速开始

### 环境要求

- Git
- Node.js 22 或更新版本
- 支持现代 JavaScript、Canvas 与 Popover API 的新版浏览器

静态预览、测试和构建只需 Node.js。Cloudflare 登录版部署使用锁定版本的 Wrangler，可通过 pnpm 安装开发依赖。

### 独立账号登录版

独立登录版采用 Cloudflare Pages Functions + D1，提供管理员开通账号、查看者权限、停用账号、重置密码和个人修改密码；不依赖 Cloudflare Access。看板页面和同源 QMS 接口均由服务端验证会话，密码使用原生 scrypt 加盐哈希，浏览器通过 HttpOnly Cookie 登录。

登录版构建到 `dist-auth/`，仅用于 Cloudflare Pages 高级模式；`dist/` 用于界面静态预览。原 GitHub Pages 发布工作流和 CNAME 文件已经移除。详细配置、切换状态和恢复流程见 [账号登录部署指南](docs/ACCOUNT_LOGIN.md)。

在 PowerShell 7 或 WSL Ubuntu 中执行以下命令，可使用完全独立的虚构数据和内存数据库验证登录界面：

```sh
node scripts/serve-auth.mjs
```

终端会显示本机初始化链接。此入口不连接 QMS、不使用正式账号，停止进程后测试账号全部清空。不要在本机测试页面使用正式密码。

### 获取代码并启动

```sh
git clone https://github.com/Marginal-Z/iqc-quality-dashboard.git
cd iqc-quality-dashboard
node scripts/serve.mjs
```

上述命令在 PowerShell 7 或 WSL Ubuntu 中执行。启动后访问 [本地测试看板](http://127.0.0.1:8765/__test__/)，使用虚构数据验证界面。静态预览不提供服务端登录或真实 QMS 接口；完整账号流程使用前述 `serve-auth.mjs` 测试入口。

如需使用其他端口：

```sh
node scripts/serve.mjs 8766
```

### 使用测试数据

访问 [本地测试页面](http://127.0.0.1:8765/__test__/)，可在不连接 QMS 的情况下查看页面并验证大数据量展示。

测试场景包含 6,000 条虚构记录、1,500 条待检任务和 300 家风险供应商，使用独立的内存缓存。测试入口与数据不会进入生产构建。

## 常用命令

在项目根目录的 PowerShell 7 或 WSL Ubuntu 中执行：

| 命令 | 说明 |
| --- | --- |
| `node scripts/serve.mjs` | 启动本地预览服务 |
| `node scripts/check.mjs` | 检查脚本语法、静态资源引用及前端凭证字面量 |
| `node --test tests/*.test.cjs` | 运行自动化回归测试 |
| `node scripts/build.mjs` | 生成静态站点构建产物 |
| `node scripts/build-auth.mjs` | 生成受保护的 Cloudflare Pages 构建产物 |
| `node scripts/serve-auth.mjs` | 使用内存账号库与虚构 QMS 响应预览登录流程 |
| `git diff --check` | 检查差异中的空白格式问题 |

静态预览输出位于 `dist/`，正式认证版输出位于 `dist-auth/`。两种产物均采用资源白名单；测试、文档、本地凭据和一次性初始化令牌不进入构建产物。

## 项目结构

```text
iqc-quality-dashboard/
├── .github/workflows/
│   └── ci.yml                 # 测试与两种构建验证
├── assets/
│   ├── dashboard.css          # 通用页面与供应商大屏样式
│   ├── incoming-wallboard.css # 来料大屏布局与尺寸适配
│   ├── dashboard.js           # 数据请求、业务统计与页面渲染
│   ├── ui-i18n.js             # 补充界面翻译与日期格式化
│   ├── settings.css           # 语言设置面板
│   └── wallboard.js           # 自动滚动与图表尺寸调度
├── auth/                      # 登录、首次初始化及账号管理界面
├── server/                    # 认证 Worker 和 D1 数据库结构
├── docs/                      # 维护及验证文档
├── scripts/                   # 预览、检查与构建脚本
├── tests/                     # 回归测试与本地测试数据
├── index.html                 # 页面入口
├── echarts.min.js             # 图表库
├── wrangler.jsonc             # 正式部署与隔离预览绑定配置
├── package.json               # 项目信息与命令入口
└── CHANGELOG.md               # 更新日志
```

## 配置与部署

### 数据接入

默认数据源配置位于 `assets/dashboard.js` 的 `QMS_CONFIG` 中，包括代理地址、QMS 接口地址和默认工厂。部署到其他环境时，应同步核对前端配置与 Worker 的上游设置。

账号、密码和认证密钥应仅在服务端配置，不应写入前端文件、提交记录或构建产物。当前前端无需填写 QMS 登录凭证。

### 自动发布

`main` 是正式源码分支。变更通过 Pull Request 与 CI 验证后合并，随后由 **Deploy Pages** 工作流执行检查、测试、构建和部署。

正式认证站使用 Cloudflare Pages Direct Upload，配置以 `wrangler.jsonc` 为准。生产域名为 [iqc.namecheap.xin](https://iqc.namecheap.xin/)，迁移和最新验证状态见 [账号登录部署指南](docs/ACCOUNT_LOGIN.md)。不再通过 GitHub Pages 发布；预览环境默认不绑定账号数据库或 QMS。

生产发布应使用完整构建产物，确保 HTML、CSS 和 JavaScript 来自同一版本。具体发布检查与回退方式见[维护指南](docs/MAINTENANCE.md)。

## 开发协作

1. 同步远程 `main`，创建独立开发分支。
2. 完成修改，并运行检查、测试和构建命令。
3. 涉及界面时，使用本地测试数据验证语言切换、筛选和大屏展示。
4. 更新相关文档，以 Conventional Commits 格式提交变更。
5. 推送分支并创建 Pull Request，说明变更范围与验证结果。

问题反馈可提交至 [Issues](https://github.com/Z-YO-YI/iqc-quality-dashboard/issues)。请说明页面、语言、工厂范围及复现步骤；涉及业务数据的截图应先脱敏。

## 数据口径与使用说明

- 指标与趋势依赖 QMS 返回的数据及字段，缺少上游字段时显示空状态，不生成替代业务数据。
- 部分 KPI 与排名图采用不同合格率统计口径，比较前应确认分母与统计范围。
- 季度和年度筛选当前分别表示滚动 3 个月与 12 个月。
- 大屏自动滚动支持鼠标悬停暂停；页面切到后台时暂停动画，系统启用“减少动态效果”时保留手动操作。

详细的统计口径、缓存机制和运维边界见[维护指南](docs/MAINTENANCE.md)；验证记录见[验证文档](docs/VALIDATION.md)。

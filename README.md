# 氨塔 · 升温还原监测

- **GitHub Pages 访问入口**：https://doathing.github.io/ammonia-monitor/
- **完整在线系统**：https://ammonia-reduction-monitor.windy915.chatgpt.site

GitHub Pages 托管 `docs/` 中的访问入口。登录、数据存储和编辑功能运行在独立云端服务。访问入口不会把监测数据或账号密码保存到 GitHub，也不改变现有服务的网络可达性。

## 功能

- 三床层温度、压力、两组水汽、速率和氨水的综合趋势。
- 自定义北京时间起止范围、全屏和 PNG 导出。
- 十段还原计划、实际阶段及完成偏差，原始计划快照保留。
- guest 只读、admin 编辑权限，服务端校验会话和角色。
- CSV / XLSX 导入、CSV 导出及版本1–6 JSON备份恢复。

## 源码与运行

此仓库是本地网页版源码的独立发布副本，包含当前 WorkBuddy Cloud 数据服务适配。原有 Sites 部署继续运行已发布的版本。前端位于 `public/static/`，接口位于 `app/api/`，计算、权限和存储位于 `lib/monitor/`。

完整程序需要支持 Cloudflare Worker / Vinext 的服务端运行环境及云数据库，不能仅靠 GitHub Pages 运行。仓库不包含生产密码、会话密钥、现场数据库、日志或本地环境变量。

使用 Node.js 22.13+：

```sh
npm ci
node --test tests/auth.test.mjs tests/monitor.test.mjs
npm run dev
```

部署前在本地忽略的 `.dev.vars` 或部署平台秘密变量中配置以下变量，`.env.example` 只列名称，不含真实值：

| 变量 | 用途 |
| --- | --- |
| MONITOR_GUEST_HASH | 查看账号的加盐PBKDF2校验值 |
| MONITOR_ADMIN_HASH | 编辑账号的加盐PBKDF2校验值 |
| MONITOR_SESSION_SECRET | 会话签名密钥 |
| MONITOR_PUBLIC_ORIGIN | 对外服务地址（需要时配置） |
| CLOUD_ENDPOINT | 云数据服务地址 |
| CLOUD_PUBLISHABLE_KEY | 服务端云数据服务凭据 |

不要将真实密码、环境文件或会话密钥提交到仓库。

## 验证

9项Node测试涵盖原Python计算结果对照、原子录入、备份兼容、账号权限、会话防篡改与过期。浏览器验收位于 `tests/`，仅在配置合成测试账号和独立测试数据库后运行。

## 更新网站入口

GitHub Pages 来源为 main 分支的 /docs。修改 `docs/index.html` 并提交即可更新入口。它不承载后端，账号和数据仍由完整在线系统提供。

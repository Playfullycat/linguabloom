# 运维手册：部署、备份恢复、升级回滚、故障排查

适用于用 Docker Compose 部署的 LinguaBloom。脚本都在仓库根目录运行，需要 bash（Linux / macOS 自带；Windows 可用 Git Bash）。

## 1. 部署结构

| 组成 | 说明 |
|---|---|
| `app` 服务 | Next.js 应用（standalone）。启动时先执行数据库迁移和种子导入，成功后才启动服务。以非 root 用户 `node` 运行，带 Docker 健康检查。 |
| `db` 服务 | PostgreSQL 18，时区 UTC。端口只绑定 `127.0.0.1`。 |
| `pgdata` 卷 | 数据库数据 |
| `appdata` 卷 | 用户文件（上传、录音、缓存），挂载在容器内的 `/app/data` |
| `/api/health` | 健康检查接口，返回应用版本和数据库状态（200 / 503） |

所有配置都来自 `.env`（模板：`.env.example`）。`.env` 不提交到 Git，也不会打进镜像。

## 2. 首次安装

1. 复制配置：

   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env`，修改 `APP_SECRET`、`POSTGRES_PASSWORD`、`APP_URL`。密码只用字母、数字、`-` 和 `_`，因为它会被拼进数据库连接串。

3. 启动：

   ```bash
   docker compose up -d --build
   ```

4. 打开 `APP_URL`，在初始化页面创建 owner 账户。

**在公网服务器上**：完成初始化之前，任何能访问页面的人都可能抢先创建账户。可以任选一种保护方式：

- 设置 `OWNER_SETUP_TOKEN=<随机值>`，初始化时需要输入这个口令；
- 或者先设 `OWNER_SETUP_ENABLED=false`，准备好时改为 `true` 并重启应用（`docker compose up -d`）。

初始化完成后，无论这两项怎么设置，初始化页面都会永久关闭。

## 3. HTTPS 与反向代理

推荐用 Caddy、Nginx 等反向代理提供 HTTPS：

1. 在 `.env` 里设 `APP_URL=https://你的域名`，cookie 会自动加上 `Secure`。
2. 设 `APP_PORT=127.0.0.1:3000`，让应用端口只对本机的反向代理开放。
3. 反向代理需要转发原始的 `Host` 头，并加上 `X-Forwarded-For`。登录失败次数限制按这个头识别客户端 IP。
4. 重启：

   ```bash
   docker compose up -d
   ```

Caddy 示例（`Caddyfile`）：

```text
lingua.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

HSTS 和 `upgrade-insecure-requests` 建议在反向代理上配置。应用本身的 CSP 不包含它们，以免纯 HTTP 的局域网部署失效。

**上传大小**：“我的材料”可以上传最多 50 MB 的音频。反向代理要放开请求体大小，例如 Nginx 设 `client_max_body_size 60m;`（Caddy 默认不限制）。

## 4. 日常运维

查看服务状态：

```bash
docker compose ps
```

查看应用日志：

```bash
docker compose logs -f app
```

检查容器、健康接口、数据库、磁盘空间和 AI 配置（不打印密钥）：

```bash
bash scripts/healthcheck.sh
```

重启应用：

```bash
docker compose restart app
```

停止所有服务（数据保留在卷里）：

```bash
docker compose down
```

> ⚠️ `docker compose down -v` 会**删除数据卷**，也就是全部学习数据。除非你确实要清空一切，否则不要加 `-v`。

## 4a. AI 服务（可选）

不配置 AI 时，所有非 AI 功能照常可用。在 `.env` 里设置后重启（`docker compose up -d`）即可启用：

| 变量 | 作用 |
|---|---|
| `AI_ENABLED` | `true` 启用 |
| `AI_PROVIDER` | `openai`（或兼容 OpenAI 接口的服务），或 `mock`：本地模拟，不联网、不花钱，适合先试界面 |
| `AI_API_KEY` | 只在服务器上使用，不会发到浏览器，也不会写进日志 |
| `AI_BASE_URL` | 可选，只填你信任的兼容服务地址 |
| `AI_TEXT_MODEL` | 文本模型名称，按服务商当前文档选一个便宜的小模型即可 |
| `AI_TIMEOUT_MS` / `AI_MAX_OUTPUT_TOKENS` | 超时和单次回复长度上限 |
| `AI_MONTHLY_BUDGET` | 月度软预算（美元）：用到 80% 时提醒，用完后 AI 暂停到下个月；设为 0 表示不检查 |
| `AI_TEXT_PRICE_INPUT_PER_1M` / `AI_TEXT_PRICE_OUTPUT_PER_1M` | 模型每百万 token 的价格，用来估算费用；不填时费用显示为未知，预算只按已知部分计算 |
| `AI_REALTIME_MODEL` | 实时语音模型（口语练习的“实时对话”）；不填时只有标准语音模式和文字回答 |
| `AI_TRANSCRIPTION_MODEL` | 语音转写模型（标准语音模式、朗读 / 跟读，也用于实时对话里的字幕）；不填时口语只能用文字回答 |
| `AI_TTS_MODEL` | 语音合成模型（标准语音模式里老师的声音、跟读的示范）；不填时用浏览器朗读 |
| `AI_VOICE` | 实时对话和语音合成用的声音，默认 `alloy`，要选两个模型都支持的 |
| `AI_REALTIME_MAX_MINUTES` | 一次实时对话的时长上限（分钟），默认 10，到时自动结束 |

“设置 → AI 服务”可以看到配置状态、本月请求数、token 和估算费用。用量记录只保存服务商、模型、任务类别、token、耗时和费用估算，不保存密钥和对话内容。`scripts/healthcheck.sh` 会检查 AI 配置是否完整。

AI 对话默认保存在你的数据库里，可以在 AI 辅导页逐条删除，或在设置里关闭保存、一键删除全部。

**口语练习与实时语音**：

- 浏览器只有在 **HTTPS 或 localhost** 下才允许用麦克风；局域网里用 `http://192.168.x.x` 访问时录音按钮会提示不可用，请按第 3 节配置 HTTPS。
- 实时对话：浏览器把 WebRTC 连接请求发给本应用，服务端用一个 60 秒、只用一次的临时凭证完成连接，浏览器拿不到任何密钥。之后语音在浏览器和服务商之间直接传输（UDP），所以服务器不需要额外开端口，但浏览器所在的网络要能访问服务商。公司网络或代理拦截 WebRTC 时，页面会提示连接失败，可以改用标准语音模式。
- 实时语音、转写和语音合成按音频计费，用量会记录，但费用显示为“未知”。实时对话有时长上限和连接次数限制（每次练习 3 次、每人每 10 分钟 6 次）。
- 用兼容服务（`AI_BASE_URL`）时，它不一定支持实时接口；不支持时不填 `AI_REALTIME_MODEL` 即可。

## 5. 备份

```bash
bash scripts/backup.sh
```

会生成 `backups/linguabloom-<UTC 时间>/` 目录：

| 文件 | 内容 |
|---|---|
| `database.dump` | PostgreSQL 自定义格式导出（`pg_restore` 可读） |
| `appdata.tar.gz` | `/app/data` 的全部文件 |
| `env.template` | `.env` 里的变量**名**（不含值和密钥） |
| `manifest.txt` | 创建时间、应用版本、Git 提交、已执行的迁移数、两个数据文件的 SHA-256 |

- **必须同时备份数据库和文件**：只有数据库会丢失上传的材料和录音；只有文件会丢失学习进度，以及“这些文件是什么”的记录。
- `.env` 本身（含密钥）不在备份里，请另外安全保存。恢复时需要同样的 `POSTGRES_*`；`APP_SECRET` 不同的话，所有设备需要重新登录。
- 备份包含个人学习数据，请存放在安全的地方，并在另一台设备或云盘上保留一份副本。
- 用 `BACKUP_DIR=/某个/路径 bash scripts/backup.sh` 可以改变输出位置。

**定时备份**示例（Linux cron，每天 03:30）：

```text
30 3 * * * cd /opt/linguabloom && bash scripts/backup.sh >> backups/backup.log 2>&1
```

Windows 可以用“任务计划程序”定时运行 `bash scripts/backup.sh`（Git Bash 的 `bash.exe`）。

## 6. 恢复

```bash
bash scripts/restore.sh backups/linguabloom-<时间>
```

脚本按以下顺序执行：

1. **先校验，不动数据**：检查文件是否齐全、SHA-256 是否匹配，以及 `pg_restore` 能否读取导出文件。任何一项失败都会直接退出，现有数据保持不变。
2. 要求确认（加 `--yes` 可跳过确认）。
3. 停止应用，用备份**替换**当前的数据库和 `/app/data`。
4. 启动应用；如果备份早于当前代码，缺少的迁移会在启动时自动补上。
5. 等待健康检查通过。

如果没有把握，恢复前先运行一次 `bash scripts/backup.sh`，保留当前状态。

**恢复演练**：大步 0.3 在一套独立的 Docker 部署上完整演练过：备份 → 删除全部数据卷 → 全新启动 → 恢复。之后账户可以登录，文件内容一致。建议在重要升级前自己再演练一次。

## 7. 升级与回滚

```bash
bash scripts/update.sh
```

依次执行：

1. `git pull --ff-only`（没有配置上游分支时跳过；加 `--no-pull` 也可跳过）；
2. 自动备份；
3. 构建新镜像；
4. 重启：新容器启动时执行迁移；
5. 等待健康检查，并运行 `scripts/healthcheck.sh`。

升级失败时，脚本会打印回滚步骤：

1. `git checkout <升级前的提交>`；
2. `docker compose up -d --build`；
3. 如果新版本已经迁移了数据库、而旧版本无法使用：`bash scripts/restore.sh <升级前自动生成的备份>`。

迁移只增不改：已经发布的迁移文件不再修改，结构变化总是通过新的迁移文件完成。

## 8. 忘记密码

在服务器上运行，按提示输入两次新密码（输入时不显示）：

```bash
docker compose exec app node ops/reset-owner-password.mjs
```

也可以通过管道传入密码，适合脚本使用：

```bash
printf '%s' '新的密码' | docker compose exec -T app node ops/reset-owner-password.mjs
```

密码不会出现在命令参数或 shell 历史里（管道方式要注意终端本身的历史记录）。重设后，所有设备都会退出登录。本地开发环境用 `npm run owner:reset-password`。

## 9. 故障排查

| 现象 | 原因与处理 |
|---|---|
| `docker compose up` 提示 `set APP_SECRET in .env` 之类 | `.env` 缺少必填变量。对照 `.env.example` 补全。 |
| 应用容器反复重启，日志里有 `migrations failed` | 数据库连接或迁移失败。看日志中的具体错误；确认 `POSTGRES_PASSWORD` 没有特殊字符。 |
| 日志里有 `password authentication failed` | 数据库卷已经存在时又改了 `POSTGRES_PASSWORD`。数据库密码只在第一次创建卷时生效：把密码改回原值，或进入数据库修改密码。 |
| `Invalid environment configuration` | 环境变量格式不对，错误信息会列出具体变量（不会打印密钥的值）。 |
| 页面能打开，但一直跳到初始化页 | 数据库里还没有 owner，属于正常的首次运行流程。如果明明初始化过，检查是否误用了 `down -v`，或连到了另一套数据卷（比如不同的 `COMPOSE_PROJECT_NAME`）。 |
| 初始化页提示“初始化已关闭” | `OWNER_SETUP_ENABLED=false`。改为 `true` 后运行 `docker compose up -d`。 |
| 登录后马上又回到登录页 | 浏览器访问的地址和 `APP_URL` 不一致，或者通过 HTTP 访问时设置了 `https://` 的 `APP_URL`（Secure cookie 不会被保存）。 |
| 提示“尝试次数太多了” | 连续输错密码触发了临时锁定，15 分钟后自动解除；重启应用也会清零。 |
| 端口被占用 | 修改 `.env` 里的 `APP_PORT` 或 `DB_PORT`，然后运行 `docker compose up -d`。 |
| `docker pull` / 构建时卡住不动 | 网络或代理问题。中断后重试；必要时在 Docker Desktop 里配置代理或镜像加速。 |
| Windows 上运行脚本时路径错误 | 请用 Git Bash 运行。脚本已关闭 Git Bash 的路径自动转换（`MSYS_NO_PATHCONV=1`）。 |

仍然解决不了时，收集以下信息再排查：

```bash
docker compose ps
```

```bash
docker compose logs --tail 200 app
```

```bash
bash scripts/healthcheck.sh
```

日志里不会包含密码、密钥或会话 token。

## 10. 数据与隐私

- 所有数据都保存在你自己的机器上：`pgdata` 和 `appdata` 两个卷。
- 应用不发送遥测；认证库的遥测已显式关闭。
- 要彻底删除全部数据并重置系统：`docker compose down -v`。这会删除两个卷，不可恢复，请先备份。
- 导入的文件（音频）保存在 `appdata` 卷的 `media/<用户 id>/` 下，只能由上传者通过登录后的 `/api/media/…` 访问，会一起进入备份。在“我的材料”里删除一份导入的材料，会同时删除它的音频文件和你在上面的学习记录。
- 本地不用 Docker 运行时，上传文件放在 `STORAGE_ROOT`（默认项目下的 `data/`，已被 git 忽略）；E2E 测试用 `data/e2e/`。
- 使用 AI 时，你的消息和必要的学习上下文会发送给你配置的 AI 服务商（页面上写明了发送哪些内容）。不配置 AI 就不会有任何数据发出去。
- 口语练习开始前会说明：声音会发给哪个 AI 服务、是否保存转录、是否保存录音。录音默认不保存；保存的录音放在 `appdata` 卷的 `media/<用户 id>/` 下（只录你自己的麦克风），只有本人能听，会进入备份。可以在练习结果页删除录音或整次练习，或在“设置 → AI 服务”里改默认值、全部删除。删除录音会同时删除文件和数据库记录。

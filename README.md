# Gemini Balance Edge
## Gemini API 代理和智能负载均衡无服务器边缘函数

## 🚀 项目简介

Gemini Balance Edge 是一个部署在 Vercel Edge Network 上的高性能 API 代理。它不仅能将对 Gemini API 的请求在国内进行中转，还实现了一套智能的负载均衡机制，旨在最大化多个 API Key 的使用效率和稳定性。

### ✨ 核心功能

- **平滑加权轮询（SWRR）**：通过 "key:weight" 配置权重，分配更平滑、无需构造大权重数组
- **健康管理（内存态）**：
  - 仅在 401/403（鉴权失败）时将对应 Key 标记为“不健康”
  - 其他错误（含 4xx/429/5xx/网络异常）不直接标记不健康
  - 后台周期性健康检查，恢复可用 Key
- **OpenAI 兼容层**：
  - 支持路径：/chat/completions、/embeddings、/models
- **CORS 与预检**：
  - 顶层统一处理 OPTIONS 预检
  - 所有响应附加 Access-Control-Allow-Origin: *
  - SSE 响应设置 text/event-stream、keep-alive 等必要头
- **安全与日志**：
  - 日志默认脱敏 Authorization、x-goog-api-key、Cookie 等敏感头
  - 默认不记录大响应体，仅在 DEBUG 时定位问题
- **/verify Key 校验**：
  - SSE 流式返回每个 Key 的校验结果
  - 附带心跳与开始/结束注释帧，改善前端体验

## 环境变量

- GEMINI_API_KEY：服务器侧 Key 列表，逗号分隔；支持权重格式 key:weight，例如 key1:10,key2:5,key3
- AUTH_TOKEN（可选）：服务访问令牌。启用后：
  - 客户端可用 Authorization: Bearer <AUTH_TOKEN> 或 x-goog-api-key: <AUTH_TOKEN> 请求服务端密钥池
  - /verify 需 Authorization: Bearer <AUTH_TOKEN> 才可访问
- GEMINI_BASE_URL（可选）：Gemini API 基址，默认 https://generativelanguage.googleapis.com
- GEMINI_API_VERSION（可选）：Gemini API 版本，默认 v1beta
- LOG_LEVEL（可选）：ERROR|WARN|INFO|DEBUG，默认 INFO

## 部署方案

### Vercel 部署 (推荐)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/muskke/gemini-balance-edge)

1.  点击上方的 "Deploy" 按钮。
2.  在 Vercel 的项目设置中，添加环境变量（见下文）。
3.  路由说明：`vercel.json` 现采用统一入口——
   - `/verify` → `/api/verify.js`
   - `/(.*)` → `/api/vercel_index.js`
4.  在 Vercel 的项目设置中，找到 "Environment Variables" 选项，添加你的 API Key。
    *   **变量名**: `GEMINI_API_KEY`
    *   **值**: 你的 API Key。多个 Key 请用逗号隔开。
    *   **带权重的 Key**: 你可以为 Key 设置权重，格式为 `key1:10,key2:5,key3`。权重越高的 Key 被使用的频率越高。没有设置权重的 Key 默认为 1。
3.  **关联 Vercel KV**:
    *   在 Vercel 项目的 "Storage" 标签页中，创建一个新的 KV 数据库。
    *   将其连接到您的项目。Vercel 会自动添加所需的 `KV_` 环境变量，用于状态持久化。
4.  国内使用需要配置自定义域名。
5.  (可选) 如果你需要代理到非官方的 Gemini API 端点，可以额外配置 `GEMINI_BASE_URL` 和 `GEMINI_API_VERSION` 环境变量。

### Netlify 部署
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tech-shrimp/gemini-balance-edge)

*注意：Netlify 平台不支持 Vercel KV，因此状态持久化和健康检查功能将不可用。*

1. 点击部署按钮，登录Github账户即可。
2. 在 Netlify 的项目设置中，找到 "Build & deploy" -> "Environment" 选项，添加你的 API Key。变量名为 `GEMINI_API_KEY`，值为你申请到的 Key。如果你有多个 Key，可以用逗号隔开。
3. 免费分配域名，国内可直连（但是不稳定）。
4. （可选）如果你需要代理到非官方的 Gemini API 端点，可以额外配置 `GEMINI_BASE_URL` 和 `GEMINI_API_VERSION` 环境变量。
5. 去[AIStudio](https://aistudio.google.com)申请一个免费Gemini API Key
<br>将API Key与分配的域名填入AI客户端即可使用，如果有多个API Key用逗号分隔

### Deno 部署 (推荐用于 Function Calling)
[![Deploy to Deno](https://shield.deno.dev/deno/deploy)](https://dash.deno.com/new?url=https://github.com/muskke/gemini-balance-edge&entry=src/deno_index.ts&env=GEMINI_API_KEY,AUTH_TOKEN)

对于需要使用 `Function Calling` 等可能耗时较长的操作，Vercel 或 Netlify 的 Serverless 函数可能会因为超时（通常为 10-25 秒）而被中断。Deno Deploy 没有此限制，是更稳定可靠的选择。

1. **登录 Deno Deploy**:
    - 访问 [https://dash.deno.com/](https://dash.deno.com/) 并使用您的 GitHub 账号登录。

2. **创建新项目**:
    - 点击 "**New Project**"，然后选择 "**Deploy from GitHub repository**"。
    - 选择您的 `gemini-balance-edge` 仓库，并选择 `main` (或主) 分支。

3. **配置部署设置**:
    - **Entry Point (入口文件)**: Deno Deploy 会尝试自动检测。请务必将其设置为 `src/deno_index.ts`。
    - 点击 "**Link**" 完成关联。

4. **添加环境变量**:
    - 项目关联后，进入项目的 "**Settings**" -> "**Environment Variables**"。
    - 添加以下环境变量：
        - `GEMINI_API_KEY`: 您的 Google Gemini API 密钥 (多个密钥请用逗号隔开)。
        - `AUTH_TOKEN`: (可选) 您为服务设置的访问令牌。

5. **完成部署**:
    - 添加完环境变量后，Deno Deploy 会自动触发一次新的部署。
    - 部署成功后，您将获得一个 `*.deno.dev` 的域名。请使用此域名作为新的 API 端点。

### EdgeOne Pages 部署 (推荐用于国内访问)
[![Deploy to EdgeOne](https://img.shields.io/badge/Deploy%20to-EdgeOne-blue)](https://console.cloud.tencent.com/edgeone/pages)

EdgeOne Pages 是腾讯云提供的静态网站托管服务，特别适合国内用户使用，具有低延迟、高可用性的特点。

**重要**: EdgeOne Pages 使用 Pages Functions 来处理服务端逻辑，项目已包含 `node-functions/` 目录和相应的函数文件。

1. **登录 EdgeOne 控制台**:
    - 访问 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) 并使用您的腾讯云账号登录。

2. **创建 Pages 项目**:
    - 在控制台中，点击 "**Pages**" -> "**新建项目**"。
    - 选择 "**从 Git 仓库导入**" 或 "**上传文件**"。

3. **配置项目设置**:
    - **项目名称**: 输入一个描述性的名称，如 `gemini-balance-edge`。
    - **构建命令**: 如果使用 Git 仓库，可以配置构建命令（可选）。
    - **输出目录**: 设置为项目根目录。

4. **配置环境变量**:
    - 在项目设置中，找到 "**环境变量**" 选项。
    - 添加以下环境变量：
        - `GEMINI_API_KEY`: 您的 Google Gemini API 密钥 (多个密钥请用逗号隔开)。
        - `AUTH_TOKEN`: (可选) 您为服务设置的访问令牌。
        - `GEMINI_BASE_URL`: (可选) Gemini API 基址。
        - `GEMINI_API_VERSION`: (可选) Gemini API 版本。

5. **部署项目**:
    - 如果使用 Git 仓库，EdgeOne 会自动检测 `edgeone.json` 配置文件。
    - 如果上传文件，确保包含 `edgeone.json` 配置文件。
    - 点击 "**部署**" 开始部署过程。

6. **配置路由规则**:
- 项目中的 `edgeone.json` 文件已简化为统一入口：
  - `/verify` → `/node-functions/verify.js`
  - `/(.*)` → `/node-functions/edgeone_index.js`
- 模型列表与所有 API 路由由统一入口根据路径自动判断，并设置正确的鉴权头（OpenAI Authorization 或 Gemini x-goog-api-key）。

7. **获取访问域名**:
    - 部署完成后，您将获得一个 EdgeOne Pages 提供的域名。
    - 使用此域名作为您的 API 端点。

8. **国内访问优化**:
    - EdgeOne Pages 在国内有多个节点，访问速度较快。
    - 支持自定义域名绑定，提升用户体验。

**注意**: 
- EdgeOne Pages 使用 Pages Functions 架构，需要将 API 文件放在 `node-functions/` 目录中
- 根据 [EdgeOne Pages 文档](https://pages.edgeone.ai/zh/document/pages-functions-overview)，Node Functions 提供完整的 Node.js 兼容性，适合深度依赖 Node.js 生态的业务场景

## 本地调试

1.  安装 Node.js 和 Vercel CLI: `npm install -g vercel`
2.  克隆项目并进入目录。
3.  关联 Vercel 项目: `vercel link`
4.  拉取环境变量: `vercel env pull .env.development.local`
5.  启动开发服务器: `vercel dev`

## 自动化部署 (CI/CD)

本项目包含一个 GitHub Actions 工作流配置 (`.github/workflows/deploy.yml`)，可以在您将代码推送到 `main` 分支时自动将应用部署到 Vercel。

要启用此功能，您需要在您的 GitHub 仓库中设置以下 Secrets：

1.  **导航到仓库设置**: 在您的 GitHub 仓库页面，点击 "Settings" -> "Secrets and variables" -> "Actions"。
2. **添加以下 Secrets**:
    - `VERCEL_TOKEN`: 您的 Vercel 账户访问令牌。您可以从 Vercel 的 [Account Settings](https://vercel.com/account/tokens) 页面生成一个。
    - `VERCEL_ORG_ID`: 您的 Vercel 组织 ID。可以从 `.vercel/project.json` 文件中找到 (`orgId`)。
    - `VERCEL_PROJECT_ID`: 您的 Vercel 项目 ID。可以从 `.vercel/project.json` 文件中找到 (`projectId`)。
    - `GEMINI_API_KEY`: 您需要部署的 Gemini API 密钥，多个请用逗号隔开。
    - `GEMINI_BASE_URL` (可选): 代理的 Gemini API URL。
    - `GEMINI_API_VERSION` (可选): 代理的 Gemini API 版本。

完成这些设置后，每当您向 `main` 分支推送提交，GitHub Actions 就会自动为您完成部署。

## 使用方式

> **两种授权模式:**
>
> 1. **Gemini 原生格式 (`x-goog-api-key`)**:
>     - **客户端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_GEMINI_API_KEY>`。
>     - **服务端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
>     - **模型列表**: 访问 `/${GEMINI_API_VERSION}/models`（例如 `/v1beta/models`）。
>
> 2. **OpenAI 兼容格式 (`Authorization`)**:
>     - **客户端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_GEMINI_API_KEY>`。
>     - **服务端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
>     - **模型列表**: 访问 `/openai/models` 或 `/v1/models`（统一入口会映射到 `/${GEMINI_API_VERSION}/openai/models`）。
>
> \* **注意**: 如果请求中未提供任何有效的凭证，请求将被拒绝。
1) Gemini 原生格式
- 非流式
  ```bash
  curl --location 'https://<YOUR_DOMAIN>/v1beta/models/gemini-2.5-pro:generateContent' \
  --header 'Content-Type: application/json' \
  --header 'x-goog-api-key: <KEY1>,<KEY2>' \
  --data '{
    "contents":[{"role":"user","parts":[{"text":"Hello"}]}]
  }'
  ```

- 流式（SSE）
  ```bash
  curl --location 'https://<YOUR_DOMAIN>/v1beta/models/gemini-2.5-pro:generateContent?alt=sse' \
  --header 'Content-Type: application/json' \
  --header 'x-goog-api-key: <KEY1>,<KEY2>' \
  --data '{
    "contents":[{"role":"user","parts":[{"text":"Hello"}]}]
  }'
  ```

2) OpenAI 兼容格式
- 支持 /chat/completions、/embeddings、/models
  ```bash
  curl --location 'https://<YOUR_DOMAIN>/chat/completions' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <YOUR_GEMINI_KEY_OR_AUTH_TOKEN>' \
  --data '{
    "model":"gpt-3.5-turbo",
    "messages":[{"role":"user","content":"你好"}],
    "stream": false
  }'
  ```

3) API Key 校验（SSE）
- 需在服务端配置 AUTH_TOKEN 时，携带 Authorization: Bearer <AUTH_TOKEN>
  ```bash
  curl --location 'https://<YOUR_DOMAIN>/verify' \
  --header 'Authorization: Bearer <AUTH_TOKEN>' \
  --header 'x-goog-api-key: <KEY1>,<KEY2>'
  ```

SSE 事件：
- : verify-start（注释帧）
- data: {"key":"xxxxxxx......xxxxxxx","status":"GOOD|BAD|ERROR", "error":"可选"}
- : heartbeat（每 5s）
- : verify-end（注释帧）

## 负载均衡与健康策略

- 平滑加权轮询（SWRR）：每个健康 Key 维护 currentWeight，按权重累加并选择最大者，选中后 currentWeight 减去总权重，实现更平滑分配
- 健康判定：
  - 401/403：标记不健康（可能为 Key 失效、禁用）
  - 429/5xx/网络错误：不直接标记不健康，建议客户端重试或降级
  - 4xx（如 400/404）：多为请求问题，不影响 Key 健康
- 恢复：后台周期性探活恢复不健康 Key

## CORS 与预检

- 全局 OPTIONS：返回 204，允许任意方法与头（仅演示，生产可按需收窄）
- 正常与错误响应均附加：
  - Access-Control-Allow-Origin: *
  - Referrer-Policy: no-referrer
- SSE 响应额外设置：
  - Content-Type: text/event-stream; charset=utf-8
  - Cache-Control: no-cache
  - Connection: keep-alive

## 安全建议

- 强烈建议设置 AUTH_TOKEN，限制代理与 /verify 的滥用
- 前端/日志系统不要记录完整密钥；本项目在日志层已对敏感头进行脱敏
- 如需进一步控制，建议在边缘层增加速率限制与 IP/令牌级配额（本项目暂未内置）

## 部署

- Vercel：一键部署后在环境变量中配置 GEMINI_API_KEY（支持权重）、可选 AUTH_TOKEN 等。注意：当前无 KV 持久化
- Netlify：功能类似，无持久化
- Deno Deploy：推荐用于长时间交互（Function Calling 等），无平台超时限制。同样为内存态
- EdgeOne：推荐用于国内用户，低延迟、高可用性，支持自定义域名

## 本地开发

- 推荐使用 Vercel CLI
  npm i -g vercel
  vercel dev

- 或在 Deno 环境直接部署测试（见项目根目录的 deno 部署说明与 src/deno_index.ts）。

## 变更记录（相较此前版本）

- 文档调整为“无持久化，仅进程内存”，移除 Vercel KV 相关描述
- 仅在 401/403 时标记 Key 不健康；移除对网络异常的误伤
- 实现 SWRR，减少临时大数组的构造开销
- 统一 CORS/预检处理；SSE 增加心跳与注释帧
- OpenAI 兼容层不再包含 /completions 路由
- 日志默认脱敏敏感头，减少泄露风险

## 版权

MIT License. 改编自：技术爬爬虾（gemini-balance-lite），致谢原作者。#   T e s t   c h a n g e 
 
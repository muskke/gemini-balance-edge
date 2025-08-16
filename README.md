# Gemini Balance Edge
## Gemini API 代理和智能负载均衡无服务器边缘函数

## 🚀 项目简介

Gemini Balance Edge 是一个部署在 Vercel Edge Network 上的高性能 API 代理。它不仅能将对 Gemini API 的请求在国内进行中转，还实现了一套智能的负载均衡机制，旨在最大化多个 API Key 的使用效率和稳定性。

### ✨ 核心功能

- **智能负载均衡**: 不再是简单的随机选取，而是采用**加权轮询 (Weighted Round-Robin)** 算法。您可以为每个 API Key 设置不同的权重，高权重的 Key 将被更频繁地使用。
- **自动健康检查**: 系统会自动检测失效的 API Key。当一个 Key 请求失败后，它会被自动标记为“不健康”并暂时移出轮询池。
- **状态持久化**: 利用 **Vercel KV (Redis)**，所有 API Key 的健康状态和当前轮询位置都会被持久化存储。这意味着即使 Serverless 函数冷启动，负载均衡的状态也能无缝恢复，确保了在无状态环境下的高可用性。
- **自动恢复**: 系统会定期对“不健康”的 Key 进行静默检查。一旦 Key 恢复正常，它将自动回归到工作队列中，实现无人干预的故障恢复。
- **多平台兼容**: 一键部署至 Vercel (推荐) 或 Netlify。
- **OpenAI 格式兼容**: 支持以 OpenAI 的 API 格式进行请求，无缝对接现有生态。

## 部署方案

### Vercel 部署 (推荐)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/muskke/gemini-balance-edge)

1.  点击上方的 "Deploy" 按钮。
2.  在 Vercel 的项目设置中，找到 "Environment Variables" 选项，添加你的 API Key。
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

## API 说明

### Gemini 代理
可以使用 Gemini 的原生 API 格式进行代理请求。
**Curl 示例:**
```bash
curl --location 'https://<YOUR_DEPLOYED_DOMAIN>/v1beta/models/gemini-2.5-pro:generateContent' \
--header 'Content-Type: application/json' \
--header 'x-goog-api-key: <YOUR_GEMINI_API_KEY_1>,<YOUR_GEMINI_API_KEY_2>' \
--data '{
    "contents": [
        {
         "role": "user",
         "parts": [
            {
               "text": "Hello"
            }
         ]
      }
    ]
}'
```
**Curl 示例:（流式）**

```bash
curl --location 'https://<YOUR_DEPLOYED_DOMAIN>/v1beta/models/gemini-2.5-pro:generateContent?alt=sse' \
--header 'Content-Type: application/json' \
--header 'x-goog-api-key: <YOUR_GEMINI_API_KEY_1>,<YOUR_GEMINI_API_KEY_2>' \
--data '{
    "contents": [
        {
         "role": "user",
         "parts": [
            {
               "text": "Hello"
            }
         ]
      }
    ]
}'
```

> **两种授权模式:**
>
> 1. **Gemini 原生格式 (`x-goog-api-key`)**:
>     - **客户端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_GEMINI_API_KEY>`。
>     - **服务端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
>
> 2. **OpenAI 兼容格式 (`Authorization`)**:
>     - **客户端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_GEMINI_API_KEY>`。
>     - **服务端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
>
> > **注意**: 如果请求中未提供任何有效的凭证，请求将被拒绝。

### API Key 校验
可以通过向 `/verify` 端点发送请求来校验你的 API Key 是否有效。可以一次性校验多个 Key，用逗号隔开。
**Curl 示例:**

```bash
curl --location 'https://<YOUR_DEPLOYED_DOMAIN>/verify' \
--header 'x-goog-api-key: <YOUR_GEMINI_API_KEY_1>,<YOUR_GEMINI_API_KEY_2>'
```

### OpenAI 格式
本项目兼容 OpenAI 的 API 格式，你可以通过 `/chat` 或 `/chat/completions` 端点来发送请求。
**Curl 示例:**
```bash
curl --location 'https://<YOUR_DEPLOYED_DOMAIN>/chat/completions' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <YOUR_GEMINI_API_KEY>' \
--data '{
    "model": "gpt-3.5-turbo",
    "messages": [
        {
            "role": "user",
            "content": "你好"
        }
    ]
}'
```

## 说明
本项目改编自大佬: [技术爬爬虾](https://github.com/tech-shrimp/gemini-balance-lite)，感谢大佬的贡献。

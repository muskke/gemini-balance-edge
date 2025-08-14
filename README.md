# Gemini Balance Edge
# Gemini API 代理和负载均衡无服务器边缘函数

## 项目简介

Gemini API 代理, 使用边缘函数把Gemini API免费中转到国内。还可以聚合多个Gemini API Key，随机选取API Key的使用实现负载均衡，使得Gemini API免费成倍增加。

## Vercel部署(推荐)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/muskke/gemini-balance-edge)


1. 点击部署按钮⬆️一键部署。
2. 在 Vercel 的项目设置中，找到 "Environment Variables" 选项，添加你的 API Key。变量名为 `GEMINI_API_KEY`，值为你申请到的 Key。如果你有多个 Key，可以用逗号隔开。
3. 国内使用需要配置自定义域名。
4. （可选）如果你需要代理到非官方的 Gemini API 端点，可以额外配置 `GEMINI_BASE_URL` 和 `GEMINI_API_VERSION` 环境变量。
5. 去[AIStudio](https://aistudio.google.com)申请一个免费Gemini API Key
<br>将API Key与自定义的域名填入AI客户端即可使用，如果有多个API Key用逗号分隔


## Netlify部署
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tech-shrimp/gemini-balance-edge)
1. 点击部署按钮，登录Github账户即可。
2. 在 Netlify 的项目设置中，找到 "Build & deploy" -> "Environment" 选项，添加你的 API Key。变量名为 `GEMINI_API_KEY`，值为你申请到的 Key。如果你有多个 Key，可以用逗号隔开。
3. 免费分配域名，国内可直连（但是不稳定）。
4. （可选）如果你需要代理到非官方的 Gemini API 端点，可以额外配置 `GEMINI_BASE_URL` 和 `GEMINI_API_VERSION` 环境变量。
5. 去[AIStudio](https://aistudio.google.com)申请一个免费Gemini API Key
<br>将API Key与分配的域名填入AI客户端即可使用，如果有多个API Key用逗号分隔


## 本地调试

1. 安装NodeJs
2. npm install -g vercel
3. cd 项目根目录
4. vercel dev

## 自动化部署 (CI/CD)

本项目包含一个 GitHub Actions 工作流配置 (`.github/workflows/deploy.yml`)，可以在您将代码推送到 `main` 分支时自动将应用部署到 Vercel。

要启用此功能，您需要在您的 GitHub 仓库中设置以下 Secrets：

1.  **导航到仓库设置**: 在您的 GitHub 仓库页面，点击 "Settings" -> "Secrets and variables" -> "Actions"。
2.  **添加以下 Secrets**:
    *   `VERCEL_TOKEN`: 您的 Vercel 账户访问令牌。您可以从 Vercel 的 [Account Settings](https://vercel.com/account/tokens) 页面生成一个。
    *   `VERCEL_ORG_ID`: 您的 Vercel 组织 ID。可以从 `.vercel/project.json` 文件中找到 (`orgId`)。
    *   `VERCEL_PROJECT_ID`: 您的 Vercel 项目 ID。可以从 `.vercel/project.json` 文件中找到 (`projectId`)。
    *   `GEMINI_API_KEY`: 您需要部署的 Gemini API 密钥，多个请用逗号隔开。
    *   `GEMINI_BASE_URL` (可选): 代理的 Gemini API URL。
    *   `GEMINI_API_VERSION` (可选): 代理的 Gemini API 版本。

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
> 1.  **Gemini 原生格式 (`x-goog-api-key`)**:
>     *   **客户端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_GEMINI_API_KEY>`。
>     *   **服务端密钥**: 在请求头中提供 `x-goog-api-key: <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
>
> 2.  **OpenAI 兼容格式 (`Authorization`)**:
>     *   **客户端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_GEMINI_API_KEY>`。
>     *   **服务端密钥**: 在请求头中提供 `Authorization: Bearer <YOUR_AUTH_TOKEN>` (前提是服务端已配置 `AUTH_TOKEN` 和 `GEMINI_API_KEY`)。
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
本项目改编自大佬: [技术爬爬虾](https://github.com/tech-shrimp/gemini-balance-lite)，感谢大佬的贡献

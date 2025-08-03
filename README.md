# Gemini Balance Edge
# Gemini API 代理和负载均衡无服务器边缘函数

## 项目简介

Gemini API 代理, 使用边缘函数把Gemini API免费中转到国内。还可以聚合多个Gemini API Key，随机选取API Key的使用实现负载均衡，使得Gemini API免费成倍增加。

## Vercel部署(推荐)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/muskke/gemini-balance-edge)


1. 点击部署按钮⬆️一键部署。
2. 国内使用需要配置自定义域名
3. 去[AIStudio](https://aistudio.google.com)申请一个免费Gemini API Key
<br>将API Key与自定义的域名填入AI客户端即可使用，如果有多个API Key用逗号分隔


## Netlify部署
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tech-shrimp/gemini-balance-edge)
1. 点击部署按钮，登录Github账户即可
2. 免费分配域名，国内可直连（但是不稳定）。
3. 去[AIStudio](https://aistudio.google.com)申请一个免费Gemini API Key
<br>将API Key与分配的域名填入AI客户端即可使用，如果有多个API Key用逗号分隔


## 本地调试

1. 安装NodeJs
2. npm install -g vercel
3. cd 项目根目录
4. vercel dev

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
> 注意: 请将 `<YOUR_DEPLOYED_DOMAIN>` 替换为你的部署域名，并将 `<YOUR_GEMINI_API_KEY>` 替换为你的 Gemini API Ke，如果有多个用逗号分隔


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

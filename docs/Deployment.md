# 部署策略说明

## 概述

本项目现在支持智能选择性部署，可以根据代码变更自动决定部署到哪个平台。

## 部署策略

### 1. 选择性部署 (推荐)

新的 `selective-deploy.yml` 工作流会根据文件变更自动决定部署策略：

- **只更新 `deploy.yml`**：仅部署到 Vercel
- **只更新 `edgeone.yml`**：仅部署到 EdgeOne  
- **更新源代码文件**（`api/`、`src/`、`package.json` 等）：同时部署到两个平台
- **其他情况**（包括两个工作流文件都未更新）：同时部署到两个平台（默认行为）

### 2. 部署策略详细说明

#### 部署决策逻辑

1. **只更新 `deploy.yml`** → 仅部署到 Vercel
2. **只更新 `edgeone.yml`** → 仅部署到 EdgeOne
3. **更新源代码文件**（`api/`、`src/`、`package.json`、`vercel.json`、`edgeone.json`、`README.md`、`LICENSE`）→ 同时部署到两个平台
4. **其他任何变更**（包括两个工作流文件都未更新的情况）→ 同时部署到两个平台（默认行为）

#### 具体场景示例

- ✅ 只修改 `deploy.yml` → 只部署 Vercel
- ✅ 只修改 `edgeone.yml` → 只部署 EdgeOne  
- ✅ 修改 `src/handle_request.js` → 同时部署两个平台
- ✅ 修改 `package.json` → 同时部署两个平台
- ✅ 修改 `README.md` → 同时部署两个平台
- ✅ 两个工作流文件都没有修改 → 同时部署两个平台（默认）
- ✅ 同时修改 `deploy.yml` 和 `edgeone.yml` → 同时部署两个平台

### 3. 独立部署 (可选)

如果需要独立部署，可以：

1. 取消注释 `deploy.yml` 中的 `on` 配置
2. 取消注释 `edgeone.yml` 中的 `on` 配置
3. 注释掉 `selective-deploy.yml` 中的 `on` 配置

## EdgeOne 部署修复

### 问题分析
1. **缺少 EdgeOne CLI 依赖**：工作流中没有安装 `@edgeone/cli` 包
2. **package.json 配置不完整**：缺少必要的依赖和配置
3. **部署命令问题**：使用 `npx` 而不是全局安装的 CLI
4. **部署包过大**：包含了不必要的文件

### 修复内容
1. ✅ 在 `package.json` 中添加了 `@edgeone/cli` 依赖
2. ✅ 在工作流中添加了 EdgeOne CLI 的全局安装步骤
3. ✅ 修改部署命令使用全局安装的 CLI
4. ✅ 完善了 `package.json` 的配置
5. ✅ 优化部署包，排除不相关文件

## 部署优化

### 平台特定的忽略文件

项目使用平台特定的忽略文件来优化部署包：

#### `.vercelignore` - Vercel 部署忽略文件
- 排除 EdgeOne 相关配置：`edgeone.json`、`.edgeoneignore`
- 排除 Netlify 相关配置：`netlify.toml`、`netlify/`
- 排除 Deno 配置：`deno.json`
- 排除开发文件：测试文件、示例文件、文档等

#### `.edgeoneignore` - EdgeOne 部署忽略文件
- 排除 Vercel 相关配置：`vercel.json`
- 排除 Netlify 相关配置：`netlify.toml`、`netlify/`
- 排除 Deno 配置：`deno.json`
- 排除开发文件：测试文件、示例文件、文档等

### 通用排除文件：
- `.github/` - GitHub Actions 工作流
- `docs/` - 文档目录
- `README.md` - 项目说明
- `LICENSE` - 许可证文件
- `src/test_key_manager.js` - 测试文件
- `src/key_manager_example.js` - 示例文件
- `.env.example` - 环境变量示例
- `node_modules/` - 开发依赖
- `package-lock.json` - 锁定文件
- `.git/`、`.gitignore` - Git 相关

### 部署包优化效果：
- ✅ **减少部署包大小** - 排除不必要的文件
- ✅ **提高部署速度** - 减少传输时间
- ✅ **避免平台冲突** - 排除其他平台的配置文件
- ✅ **保持部署目录整洁** - 只包含运行时必需的文件

## 环境变量配置

### Vercel 部署所需 Secrets
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`
- `GEMINI_API_VERSION`

### EdgeOne 部署所需 Secrets
- `EDGEONE_API_TOKEN`
- `EDGEONE_PROJECT_NAME` (可选)

## 使用说明

1. **首次设置**：确保在 GitHub 仓库的 Settings > Secrets 中配置所有必要的环境变量

2. **日常开发**：
   - 修改 Vercel 相关文件 → 自动部署到 Vercel
   - 修改 EdgeOne 相关文件 → 自动部署到 EdgeOne
   - 同时修改两个平台的文件 → 同时部署到两个平台

3. **调试部署**：查看 GitHub Actions 的日志来诊断部署问题

## 故障排除

### EdgeOne 部署常见问题：
1. **API Token 未设置**：检查 `EDGEONE_API_TOKEN` 是否正确配置
2. **项目名称问题**：检查 `EDGEONE_PROJECT_NAME` 或使用仓库名称
3. **依赖安装失败**：确保 Node.js 版本为 18.x

### Vercel 部署常见问题：
1. **Token 权限问题**：确保 Vercel Token 有足够权限
2. **环境变量缺失**：检查所有必要的环境变量是否已设置

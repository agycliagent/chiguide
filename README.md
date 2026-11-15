# ChiGuide · AI 助手

一个可直接运行的中文聊天网页，包含响应式界面、多会话历史和 OpenAI 兼容 API 代理。代理与网页运行在同一服务上，避免浏览器跨域限制；API Key 可安全地放在本地 `.env` 文件中，不会提交到仓库。

## 启动

需要 Node.js 18 或更新版本。在仓库根目录运行：

```bash
cp .env.example .env
```

编辑 `.env`，将 `LLM_API_KEY` 设置为**新生成的 API Key**，然后运行：

```bash
npm start
```

打开 <http://localhost:3000>。无需安装依赖。也可以不在 `.env` 配置密钥，启动后在左侧模型设置中临时输入 API Key。网页请求会发到同源的 `/api/chat/completions`，由 `server.js` 转发到模型服务，避免浏览器 CORS 限制。

Windows 用户可复制 `.env.example` 为 `.env`，用文本编辑器填写新密钥，再运行 `npm start`。

## 安全提醒

曾经在聊天中粘贴过的密钥已暴露，请先在服务商后台撤销并重新生成。不要把密钥提交到 Git，也不要把服务器开放到公网后仍使用前端输入密钥的方式。`.env` 已通过 `.gitignore` 排除；部署到公网时，应通过托管服务的环境变量配置 `LLM_API_KEY`，并启用 HTTPS 和访问控制。

## 配置

`.env` 支持 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 和 `PORT`。默认模型接口是 `https://llm.xinjiyuan.tech/v1`，默认模型名是 `boss-31b`。

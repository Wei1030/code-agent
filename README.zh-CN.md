# Code Agent

[English](README.md) | 简体中文

Code Agent 是一个在浏览器里使用 Claude Code 的个人工作台。本地运行一个小型 Node.js 服务，通过
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) 驱动 Claude Code；网页界面
展示会话里发生的一切：流式回复、工具审批、提问、计划、子代理、后台任务、文件改动、上下文和费用。

在此之上，它还提供：

- **多个会话同时进行**，每个会话在自己的工作区或 git 工作树里；会话之间可以互相读取、发消息、新建会话。
- **多个模型来源**：你自己的 Claude 订阅，以及任意多个兼容 Anthropic 接口的端点，每个端点可以配多个模型。
- **代码审核循环**：先运行你设定的验证命令，再由独立 Claude Code 进程里的只读审核者提出意见，反复修改直到通过。
- **工作区看板**：功能、问题和笔记，每轮对话结束后在后台自动更新。
- **集中管理设置**：权限规则、MCP 服务器、技能、命令、子代理、钩子、CLAUDE.md 和记忆文件。这些都是
  Claude Code 自己的文件，在这里改了 `claude` 命令行里也会生效，反之亦然。
- 在 `claude` 命令行里开始的会话也会列出来，可以在这里接着做；在命令行里接着聊的内容，下次在这里打开时会补上。

界面支持简体中文和英文。

> Code Agent 是基于 Claude Agent SDK 的独立工具，不是 Claude Code，也不是 Anthropic 的产品。

## 部署

Code Agent 运行在你自己的电脑上（Windows、macOS 或 Linux），供一个人使用。

### 准备

- **Node.js 22.13 或更高版本。** Code Agent 的数据存在 Node 内置的 SQLite 里，不需要另外安装数据库。
- **可用的模型**，至少一种：
  - 你的 Claude 订阅：安装 [Claude Code](https://code.claude.com/docs/en/setup)，运行 `claude`，
    用 `/login` 登录。Code Agent 直接使用这个登录，不提供登录页面，也不读取你的凭据；
  - 兼容 Anthropic 接口的端点：准备好地址、令牌和模型名，之后在应用里添加。
- **git**：工作树和代码审核需要；**GitHub CLI**（`gh`）：只在把 GitHub issue 导入看板时需要。

### 安装与启动

```bash
git clone <本仓库地址> code-agent
cd code-agent
npm install
npm start
```

`npm start` 会先构建网页，再在 <http://127.0.0.1:5180> 启动服务，并用默认浏览器打开。进入后先添加
一个工作区（项目文件夹）；如果用兼容端点，在「设置 → 模型服务与账号」里添加。

更新时拉取新版本，重新运行 `npm install` 和 `npm start`。按 Ctrl+C 停止服务。

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODE_AGENT_PORT` | `5180` | 端口。被占用时依次尝试后面 5 个端口。 |
| `CODE_AGENT_HOME` | `~/.code-agent` | 数据目录：数据库、日志和工作树。 |
| `CODE_AGENT_NO_OPEN` | 不设置 | 设为 `1` 时启动后不打开浏览器。 |

用同一个数据目录再启动一次时，会直接打开已经在运行的那个，而不是再启动一个。

### 安全

- 服务只监听 127.0.0.1，只接受来自它自己页面的连接。要在另一台电脑上使用，请通过 SSH 转发端口，
  不要直接暴露端口。
- 端点令牌只保存在本地数据库里，不会发送到浏览器。使用端点的会话永远拿不到你的 Claude 登录。
- Code Agent 只在你重命名、打标签或删除会话时改动 Claude Code 的会话文件；在 Code Agent 里删除会话时，
  会同时删除它在 Claude Code 里的对话记录。

## 开发

```bash
npm run dev         # 服务加 Vite 开发中间件，地址相同
npm run typecheck   # 检查全部三个包
npm test
npm run i18n:missing -w @code-agent/web   # 列出还没有英文对照的界面文字
```

`apps/server` 是 Node.js 服务，`apps/web` 是 React 网页，`packages/shared` 是两者共用的协议类型。
需求文档见 [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md)，交互稿见
[docs/prototype/index.html](docs/prototype/index.html)。

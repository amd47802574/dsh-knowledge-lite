# dsh-knowledge-lite

给 DeepSeek Harness（dsh）用的本地知识库插件。每篇笔记是一个 Markdown 文件，数据完全在你本机，不依赖任何云服务。

> 本仓库 fork 自 [fangqiing/dsh-knowledge-lite](https://github.com/fangqiing/dsh-knowledge-lite)（v0.1.6），新增 **Markdown 渲染预览** 与 **自动保存**，感谢原作者的开源工作。

## 功能

- **本地纯文本存储**：每篇一个 `.md`，可用任意外部编辑器直接修改
- **全文搜索 + 标签筛选**
- **层级目录**：目录即磁盘文件夹，可在文件管理器里手动移动文件，库自动识别
- **Markdown 渲染预览**：编辑器「编辑 / 预览」切换，打开笔记即渲染；支持标题、粗体/斜体/删除线、行内代码、围栏代码块、链接与自动裸链、多级嵌套列表、任务列表 `- [ ]`、引用块、表格（含对齐）、分隔线；直接产出 React 元素、不解析 HTML，无注入风险
- **自动保存**：停止输入约 1 秒后自动落盘；切换笔记、返回聊天、关闭窗口前自动冲刷；`Ctrl+S` / 保存按钮保留为手动立即保存；失败时提示并自动重试
- **附件**：拖入文件自动分流
  - 文本类（`.txt`/`.md`/`.py`/`.json`/`.csv`…）→ 直接进正文
  - Office（`.docx`/`.xlsx`/`.pptx`）→ 原件存入 `files/`，同时**零依赖抽取文本**写进正文（可搜索、可被 AI 引用）
  - 其他（`.pdf`/图片/压缩包…）→ 原样存入 `files/`，双击「打开」交给系统程序
  - 删除笔记连带清理其附件
- **拖拽移动**：把笔记拖到任意目录节点即移动
- **对话导出**：把 dsh 对话整理成笔记（writeback）——**仅当该轮对话带文档/附件时才出现「存入知识库」按钮**，纯文字回答不触发回写

## 安装

上架 DSH 插件市场后，可在 dsh 的 `设置 → 插件市场` 搜索 `dsh-knowledge-lite` 一键安装。

手动 / 开发模式（针对 dsh `0.2.0-rc.2` / Windows）：

```bash
git clone https://github.com/amd47802574/dsh-knowledge-lite.git
cd dsh-knowledge-lite
pnpm install          # 依赖用 link: 协议，改动即时生效，无需重装
# 把插件链接进 dsh 的插件目录并重启 dsh（安装前需彻底退出 dsh，否则 EPERM）
```

> 宿主版本需与 `peerDependencies` 中的 `@deepseek-ai/dsh-*` `0.2.0-rc.2` 匹配。

## 兼容性

- **宿主**：DeepSeek Harness `0.2.0-rc.2`
- **平台**：Windows（默认笔记根目录写死 `E:/dsh-kb`，其他平台需改 `lib/config.js` 的 `DEFAULT_ROOT`）
- **分类建议**：知识管理 / 效率工具

## 目录结构

| 文件 | 职责 |
|---|---|
| `lib/store.js` | 笔记与层级目录的存储、扫描、移动、删除 |
| `lib/index.js` | 宿主（Node）侧入口与 RPC |
| `lib/client.js` | 浏览器半侧 UI（目录树、编辑器、Markdown 预览与自动保存、附件列表） |
| `lib/attachments.js` | Office 文档零依赖文本抽取（ZIP + XML，无第三方库） |
| `lib/writeback.js` | 把对话抽取为笔记候选 |
| `lib/config.js` | 笔记根目录等路径配置 |
| `lib/writeback-prompts.js` | 抽取提示词 |

## 已知限制

- **默认笔记根目录写死为 `E:/dsh-kb`**（Windows 专属）。其他平台需改 `lib/config.js` 的 `DEFAULT_ROOT`，或首次启动后在设置里改。
- 主要在 Windows + dsh `0.2.0-rc.2` 下验证。

## License

MIT

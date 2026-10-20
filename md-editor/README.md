# 灵墨 LingMark

**轻量 Markdown 编辑器** — 本地文件优先，秒开，所见即所得。

与 [LingPanel](https://github.com/Little-Qi/Ling-Panel) 是**两个独立产品**：
不共享代码、不共享数据目录，只是可以被 LingPanel 以命令行方式唤起打开 `.md` 文件。

![灵墨界面](samples/shot-editor.png)

---

## 为什么

市面上的 Markdown 编辑器要么太重（要装一堆依赖、要建库、要登录），要么太糙（就是个 textarea 加个预览）。
灵墨的目标是：**打开就写、写得舒服、关掉不留痕**。

- **零配置**：不建库、不登录、不联网，双击 `.md` 就能写
- **本地文件优先**：一切围绕你硬盘上那个 `.md` 文件，不是数据库
- **功能完整**：大纲、斜杠命令、查找替换、任务清单、专注模式、导出 HTML，一个都不少
- **可被调用**：命令行传路径即可打开，能注册成系统 `.md` 的默认程序

---

## 快速开始

```powershell
cd md-editor
npm install
npm start
```

打开指定文件：

```powershell
npm start -- "D:\notes\我的文档.md"
```

打包安装包（会注册 `.md` / `.markdown` 文件关联）：

```powershell
npm run build:win
```

产物：`dist/LingMark-<version>-setup.exe`（NSIS 安装器）与 `dist/win-unpacked/`（免安装版）。

安装后可在「设置 → 应用 → 默认应用」里把 `.md` 的打开方式改成灵墨。

---

## 功能

### 编辑

| 能力 | 说明 |
| --- | --- |
| 三栏布局 | 大纲 · 编辑 · 预览，可切换为「仅编辑 / 仅预览」 |
| 实时预览 | 输入即渲染，编辑区与预览区滚动同步 |
| 智能工具栏 | 加粗是 **toggle** 不是包裹——对已加粗的文本再点一次会取消 |
| 斜杠命令 | 输入 `/` 呼出命令菜单：标题、列表、任务清单、引用、代码块、表格、分隔线、链接、图片 |
| 快捷键 | `Ctrl+B/I/K`、``Ctrl+` ``、`Ctrl+1…6`、`Ctrl+Shift+8/7/9`、`Ctrl+F`、`Ctrl+Shift+F`（专注）、`Ctrl+S` |
| 智能回车 | 列表项自动续行并递增编号；空列表项回车则退出列表 |
| 缩进 | `Tab` / `Shift+Tab` 缩进与反缩进 |
| 大纲导航 | 自动提取标题层级，点击跳转，围栏代码块内的 `#` 不会误判 |
| 查找替换 | `Ctrl+F`，显示命中数，支持逐个替换与全部替换 |
| 字数统计 | 中文按字、英文按词，状态栏实时显示；光标行列号同步 |
| 专注模式 | `Ctrl+Shift+F` 隐藏大纲与预览，只留写作区 |
| 图片 | 拖拽或直接粘贴图片，自动存到同级 `assets/` 并插入相对路径 |
| 任务清单 | 预览里直接点选勾选框，源码同步更新 |

### 渲染

- **marked**（GFM）+ **DOMPurify** 净化，标题/列表/表格/代码块/引用/删除线/图片/链接一应俱全
- 标题带锚点，悬停可跳转
- 表格保留对齐（仅放行 `text-align`，其余内联样式一律丢弃）
- 危险协议（`javascript:` 等）被拦截；`style` 属性只保留对齐，其余清除——避免恶意文档用 `position:fixed` 覆盖界面
- 导出为独立 HTML（内联样式，可直接分享）

### 文件

- 打开 / 保存 / 另存为，最近文件列表
- 命令行传参打开、文件关联（`.md` / `.markdown`）
- 未保存改动在关闭时拦截
- 窗口位置尺寸记忆

---

## 快捷键一览

| 按键 | 作用 |
| --- | --- |
| `Ctrl+B` / `Ctrl+I` | 加粗 / 斜体 |
| `Ctrl+K` | 链接 |
| ``Ctrl+` `` | 行内代码 |
| `Ctrl+Shift+X` | 删除线 |
| `Ctrl+1`…`Ctrl+6` / `Ctrl+0` | 标题级别 / 退回正文 |
| `Ctrl+Shift+8` / `7` / `9` | 无序 / 有序 / 任务列表 |
| `Ctrl+1` / `2` / `3` | 并排 / 仅编辑 / 仅预览 |
| `Ctrl+Shift+F` | 专注模式 |
| `Ctrl+F` | 查找与替换 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| 输入 `/` | 呼出命令菜单 |
| `Tab` / `Shift+Tab` | 缩进 / 反缩进 |

---

## 技术实现

无构建步骤。纯 CommonJS（主进程）+ 纯 `<script>`（渲染进程），不打包、不转译。

```
md-editor/
├─ main.js                 # 窗口、文件关联、CLI 传参、菜单
├─ preload.js              # contextBridge：window.lm
├─ src/
│  ├─ main/fs-service.js   # 原子写、最近文件、图片落盘、文件监听
│  └─ renderer/
│     ├─ index.html / app.js / styles.css
│     └─ lib/
│        ├─ vendor/        # marked 12.0.2 · DOMPurify 3.1.6（MIT，单文件 UMD）
│        ├─ markdown.js    # 渲染层：渲染 / 净化 / 大纲 / 任务项 / 字数 / HTML 导出
│        └─ md-editor.js   # 编辑器组件；文本变换是纯函数，可独立测试
└─ tests/                  # node:test
```

**编辑区坚持用原生 `<textarea>`**：IME 组合、撤销栈、无障碍、选区行为全部交给浏览器，
不自造 input 引擎——这是自研编辑器最容易做砸的地方。所有文本变换
（`toggleWrap` / `setHeading` / `continueList` / `indentLines` …）都是
`(value, sel) => {value, start, end}` 的纯函数，可单测。

### 第三方依赖

仅两个，均为 MIT 单文件 UMD，直接放在 `src/renderer/lib/vendor/`，不需要构建：

| 库 | 版本 | 用途 |
| --- | --- | --- |
| [marked](https://github.com/markedjs/marked) | 12.0.2 | Markdown → HTML |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 | HTML 净化 |

---

## 开发

```powershell
npm test        # node:test，无需额外框架
npm start       # 开发启动
```

## License

MIT

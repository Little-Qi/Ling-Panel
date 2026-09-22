# 灵动面板 LingPanel

**Windows 优先的贴顶本地工作台** — 一枚小胶囊悬在屏幕边缘，点开就是待办、Markdown 笔记、链接、番茄钟、论文归档与 AI 对话日志。

数据默认完全留在本机：没有账号、没有云同步、没有遥测。

当前版本：**0.3.0**

从零实现的 Electron 桌面应用，针对「贴顶小窗 + 本地工作台」场景做了完整设计与打磨。

---

## 目录

- [截图与形态](#截图与形态)
- [设计原则](#设计原则)
- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [AI 完成提醒](#ai-完成提醒)
- [剪贴板](#剪贴板)
- [论文归档](#论文归档)
- [数据与备份](#数据与备份)
- [图标与品牌](#图标与品牌)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [打包发布](#打包发布)
- [License](#license)

---

## 截图与形态

应用有两种形态，可在屏幕边缘自由拖拽吸附：

| 形态 | 说明 |
| --- | --- |
| **胶囊（收起）** | 默认约 200×36 的深色小条，带呼吸光点；贴顶/贴边可自动隐藏 |
| **工作台（展开）** | 约 760×560 的完整面板：首页 Bento、待办看板、笔记、链接、番茄钟、论文、AI 日志、设置 |

**停靠位置**（拖到边缘松手即可吸附，并记住所在显示器）：

- 顶部居中 / 顶部左侧 / 顶部右侧
- 左侧停靠 / 右侧停靠
- 屏幕中央（浮动）

**品牌与主题**：产品标识为 **LING**。三套主题：

| 主题 | 主色 | 氛围 |
| --- | --- | --- |
| 极光夜 | `#6C8CFF` / `#7B8CFF` | 深空蓝紫，默认 |
| 晨光 | `#F5E6D3` | 暖纸色 |
| 薄荷 | `#2DD4BF` | 清冷青绿 |

色板锚点：背景 `#0B0F14` · 强调 `#7B8CFF` · 辅助 `#2DD4BF`。

---

## 设计原则

贴顶工具很容易踩坑，LingPanel 在实现里优先保证下面几件事：

| 场景 | 做法 |
| --- | --- |
| 输入时被面板挡住、看不到输入法候选 | **输入焦点模式**：聚焦输入框时临时取消 `alwaysOnTop`，展开窗足够大，不使用 toolbar 窗类 |
| 笔记只能当纯文本 | 内置轻量 Markdown 渲染：标题/列表/代码块/表格/引用，编辑时可预览 |
| 顶栏/刘海条过大挡页面 | 默认**小胶囊**（200×36），宽高可调，支持六种停靠位 |
| 展开卡顿、布局僵硬 | CSS 动效 + 主进程批量 bounds 插值；可拖拽、可居中浮动，展开尺寸可调 |
| 界面单调 | 三套主题：极光夜 / 晨光 / 薄荷 |
| 数据隐私 | 全部落在本地 JSON，无账号、无云、无遥测 |

---

## 功能一览

### 核心工作台

- **首页** — Bento 布局：待办概览、到期提醒、最近笔记、链接、番茄状态、剪贴板收件箱与快捷入口
- **待办** — 四列工作流（今天 / 进行中 / 待反馈 / 已完成，可改名与改色），默认到期当天 23:30，状态流转与逾期提示
- **笔记** — Markdown 速记，搜索、智能标题、实时预览
- **链接** — 保存常用网址，后台抓取标题（阻断 localhost / 内网，仅用于展示）
- **番茄钟** — 可配置专注/短休/长休时长与长休周期，完成系统通知，保留历史
- **论文** — 扫描下载目录中的 PDF，按主题归档到论文库，读元数据补全标题/年份，支持内容去重
- **AI 对话日志** — 记录与 AI 工具的问答（手动或剪贴板），按会话组织
- **设置** — 主题、停靠、尺寸、IME 策略、贴边隐藏、开机启动、剪贴板监听、论文库路径、数据导入导出

### 系统集成

- **托盘图标** — 展开 / 收起 / 跳转各页 / 退出
- **全局快捷键** — `Alt+Space` 切换胶囊 ↔ 工作台
- **置顶策略** — 默认 screen-saver 级置顶；输入时临时让位给输入法候选
- **贴边自动隐藏** — 收起后光标离开可滑入边缘，靠近热点唤出（双屏接缝边禁用，避免掉缝）
- **单实例** — 重复启动会激活已有实例

### 本地 AI 完成提醒（默认关闭）

本地 HTTP 服务，接收 Codex / Claude / GPT 等工具的任务完成通知。详见下文。

### 剪贴板工作流

可选监听系统剪贴板，将新内容送入收件箱，一键归档为笔记 / 链接 / 待办 / AI 日志。

---

## 快速开始

### 环境要求

- Windows 10 / 11（优先支持）
- Node.js **18+**（开发建议 22）
- 约 200 MB 磁盘（含 Electron）

### 从源码运行

```powershell
git clone git@github.com:Little-Qi/Ling-Panel.git
cd Ling-Panel
npm install
npm test
npm start
```

### 安装正式包

从 [Releases](../../releases) 下载 `LingPanel-0.3.0-setup.exe`，双击安装即可。安装器为 NSIS，支持自定义安装目录、创建桌面与开始菜单快捷方式；卸载默认**保留**用户数据。

---

## 使用指南

### 胶囊 ↔ 工作台

| 操作 | 效果 |
| --- | --- |
| 点击胶囊 | 展开工作台 |
| 点击「收起」/ 按 `Esc` | 收回到胶囊 |
| `Alt+Space` | 全局切换 |
| 拖拽胶囊 | 移动；松手靠近边缘自动吸附 |
| 点击胶囊上的 `›` | 展开（与点击胶囊相同） |

### 输入法友好

聚焦任意输入框时会**临时取消置顶**，避免输入法候选被面板挡住；失焦后立即恢复置顶。可在设置中关闭该行为。

### 贴边隐藏

收起状态下，光标离开一段时间后面板滑入屏幕边缘，只留一条窄缝（可配置露出像素）；光标扫过热点区域即重新弹出。  
双屏接缝边会自动禁用滑出，防止叠到另一块屏或掉进显示器缝隙。

### 待办工作流

1. 在输入框回车即可快速添加（默认到期今天 23:30）
2. 在四列之间拖拽或点按流转状态
3. 首页会汇总今日到期与逾期项

### Markdown 笔记

支持：

- `#` ～ `######` 标题
- **粗体** / *斜体* / `行内代码`
- 有序 / 无序列表
- ``` 代码块 ```
- > 引用
- 表格
- [链接](https://example.com)

---

## AI 完成提醒

面板在本机监听：

```text
POST http://127.0.0.1:43822/notify/{source}
Content-Type: application/json
```

**允许的 source**：`codex` · `claude` · `gpt` · `ling` · `system`（其余 403）

**请求体示例**：

```json
{
  "title": "任务已完成",
  "project": "my-project",
  "task_id": "demo",
  "message": "可选补充说明"
}
```

**默认关闭**。在「设置 → AI 提醒」中打开后才会处理请求。

### 命令行示例

```powershell
curl -X POST http://127.0.0.1:43822/notify/codex `
  -H "Content-Type: application/json" `
  -d "{\"title\":\"任务已完成\",\"project\":\"my-project\",\"task_id\":\"demo\"}"
```

仓库内附带转发示例脚本：

```powershell
node scripts/codex-notify.js "任务已完成" "my-project"
node scripts/claude-notify.js "任务已完成" "my-project"
```

可配合 Codex / Claude Code 的 hooks，在会话结束时调用上述脚本。

---

## 剪贴板

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 监听剪贴板 | 开 | 新文本进入收件箱 |
| 剪贴板变更通知 | 关 | 弹出系统通知 |

在首页收件箱中可对一条剪贴内容选择：

- 归档为 **笔记**
- 识别为 URL 则归档为 **链接**
- 归档为 **待办**
- 写入 **AI 对话日志**
- 忽略

---

## 论文归档

- 可配置**论文库根目录**（默认在用户文档下，亦可改到 `D:\paper` 等）
- 可配置**下载目录**，扫描其中 PDF
- 按主题（如 Seq / Rec）分子目录归档
- 读取 PDF 元数据与文件名启发式，补全标题、年份、会议
- **内容哈希去重**：同一 PDF 换名重复下载不会重复入库
- 忽略列表保存在论文库 `_manifest/ignore.json`，与库一起迁移

归档模式支持「复制」或「移动」。

---

## 数据与备份

**全部业务数据在一个本地 JSON 文件里**，无账号、无云、无遥测。

### 默认位置

```text
%APPDATA%\ling-panel\data\workspace.json    # 开发模式（npm start）
%APPDATA%\ling-panel\data\workspace.json    # 安装包（userData 已锁定为 ling-panel）
```

> 主进程固定 `userData` 为 `%APPDATA%\ling-panel`，开发与安装包共用同一目录，避免重装后看起来像数据被清空。

### 自定义数据目录

```powershell
$env:LING_PANEL_DATA = "D:\LingPanelData"
npm start
```

### 导出 / 导入

设置页提供：

- **打开数据目录**
- **导出 workspace.json**
- **导入 workspace.json**（导入前自动备份当前文件为 `.bak-<时间戳>`）

论文库文件夹不在 workspace.json 内，迁移时把论文库目录一并拷走即可。

### 持久化实现要点

1. 启动时 `load()` 一次，与默认配置 `deepMerge`
2. 任意分区变更后原子写入（先写 `.tmp` 再 `rename`）
3. 渲染进程只通过 IPC 访问主进程 Store，不直接碰磁盘

字段说明详见 [docs/DATA.md](docs/DATA.md)。

---

## 图标与品牌

应用图标为**手绘 SVG 矢量**，透明底、无水印，与产品 UI 同一设计语言：

- **主图标**（`assets/ling-icon.svg`）：深色圆角方砖 + 悬浮胶囊 + 灵珠 + 展开尖括号
- **托盘图标**（`assets/ling-icon-tray.svg`）：简化胶囊，16px 更清晰
- 导出：`app-icon.png`（1024）· `app-icon.ico`（16–256 多帧）· `ling-panel.png`

重新生成图标（需要 Node，sharp 来自 MiMo 运行时或自行安装）：

```powershell
# 在可解析 sharp 的环境下
node scripts/build-icons.mjs
```

打包时 `scripts/afterPack.cjs` 会用 rcedit 把 ICO 写入 `LingPanel.exe`（不依赖联网下载 winCodeSign）。

---

## 项目结构

```text
ling-panel/
├─ main.js                 # Electron 主进程入口（IPC、快捷键、单实例）
├─ preload.js              # contextBridge：window.ling
├─ package.json            # 脚本与 electron-builder 配置
├─ assets/                 # 矢量图标与导出位图 / ICO
├─ scripts/
│  ├─ afterPack.cjs        # 打包后写入 exe 图标
│  ├─ build-icons.mjs      # SVG → PNG/ICO
│  ├─ codex-notify.js      # AI 通知示例
│  └─ claude-notify.js
├─ src/
│  ├─ main/
│  │  ├─ window-manager.js # 胶囊/工作台窗口、托盘、多屏停靠、贴边隐藏
│  │  ├─ store.js          # 本地 JSON 持久化
│  │  ├─ notify-server.js  # 127.0.0.1 AI 完成提醒
│  │  ├─ clip-notify.js    # 剪贴板监听与归档
│  │  ├─ ai-log.js         # AI 对话日志
│  │  ├─ paper-lib.js      # 论文库
│  │  └─ pdf-hints.js      # PDF 元数据/标题启发式
│  └─ renderer/
│     ├─ index.html / styles.css / app.js
│     ├─ lib/              # Markdown、DOM 工具
│     └─ views/            # home / todo / notes / links / pomodoro / papers / ailog / settings
├─ tests/                  # node:test 单测（53+）
└─ docs/                   # DESIGN / DATA / ISSUES
```

---

## 开发与测试

```powershell
# 单元测试（node:test，无额外框架）
npm test

# 开发启动
npm start

# 仅测某一文件
node --test tests/store.test.js
```

测试覆盖：存储、Markdown、剪贴板归档、AI 日志、通知服务白名单、论文解析与去重、首页渲染、可展开文本等。

设计说明见 [docs/DESIGN.md](docs/DESIGN.md)，数据说明见 [docs/DATA.md](docs/DATA.md)。

---

## 打包发布

```powershell
npm run build:win
```

产物：

| 文件 | 说明 |
| --- | --- |
| `dist/LingPanel-<version>-setup.exe` | NSIS 安装包（推荐） |
| `dist/win-unpacked/` | 免安装目录（可直接跑 `LingPanel.exe`） |

打包注意：

1. 依赖 `electron-builder`；首次若需联网拉 winCodeSign，可配置镜像：`ELECTRON_BUILDER_BINARIES_MIRROR`
2. 本仓库使用 `afterPack` 本地 rcedit 写入图标，**无需**打开 `signAndEditExecutable`（那会强制联网）
3. 未配置代码签名时会跳过签名，不影响本地分发

升级版本时请同步修改 `package.json` 的 `version`。

---

## License

[MIT](LICENSE)

# 数据持久化�?�?
## 结�?

**全部数据�?��在你�?��的一�?JSON 文件里，没有账号、没有云�??�没有遥测�??*

## 存哪�?
默�?�?���?
```text
%APPDATA%\ling-panel\data\workspace.json          # �?�?npm start（包�?ling-panel�?%APPDATA%\LingPanel\data\workspace.json          # 安�?包（产品�?LingPanel�?```

�?发时若�?�?���??变量 `LING_PANEL_DATA`，则整目录�?覆盖�?
```powershell
$env:LING_PANEL_DATA = "D:\LingPanelData"
npm start
```

设置页可「打�?数据�?�� / 导出 / 导入 workspace.json」�??
## �?��安�?后�?何继承旧数据

1. **装安装包�?*（或从开发版）找到旧�?`workspace.json`（�?上表；�?�?��也能打开�?��）�??2. **装完 LingPanel �?*先启动一次再�?出，让目录生成�??3. 二�?�一�?   - **设置 �?导入 workspace.json**（推荐，会自动�?份当前文件为 `.bak-时间戳`�?   - 或手动把旧文件�?制到：`%APPDATA%\LingPanel\data\workspace.json`
4. **论文�?*（`D:\paper` 等）不在这份 JSON 里，�??「�?�?�?论文归档�?��」仍�?���?�?���?*无需迁移**。忽略列表在库的 `_manifest\ignore.json`，跟库走�?
## 怎么�?
实现�?`src/main/store.js`�?
1. **�?*：启动时 `load()` �?次，和默认配�?`deepMerge` 后放进内存缓�? 
2. **�?*：任�?`todo/note/link/settings/...` 变更 �?`save(partial)`  
3. **原子�?*：先�?`workspace.json.tmp`，再 `rename` 覆盖正式文件  
4. **范围**：渲染进程只能�?�过 IPC 调主进程�?Store

## 文件里有�?�?
| 字�? | 内�? |
| --- | --- |
| `settings` | 主�?、停靠�?�尺寸�?�悬�??��?文路径等 |
| `workflows[]` | 待办�?|
| `todos[]` / `notes[]` / `links[]` | 业务数据 |
| `pomodoro` | �?��配置与历�?|
| `feishu` | 预留配置 |

## 备份 / 迁移

- **备份**：�?�?`workspace.json`（或用�?��?出�?�）
- **换电�?*：拷该文件到新机器同名应用数�?��录，或�?��?入�??- **重置**：�?�?��「重�?��部本地数�???
## 和�?�AI 完成提醒」的关系

提醒接口�?���?`127.0.0.1`�?*默�?关闭**；开�?��收到的事件只弹系统�?�知，不上传、不落库（除非你之后做进待办）�??
## 后续�??��?强（�?���?
- �?��多工作区切换  
- 导出 Markdown / CSV  
- `safeStorage` 加密敏感字�?（�?�?Secret�? 
- �???WebDAV / 飞书同�?（仍�?��优先�?
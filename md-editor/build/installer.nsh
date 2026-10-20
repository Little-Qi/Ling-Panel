; 安装目录：装到当前用户目录（%LOCALAPPDATA%\Programs\LingMark）
;
; 为什么必须显式指定 InstallDir：
; 1) 免提权、免 UAC —— 这是一个本地 Markdown 编辑器，没必要要求管理员权限。
; 2) NSIS 是 32 位进程（插件目录为 x86-unicode），$PROGRAMFILES 会被解析成
;    "C:\Program Files (x86)"。那里 BUILTIN\Users 只有 ReadAndExecute，
;    脚本里 SetOutPath $INSTDIR 建目录会失败。
;    失败的表现是：electron-builder 打包时要把自己刚生成的安装包跑一遍来提取
;    卸载程序，于是弹出 NSIS 模态框「Error writing temporary file. Make sure
;    your temp folder is valid.」把整个构建卡死，产物只有几百 KB。
InstallDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"

; 安装目录
;
; 打包期（electron-builder 会把刚生成的安装包跑一遍来提取卸载程序，
; 这时脚本带 BUILD_UNINSTALLER 宏，initMultiUser 不会被调用，
; $INSTDIR 只能用编译期的 InstallDir）：
;   → 必须指向一个当前用户可写的目录，否则 NSIS 的 SetOutPath 建不出来，
;     弹出「Error writing temporary file. Make sure your temp folder is valid.」
;     模态框把整个构建卡死，产物只剩几百 KB。
;
; 安装期：不要写死 InstallDir。
;   initMultiUser 会按注册表里的旧安装位置决定 $INSTDIR，
;   这样升级同一个应用时才能原地覆盖，不会因为换了路径而留下两份。
!ifdef BUILD_UNINSTALLER
  InstallDir "$TEMP\LingPanelNsisBuild"
!endif

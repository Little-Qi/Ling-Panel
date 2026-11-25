; 安装目录
;
; 打包期（electron-builder 会把刚生成的安装包跑一遍来提取卸载程序，
; 这时脚本带 BUILD_UNINSTALLER 宏，initMultiUser 不会被调用，
; $INSTDIR 只能用编译期的 InstallDir）：
;   → 必须指向一个当前用户可写的目录，否则 NSIS 的 SetOutPath 建不出来，
;     弹出「Error writing temporary file. Make sure your temp folder is valid.」
;     模态框把整个构建卡死，产物只剩几百 KB。
;   （构建时的 $TEMP 由 scripts/build-env.js 指向项目内干净的 .build-temp）
;
; 安装期：不写死 InstallDir，交给 initMultiUser 决定。
;   安装器是 assisted 模式：用户可选「仅为我」或「所有用户」；
;   已装过旧版时按注册表里的安装位置原地覆盖升级。
!ifdef BUILD_UNINSTALLER
  InstallDir "$TEMP\LingMarkNsisBuild"
!endif

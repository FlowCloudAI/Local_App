; ── 流云AI NSIS 自定义卸载钩子 ────────────────────────────────────────────────
;
; 个人数据目录：%APPDATA%\cn.flowcloudai.www
;   包含：settings.json（用户配置）、app.log（运行日志）
;
; 在卸载过程完成后询问用户是否删除该目录。
; 程序数据（数据库、插件）位于安装目录，由 NSIS 主卸载流程自动清理。
; ─────────────────────────────────────────────────────────────────────────────

!macro NSIS_HOOK_POSTINSTALL
  ; 为自定义文件类型设置资源管理器图标。
  ; Tauri 负责注册扩展名和打开方式，这里只补充 DefaultIcon。
  WriteRegStr SHCTX "Software\Classes\.fcplug\DefaultIcon" "" "$INSTDIR\resources\icons\fcplug.ico,0"
  ReadRegStr $0 SHCTX "Software\Classes\.fcplug" ""
  StrCmp $0 "" fcplug_icon_done 0
  WriteRegStr SHCTX "Software\Classes\$0\DefaultIcon" "" "$INSTDIR\resources\icons\fcplug.ico,0"
fcplug_icon_done:

  WriteRegStr SHCTX "Software\Classes\.fcworld\DefaultIcon" "" "$INSTDIR\resources\icons\fcworld.ico,0"
  ReadRegStr $0 SHCTX "Software\Classes\.fcworld" ""
  StrCmp $0 "" fcworld_icon_done 0
  WriteRegStr SHCTX "Software\Classes\$0\DefaultIcon" "" "$INSTDIR\resources\icons\fcworld.ico,0"
fcworld_icon_done:

  ; 通知资源管理器刷新文件类型图标缓存。
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; 询问是否清除个人数据
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时清除流云AI的个人数据？$\n$\n将删除以下内容：$\n  · 应用程序设置（settings.json）$\n  · 运行日志（app.log）$\n$\n目录：$APPDATA\cn.flowcloudai.www$\n$\n此操作不可撤销，您的项目数据库不受影响。" \
    IDNO +2
  RMDir /r "$APPDATA\cn.flowcloudai.www"
!macroend

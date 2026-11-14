@echo off
set ELECTRON_RUN_AS_NODE=1
set CSC_IDENTITY_AUTO_DISCOVERY=false
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
node_modules\electron\dist\electron.exe build\run-builder.cjs

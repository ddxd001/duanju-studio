# 短剧工坊 · DuanJu Studio

把小说变成你自己的短剧:AI 改编剧本 → 角色设定图(可反复修改)→ 分镜试拍 → 整集生成。
不是"看别人做好的短剧",而是"生成你自己想看的短剧"。

## 功能特性

- **小说改编**:粘贴小说原文,自动拆分为多集分镜脚本(集数 1–200 可调,每集时长可设)
- **角色工坊**:
  - 自动从小说提取全部出场人物,数量不限
  - 手动添加角色(人物 / 宠物 / 灵兽 / 坐骑均可),支持改名、删除
  - 每个角色在 App 内现场生成三视图设定图(配色方案 / 正背侧面 / 表情与细节)
  - 大白话反复修改设定与立绘("把披风换成黑色"),版本可回滚
  - **导入照片生成**:以照片里的形象为基准生成设定图
- **分镜反馈循环**:任何一段不满意都可以反馈重拍,支持多版本对比与回滚
- **试拍 → 全集**:先试拍一段确认画风,满意后再批量生成整集
- **桌面软件**:Windows 安装包(NSIS),独立窗口运行,无需安装 Node / 浏览器环境

## 生成引擎

| 渠道 | 说明 |
| --- | --- |
| 内置出图 | 开箱即用(依赖本机 Kimi Work 运行环境),任务状态落盘,服务重启不丢任务 |
| 云端接口 | 任意 OpenAI 兼容的图像生成接口,在「生成引擎设置」中配置 |
| ComfyUI | 对接本机 ComfyUI 工作流(视频渲染),占位符模板可自定义 |

## 快速开始(用户)

1. 下载 `release/短剧工坊 Setup x.x.x.exe` 安装包并安装
2. 打开软件 →「载入示例小说」或粘贴自己的小说 → 开始改编剧本
3. 角色工坊确认形象 → 分镜板逐段反馈 → 试拍确认画风 → 生成全集

## 快速开始(开发)

```bash
npm install
npm run dev          # 前端(自动拉起 7101 图像生成服务)
```

浏览器打开终端提示的地址即可。

### 打包安装包

```bash
npm run build        # 编译前端到 dist/
node build/run-builder.cjs   # 调用 electron-builder 生成 NSIS 安装包到 release/
```

`build/run-builder.cjs` 内置了 Electron `ELECTRON_RUN_AS_NODE` 环境下的 asar 兼容补丁,
普通 Node 环境下同样可用。

## 技术栈

React 19 · TypeScript · Vite 7 · Tailwind CSS · shadcn/ui · Zustand(persist) · Electron 33 · electron-builder

## 目录结构

```
src/
  pages/           # 六个工作流页面(小说/剧本/角色/分镜/试拍/放映)
  lib/store.ts     # 全局状态(Zustand + localStorage 持久化)
  lib/engine.ts    # 生成引擎适配层(内置/云端/ComfyUI)
  lib/mockData.ts  # 演示模式的剧本/角色生成逻辑
server/
  image-server.mjs # 内置图像生成服务(任务持久化、参考照片上传)
electron/
  main.cjs         # 桌面版主进程(静态服务 + 生成服务 + 窗口)
build/
  run-builder.cjs  # 打包脚本
```

## License

MIT

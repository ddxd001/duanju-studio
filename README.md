# 短剧工坊 · DuanJu Studio

把小说变成你自己的短剧：AI 改编剧本 → 角色设定图（可反复修改）→ 角色参考图锁脸渲染 → 分镜反馈循环 → 整集 MP4 导出。

## 功能特性

- **小说改编（真实 LLM 闭环）**：粘贴小说原文，演示模式按规则切分；真实模式调用任意 OpenAI 兼容 LLM（如本地 Ollama / 云端接口）同时产出角色表与分集分镜脚本（集数 1–200 可调）。
- **角色工坊**：
  - 自动提取出场人物，也支持无限手动添加人物 / 宠物 / 灵兽 / 坐骑，支持改名、删除
  - 自然语言反复修改设定与立绘（真实模式由 LLM 改写，演示模式走规则），版本可随时回滚
  - 支持导入照片作为参考基准生成三视图设定图；云端出图自动落盘到本地避免撑爆 `localStorage`
- **本地 ComfyUI MiniMax-H3 自动集成 + 参考图锁脸（Ref2VA）**：
  - 内置适配本地 MiniMax-H3 部署（4 步蒸馏 + SLA 稀疏注意力 + LowVRAM 分块前馈 + 原生视频/音频联合解码）的工作流生成器，无需手改 JSON
  - 镜头出镜角色存在设定图时，自动上传至 ComfyUI 并切换 `MiniMaxH3ReferenceToVideo` + `<Picture i>` 标签锁脸；无参考图时自动走 `MiniMaxH3ImageToVideo`（T2VA）
  - 同样支持导入自定义 ComfyUI API JSON 模板（支持 `{{prompt}}`、`{{seed}}`、`{{frames}}`、`{{steps}}`、`{{width}}`、`{{height}}`、`{{ref_image_1}}`）
- **MiniMax 云端 H3 保底**：内置同源代理转发，创建任务不自动重试防重复扣费，成片自动缓存到本地持久化播放
- **试拍锁画风 & 队列控制**：先试拍第一镜锁画风再解锁批量生成，支持单卡串行队列暂停/继续、单任务取消与刷新后卡死状态自动恢复
- **放映厅 & 整集 MP4 导出**：真实视频按实际 `ended` 事件无缝连播，支持把整集已通过镜头一键拼接导出为单个 MP4（优先使用本机 `ffmpeg`，自动降级 PyAV）
- **多项目管理**：支持新建、切换、删除多个短剧项目，以及项目 JSON 一键备份/导入

## 生成引擎

| 渠道 | 说明 |
| --- | --- |
| ComfyUI 本地 MiniMax-H3 | 推荐，经本地同源代理无 CORS 限制；自动根据角色设定图切换 T2VA / Ref2VA 锁脸，成片自动缓存 |
| MiniMax 云端 H3 | 填写 API Key 即可云端生成视频与原生音频，成片自动缓存本地 |
| OpenAI 兼容 LLM | 负责剧本分镜改编、角色抽取、自然语言改设定与按反馈重写提示词（支持本地 Ollama） |
| 角色生图 | 支持 ComfyUI 生图工作流、OpenAI 兼容云端图像 API，或本机可选内置生图工具（`IMAGE_GEN_TOOL`） |

## 快速开始（开发）

```bash
npm install
npm run dev          # 前端 + 自动拉起 7101 本地代理与媒体服务
npm test             # 运行单元测试
npm run build        # TypeScript 检查 + 生产构建
```

### 打包 Windows 桌面安装包

```bash
npm run build
node build/run-builder.cjs   # 生成 NSIS 安装包到 release/
```

## 目录结构

```
src/
  pages/            # 六个工作流页面(小说/剧本/角色/分镜/试拍/放映)
  components/       # 通用预览与反馈组件 + 精简后的 shadcn/ui
  lib/comfyH3.ts    # ComfyUI 本地 MiniMax-H3 T2VA / Ref2VA 工作流生成器
  lib/engine.ts     # 生成引擎适配层(ComfyUI / MiniMax 云端 / LLM / 导出)
  lib/store.ts      # 多项目状态管理(Zustand + persist + 队列与节流轮询)
  lib/prompt.ts     # 反馈规则引擎
  lib/mockData.ts   # 演示模式启发式剧本/角色生成与画风预设
server/
  image-server.mjs  # 零依赖本地代理与媒体服务(仅允许本机来源跨域)
  concat_videos.py  # PyAV 视频拼接脚本(FFmpeg 不可用时的自动降级方案)
electron/
  main.cjs          # Electron 桌面主进程(静态托管 + Range 视频流 + 7101 服务)
tests/
  core.test.mjs     # 核心逻辑单元测试
```

## License

MIT

// ============ 短剧工坊 · 数据模型 ============

export type StepId =
  | 'novel' // ① 小说输入
  | 'script' // ② 剧本改编
  | 'characters' // ③ 角色工坊
  | 'storyboard' // ④ 分镜板(反馈循环核心)
  | 'render' // ⑤ 试拍与批量生成
  | 'theater' // ⑥ 合成播放

/** 分镜状态机:草稿 → 排队 → 渲染中 → 待确认 ⇄(反馈重拍) → 已通过 */
export type ShotStatus = 'draft' | 'queued' | 'rendering' | 'review' | 'approved'

/** 一次生成 = 一个版本。每次反馈重拍都会产生新版本,历史可回溯 */
export interface Version {
  id: string
  n: number // v1, v2, v3 ...
  prompt: string // 该版本实际使用的完整提示词
  feedback: string // 催生出这个版本的用户反馈(v1 为空)
  autoFix: string[] // 系统自动追加的修正项说明
  seed: number
  createdAt: number
  videoUrl?: string // ComfyUI / MiniMax 产出的真实视频地址
  imageUrl?: string // 生成的真实图片(角色设定图/立绘)
  refCharacters?: string[] // 本次视频生成实际注入的参考图角色名
}

export interface Shot {
  id: string
  episodeId: string
  index: number // 集内镜头序号
  title: string // 镜头摘要
  scene: string // 场景
  characters: string[] // 出场角色名
  basePrompt: string // 剧本给出的画面描述
  dialogue: string // 台词 / 旁白
  duration: number // 秒(4-15)
  status: ShotStatus
  progress: number // 渲染进度 0-100
  versions: Version[]
  currentVersionId: string | null
  comfyPromptId?: string // 本地 ComfyUI 或 MiniMax 云端任务 ID
  renderError?: string // 渲染失败原因
}

export interface Episode {
  id: string
  index: number // 第几集
  title: string
  synopsis: string
}

export type CharStatus = 'pending' | 'generating' | 'review' | 'confirmed'

export interface DesignLogEntry {
  instruction: string // 用户的修改要求
  note: string // 系统执行结果的说明
  at: number
}

export interface Character {
  id: string
  name: string
  role: string // 主角/反派/配角...
  description: string // 外形设定(AI 建模 + 用户多轮修改)
  evidence: string // AI 建模所依据的小说原文片段
  designLog: DesignLogEntry[] // 设定修改记录
  status: CharStatus
  versions: Version[] // 立绘版本,与分镜共用反馈机制
  currentVersionId: string | null
  comfyPromptId?: string // 已提交的生图任务 ID
  renderError?: string
}

export interface StylePreset {
  id: string
  name: string
  desc: string
  keywords: string // 注入到所有提示词的画风词
  palette: [string, string, string] // 演示模式配色
}

export interface Settings {
  mode: 'demo' | 'local' // demo=内置演示生成;local=真实视频/LLM 生成
  videoProvider: 'comfy' | 'minimax' // 视频:本地 ComfyUI 或 MiniMax 云端 H3
  comfyUrl: string
  comfyWorkflowMode: 'minimax-h3-auto' | 'custom' // 内置本地 MiniMax-H3(自动T2VA/Ref2VA)或自定义模板
  comfyRefImageSize: 'match' | 'max' // H3 Ref2VA 参考图缩放策略(match 更省显存)
  comfyH3Steps: number // H3 4步蒸馏模型采样步数(默认 4)
  comfyH3Unet: string
  comfyH3Clip: string
  comfyH3VideoVae: string
  comfyH3AudioVae: string
  workflowTemplate: string // 视频:自定义 ComfyUI API 格式工作流(含 {{prompt}} 等占位符)
  minimaxApiBase: string
  minimaxApiKey: string
  minimaxModel: string
  minimaxGenerateAudio: boolean
  imageProvider: 'builtin' | 'comfy' | 'cloudapi' // 立绘生成渠道
  imageWorkflowTemplate: string // 立绘:ComfyUI 生图工作流(API JSON + 占位符)
  imageApiBase: string // 立绘:OpenAI 兼容图像接口
  imageApiKey: string
  imageApiModel: string
  llmBase: string
  llmKey: string
  llmModel: string
  resolution: string
  steps: number
  renderSecondsPerShot: number // 演示模式下单个镜头耗时(秒)
  autoFix: boolean // AI 自动微调:反馈命中规则或 LLM 改写提示词
}

export interface Project {
  id: string
  title: string
  novelText: string
  styleId: string
  customStyle: string // 用户追加的画风描述
  episodeLength: number // 每集目标秒数
  episodeCount: number // 目标集数
  styleApproved: boolean // 试拍通过后才解锁批量生成
  episodes: Episode[]
  characters: Character[]
  shots: Shot[]
  updatedAt: number
}

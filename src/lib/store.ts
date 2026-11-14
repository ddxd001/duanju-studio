// ============ 全局状态(zustand + localStorage 持久化) ============
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Character,
  Project,
  Settings,
  Shot,
  StepId,
  StylePreset,
  Version,
} from '@/types'
import {
  STYLE_PRESETS,
  SAMPLE_NOVEL,
  buildCharacters,
  buildScript,
  refineDescription,
} from './mockData'
import {
  composePrompt,
  buildWorkflowBody,
  submitComfyJob,
  fetchComfyResult,
  submitImageJob,
  fetchBuiltinResult,
  parseResolution,
} from './engine'
import { revisePrompt, uid } from './prompt'

const DEFAULT_SETTINGS: Settings = {
  mode: 'demo',
  comfyUrl: 'http://127.0.0.1:8188',
  workflowTemplate: '',
  imageProvider: 'builtin',
  imageWorkflowTemplate: '',
  imageApiBase: 'https://api.openai.com/v1',
  imageApiKey: '',
  imageApiModel: 'gpt-image-1',
  llmBase: 'http://127.0.0.1:11434/v1',
  llmKey: '',
  llmModel: 'qwen2.5:14b',
  resolution: '720x1280',
  steps: 20,
  renderSecondsPerShot: 4, // 演示模式渲染耗时
  autoFix: true,
}

const EMPTY_PROJECT: Project = {
  title: '未命名短剧',
  novelText: '',
  styleId: 'guoman3d',
  customStyle: '',
  episodeLength: 60,
  episodeCount: 3,
  styleApproved: false,
  episodes: [],
  characters: [],
  shots: [],
}

export function getStyle(styleId: string): StylePreset {
  return STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0]
}

interface StoreState {
  step: StepId
  settings: Settings
  project: Project
  // ---- 导航与设置 ----
  setStep: (s: StepId) => void
  setSettings: (p: Partial<Settings>) => void
  // ---- ① 小说输入 ----
  setNovelInfo: (p: Partial<Pick<Project, 'title' | 'novelText' | 'styleId' | 'customStyle' | 'episodeLength' | 'episodeCount'>>) => void
  applySample: () => void
  // ---- ② 剧本改编 ----
  adaptScript: () => void
  updateShotField: (shotId: string, p: Partial<Pick<Shot, 'title' | 'basePrompt' | 'dialogue' | 'duration' | 'scene'>>) => void
  // ---- ③ 角色工坊 ----
  updateCharacterDesc: (id: string, desc: string) => void
  refineCharacter: (id: string, instruction: string) => void
  renderCharacter: (id: string, feedback?: string, refId?: string) => void
  confirmCharacter: (id: string) => void
  rollbackCharacter: (id: string, versionId: string) => void
  addCharacter: (p: { name: string; role: string; description: string }) => void
  removeCharacter: (id: string) => void
  renameCharacter: (id: string, p: { name: string; role: string }) => void
  // ---- ④⑤ 分镜 / 渲染 ----
  renderShot: (shotId: string, feedback?: string) => void
  approveShot: (shotId: string) => void
  approveAllReview: () => void
  rollbackShot: (shotId: string, versionId: string) => void
  queueEpisode: (episodeId: string) => void
  queueAllPending: () => void
  updateShotPrompt: (shotId: string, prompt: string) => void
  // ---- 画风 ----
  approveStyle: () => void
  restyleUnapproved: (feedback: string) => void
  // ---- 渲染 worker(tick 驱动) ----
  tick: (dtMs: number) => void
  resetAll: () => void
}

function makeVersion(n: number, prompt: string, feedback: string, fixes: string[]): Version {
  return {
    id: uid(),
    n,
    prompt,
    feedback,
    autoFix: fixes,
    seed: Math.floor(Math.random() * 1e9),
    createdAt: Date.now(),
  }
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      step: 'novel',
      settings: DEFAULT_SETTINGS,
      project: EMPTY_PROJECT,

      setStep: (step) => set({ step }),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),

      setNovelInfo: (p) => set((s) => ({ project: { ...s.project, ...p } })),
      applySample: () =>
        set((s) => ({
          project: { ...s.project, title: '青州夜话', novelText: SAMPLE_NOVEL },
        })),

      adaptScript: () => {
        const { project } = get()
        if (!project.novelText.trim()) return
        const characters = buildCharacters(project.novelText)
        const { episodes, shots } = buildScript(
          project.novelText,
          project.episodeCount,
          project.episodeLength,
        )
        set((s) => ({
          project: { ...s.project, characters, episodes, shots, styleApproved: false },
        }))
      },

      updateShotField: (shotId, p) =>
        set((s) => ({
          project: {
            ...s.project,
            shots: s.project.shots.map((sh) => (sh.id === shotId ? { ...sh, ...p } : sh)),
          },
        })),

      updateCharacterDesc: (id, desc) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.map((c) =>
              c.id === id ? { ...c, description: desc } : c,
            ),
          },
        })),

      refineCharacter: (id, instruction) => {
        // 1) 先改设定文本并留痕
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.map((c) => {
              if (c.id !== id) return c
              const r = refineDescription(c.description, instruction)
              return {
                ...c,
                description: r.newDesc,
                designLog: [...(c.designLog ?? []), { instruction, note: r.note, at: Date.now() }],
              }
            }),
          },
        }))
        // 2) 已出过立绘的角色,自动按新设定重画(待重新确认)
        const c = get().project.characters.find((x) => x.id === id)
        if (c && c.versions.length > 0) get().renderCharacter(id)
      },

      renderCharacter: (id, feedback, refId) => {
        set((s) => {
          const style = getStyle(s.project.styleId)
          const chars = s.project.characters.map((c) => {
            if (c.id !== id) return c
            const photoHint = refId ? '严格以参考照片中的形象为基准(长相/品种/毛色/特征保持一致),' : ''
            const base = `${photoHint}${style.keywords},${s.project.customStyle},角色设定三视图(正面/侧面/背面):${c.name},${c.description},全身像,纯白干净背景,精美角色设计稿`
            const n = c.versions.length + 1
            let prompt = base
            let fixes: string[] = []
            if (feedback) {
              const prev = c.versions.find((v) => v.id === c.currentVersionId)
              const r = revisePrompt(prev?.prompt ?? base, feedback, s.settings.autoFix)
              prompt = r.newPrompt
              fixes = r.fixes
            }
            const v = makeVersion(n, prompt, feedback ?? '', fixes)
            return {
              ...c,
              status: 'generating' as const,
              versions: [...c.versions, v],
              currentVersionId: v.id,
              renderError: undefined,
              comfyPromptId: undefined,
            }
          })
          return { project: { ...s.project, characters: chars } }
        })
        // 提交真实图像生成:内置渠道任何模式下都生效;ComfyUI/云端渠道在本地模式下生效
        const s = get()
        if (s.settings.mode === 'local' || s.settings.imageProvider === 'builtin') {
          const c = s.project.characters.find((x) => x.id === id)
          const v = c?.versions.find((x) => x.id === c.currentVersionId)
          if (c && v) submitCharacterImage(c.id, v.id, v.prompt, v.seed, s.settings, refId)
        }
      },

      confirmCharacter: (id) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.map((c) =>
              c.id === id ? { ...c, status: 'confirmed' as const } : c,
            ),
          },
        })),

      rollbackCharacter: (id, versionId) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.map((c) =>
              c.id === id ? { ...c, currentVersionId: versionId, status: 'review' as const } : c,
            ),
          },
        })),

      addCharacter: (p) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: [
              ...s.project.characters,
              {
                id: uid(),
                name: p.name,
                role: p.role,
                description: p.description,
                evidence: '',
                designLog: [],
                status: 'pending' as const,
                versions: [],
                currentVersionId: null,
              },
            ],
          },
        })),

      removeCharacter: (id) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.filter((c) => c.id !== id),
          },
        })),

      renameCharacter: (id, p) =>
        set((s) => ({
          project: {
            ...s.project,
            characters: s.project.characters.map((c) =>
              c.id === id ? { ...c, name: p.name, role: p.role } : c,
            ),
          },
        })),

      renderShot: (shotId, feedback) =>
        set((s) => {
          const style = getStyle(s.project.styleId)
          const shots = s.project.shots.map((sh) => {
            if (sh.id !== shotId) return sh
            const descs = sh.characters.map(
              (name) => s.project.characters.find((c) => c.name === name)?.description ?? '',
            )
            const base = composePrompt({
              basePrompt: sh.basePrompt,
              styleKeywords: style.keywords,
              customStyle: s.project.customStyle,
              characterNames: sh.characters,
              characterDescs: descs,
            })
            const n = sh.versions.length + 1
            let prompt = base
            let fixes: string[] = []
            if (feedback) {
              const prev = sh.versions.find((v) => v.id === sh.currentVersionId)
              const r = revisePrompt(prev?.prompt ?? base, feedback, s.settings.autoFix)
              prompt = r.newPrompt
              fixes = r.fixes
            }
            const v = makeVersion(n, prompt, feedback ?? '', fixes)
            return {
              ...sh,
              status: 'queued' as const,
              progress: 0,
              versions: [...sh.versions, v],
              currentVersionId: v.id,
            }
          })
          return { project: { ...s.project, shots } }
        }),

      approveShot: (shotId) =>
        set((s) => ({
          project: {
            ...s.project,
            shots: s.project.shots.map((sh) =>
              sh.id === shotId ? { ...sh, status: 'approved' as const } : sh,
            ),
          },
        })),

      approveAllReview: () =>
        set((s) => ({
          project: {
            ...s.project,
            shots: s.project.shots.map((sh) =>
              sh.status === 'review' ? { ...sh, status: 'approved' as const } : sh,
            ),
          },
        })),

      rollbackShot: (shotId, versionId) =>
        set((s) => ({
          project: {
            ...s.project,
            shots: s.project.shots.map((sh) =>
              sh.id === shotId
                ? { ...sh, currentVersionId: versionId, status: 'review' as const }
                : sh,
            ),
          },
        })),

      queueEpisode: (episodeId) => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.episodeId === episodeId && (sh.status === 'draft' || sh.status === 'review'))
          .forEach((sh) => renderShot(sh.id))
      },

      queueAllPending: () => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.status === 'draft' || sh.status === 'review')
          .forEach((sh) => renderShot(sh.id))
      },

      updateShotPrompt: (shotId, prompt) =>
        set((s) => ({
          project: {
            ...s.project,
            shots: s.project.shots.map((sh) => {
              if (sh.id !== shotId || !sh.currentVersionId) return sh
              return {
                ...sh,
                versions: sh.versions.map((v) =>
                  v.id === sh.currentVersionId ? { ...v, prompt } : v,
                ),
              }
            }),
          },
        })),

      approveStyle: () => set((s) => ({ project: { ...s.project, styleApproved: true } })),

      restyleUnapproved: (feedback) => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.status !== 'approved' && sh.versions.length > 0)
          .forEach((sh) => renderShot(sh.id, feedback || '画风整体调整'))
      },

      tick: (dtMs) =>
        set((s) => {
          const perShotMs = s.settings.renderSecondsPerShot * 1000
          const isLocal = s.settings.mode === 'local'
          let changed = false
          // 角色立绘生成(内置渠道在演示模式下也走真实生成)
          const liveImage = isLocal || s.settings.imageProvider === 'builtin'
          const characters: Character[] = s.project.characters.map((c) => {
            if (c.status !== 'generating') return c
            changed = true
            if (!liveImage) return { ...c, status: 'review' as const }
            // 真实生成:等云端回调或轮询
            if (c.renderError) return { ...c, status: 'review' as const }
            if (c.comfyPromptId) pollCharacterImage(c.id, c.comfyPromptId, s.settings.comfyUrl)
            return c
          })
          // 分镜渲染:同一时间只渲染一个(单卡队列)
          let renderingSeen = false
          const shots: Shot[] = s.project.shots.map((sh) => {
            if (sh.status === 'rendering') {
              renderingSeen = true
              changed = true
              if (!isLocal) {
                // 演示模式:按时长推进
                const progress = sh.progress + (dtMs / perShotMs) * 100
                if (progress >= 100) return { ...sh, progress: 100, status: 'review' as const }
                return { ...sh, progress }
              }
              // 本地模式:已提交则轮询结果;未提交则等待提交回调
              if (sh.comfyPromptId) {
                // 用 progress 的小数位做简单节流:每 6 个 tick 轮询一次
                if (Math.floor(sh.progress) % 6 === 0) pollComfyShot(sh.id, sh.comfyPromptId, s.settings.comfyUrl)
                return { ...sh, progress: Math.min(95, sh.progress + 0.2) }
              }
              if (sh.renderError) return { ...sh, status: 'review' as const }
              return sh // 提交中,保持等待
            }
            if (sh.status === 'queued' && !renderingSeen) {
              renderingSeen = true
              changed = true
              if (!isLocal) return { ...sh, status: 'rendering' as const, progress: 0 }
              // 本地模式:组装工作流并提交到 ComfyUI
              const v = sh.versions.find((x) => x.id === sh.currentVersionId)
              if (!v) return { ...sh, status: 'review' as const, renderError: '没有可用版本' }
              const { width, height } = parseResolution(s.settings.resolution)
              const body = buildWorkflowBody(s.settings.workflowTemplate, {
                prompt: v.prompt,
                seed: v.seed,
                frames: Math.min(sh.duration, 15) * 24,
                steps: s.settings.steps,
                width,
                height,
              })
              if (!body.ok) {
                return { ...sh, status: 'rendering' as const, renderError: body.detail }
              }
              submitToComfy(sh.id, body.body)
              return { ...sh, status: 'rendering' as const, progress: 0, renderError: undefined, comfyPromptId: undefined }
            }
            return sh
          })
          if (!changed) return s
          return { project: { ...s.project, characters, shots } }
        }),

      resetAll: () => set({ project: EMPTY_PROJECT, step: 'novel' }),
    }),
    {
      name: 'duanju-studio-store',
      version: 2,
      // 旧版本缓存的角色数据缺少 designLog/evidence 字段,直接弃用重新来
      migrate: () => undefined as unknown as StoreState,
      // settings 与默认值深度合并,新增配置项对老缓存自动生效
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        }
      },
    },
  ),
)

// ============ 本地模式:ComfyUI 异步提交与轮询 ============

function patchShot(shotId: string, patch: (sh: Shot) => Shot) {
  useStore.setState((s) => ({
    project: {
      ...s.project,
      shots: s.project.shots.map((sh) => (sh.id === shotId ? patch(sh) : sh)),
    },
  }))
}

async function submitToComfy(shotId: string, workflowBody: string) {
  const { settings } = useStore.getState()
  const r = await submitComfyJob(settings, workflowBody)
  if (r.ok && r.promptId) {
    patchShot(shotId, (sh) => ({ ...sh, comfyPromptId: r.promptId }))
  } else {
    patchShot(shotId, (sh) => ({ ...sh, renderError: r.detail }))
  }
}

async function pollComfyShot(shotId: string, promptId: string, comfyUrl: string) {
  const r = await fetchComfyResult(comfyUrl, promptId)
  if (r.status === 'done') {
    patchShot(shotId, (sh) => ({
      ...sh,
      status: 'review',
      progress: 100,
      versions: sh.versions.map((v) =>
        v.id === sh.currentVersionId ? { ...v, videoUrl: r.videoUrl } : v,
      ),
    }))
  } else if (r.status === 'error') {
    patchShot(shotId, (sh) => ({ ...sh, renderError: r.detail }))
  }
}

// ============ 本地模式:角色设定图生成 ============

function patchCharacter(charId: string, patch: (c: Character) => Character) {
  useStore.setState((s) => ({
    project: {
      ...s.project,
      characters: s.project.characters.map((c) => (c.id === charId ? patch(c) : c)),
    },
  }))
}

async function submitCharacterImage(
  charId: string,
  versionId: string,
  prompt: string,
  seed: number,
  settings: Settings,
  refId?: string,
) {
  const r = await submitImageJob(settings, prompt, seed, refId)
  if (r.ok && r.kind === 'ready') {
    patchCharacter(charId, (c) => ({
      ...c,
      status: 'review',
      versions: c.versions.map((v) => (v.id === versionId ? { ...v, imageUrl: r.imageUrl } : v)),
    }))
  } else if (r.ok && r.kind === 'submitted') {
    patchCharacter(charId, (c) => ({ ...c, comfyPromptId: r.promptId }))
  } else if (!r.ok) {
    patchCharacter(charId, (c) => ({ ...c, renderError: r.detail }))
  }
}

async function pollCharacterImage(charId: string, promptId: string, comfyUrl: string) {
  // 内置服务的任务 ID 带 builtin: 前缀
  const r = promptId.startsWith('builtin:')
    ? await fetchBuiltinResult(promptId.slice(8))
    : await fetchComfyResult(comfyUrl, promptId, false)
  if (r.status === 'done') {
    patchCharacter(charId, (c) => ({
      ...c,
      status: 'review',
      comfyPromptId: undefined,
      versions: c.versions.map((v) =>
        v.id === c.currentVersionId ? { ...v, imageUrl: r.videoUrl } : v,
      ),
    }))
  } else if (r.status === 'error') {
    patchCharacter(charId, (c) => ({ ...c, renderError: r.detail, comfyPromptId: undefined }))
  }
}

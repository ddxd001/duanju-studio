// ============ 全局状态(zustand + localStorage 持久化 + 多项目管理) ============
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
  buildCharacterProfile,
  buildScript,
  refineDescription,
} from './mockData'
import { DEFAULT_H3_MODELS } from './comfyH3'
import {
  composePrompt,
  submitComfyVideoShot,
  fetchComfyResult,
  submitMiniMaxJob,
  fetchMiniMaxResult,
  submitImageJob,
  fetchBuiltinResult,
  llmAdaptScript,
  llmRefineCharacterDescription,
  llmRevisePrompt,
} from './engine'
import { revisePrompt, uid } from './prompt'

export const DEFAULT_SETTINGS: Settings = {
  mode: 'demo',
  videoProvider: 'comfy',
  comfyUrl: 'http://127.0.0.1:8188',
  comfyWorkflowMode: 'minimax-h3-auto',
  comfyRefImageSize: DEFAULT_H3_MODELS.refImageSize,
  comfyH3Steps: DEFAULT_H3_MODELS.steps,
  comfyH3Unet: DEFAULT_H3_MODELS.unet,
  comfyH3Clip: DEFAULT_H3_MODELS.clip,
  comfyH3VideoVae: DEFAULT_H3_MODELS.videoVae,
  comfyH3AudioVae: DEFAULT_H3_MODELS.audioVae,
  workflowTemplate: '',
  minimaxApiBase: 'https://api.minimaxi.com',
  minimaxApiKey: '',
  minimaxModel: 'MiniMax-H3',
  minimaxGenerateAudio: true,
  imageProvider: 'builtin',
  imageWorkflowTemplate: '',
  imageApiBase: 'https://api.openai.com/v1',
  imageApiKey: '',
  imageApiModel: 'gpt-image-1',
  llmBase: 'http://127.0.0.1:11434/v1',
  llmKey: '',
  llmModel: 'qwen2.5:14b',
  resolution: '576x1024',
  steps: 20,
  renderSecondsPerShot: 4,
  autoFix: true,
}

export function createEmptyProject(title = '未命名短剧'): Project {
  return {
    id: uid(),
    title,
    novelText: '',
    styleId: 'guoman3d',
    customStyle: '',
    episodeLength: 60,
    episodeCount: 3,
    styleApproved: false,
    episodes: [],
    characters: [],
    shots: [],
    updatedAt: Date.now(),
  }
}

export function getStyle(styleId: string): StylePreset {
  return STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0]
}

interface StoreState {
  step: StepId
  settings: Settings
  projects: Project[]
  activeProjectId: string
  project: Project // 当前激活项目的镜像,方便各页面直接读取
  adapting: boolean
  adaptError: string
  queuePaused: boolean
  // ---- 导航与设置 ----
  setStep: (s: StepId) => void
  setSettings: (p: Partial<Settings>) => void
  // ---- 多项目管理 ----
  createProject: (title?: string) => void
  switchProject: (projectId: string) => void
  deleteProject: (projectId: string) => void
  exportProjectJson: () => string
  importProjectJson: (raw: string) => { ok: boolean; detail: string }
  // ---- ① 小说输入 ----
  setNovelInfo: (
    p: Partial<Pick<Project, 'title' | 'novelText' | 'styleId' | 'customStyle' | 'episodeLength' | 'episodeCount'>>,
  ) => void
  applySample: () => void
  // ---- ② 剧本改编 ----
  adaptScript: () => Promise<void>
  updateShotField: (shotId: string, p: Partial<Pick<Shot, 'title' | 'basePrompt' | 'dialogue' | 'duration' | 'scene'>>) => void
  // ---- ③ 角色工坊 ----
  updateCharacterDesc: (id: string, desc: string) => void
  refineCharacter: (id: string, instruction: string) => Promise<void>
  renderCharacter: (id: string, feedback?: string, refId?: string) => Promise<void>
  confirmCharacter: (id: string) => void
  rollbackCharacter: (id: string, versionId: string) => void
  addCharacter: (p: { name: string; role: string; description: string }) => void
  removeCharacter: (id: string) => void
  renameCharacter: (id: string, p: { name: string; role: string }) => void
  // ---- ④⑤ 分镜 / 渲染 ----
  renderShot: (shotId: string, feedback?: string) => Promise<void>
  cancelShot: (shotId: string) => void
  toggleQueuePaused: () => void
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

function makeVersion(
  n: number,
  prompt: string,
  feedback: string,
  fixes: string[],
  refCharacters?: string[],
): Version {
  return {
    id: uid(),
    n,
    prompt,
    feedback,
    autoFix: fixes,
    seed: Math.floor(Math.random() * 1e9),
    createdAt: Date.now(),
    ...(refCharacters && refCharacters.length > 0 ? { refCharacters } : {}),
  }
}

/** 规范化 LLM 剧本与角色输出,并把分镜里出现但角色表遗漏的人物自动补齐 */
export function normalizeLlmScript(
  json: unknown,
  novelText: string,
): { characters: Character[]; episodes: Project['episodes']; shots: Shot[] } {
  const obj = json as { episodes?: unknown; characters?: unknown }
  const rawEpisodes = obj?.episodes
  if (!Array.isArray(rawEpisodes)) throw new Error('LLM 返回内容缺少 episodes 数组')
  const episodes: Project['episodes'] = []
  const shots: Shot[] = []
  rawEpisodes.forEach((raw, ei) => {
    const ep = raw as Record<string, unknown>
    const episodeId = uid()
    episodes.push({
      id: episodeId,
      index: ei + 1,
      title: String(ep.title || `第 ${ei + 1} 集`),
      synopsis: String(ep.synopsis || ''),
    })
    if (!Array.isArray(ep.shots)) return
    ep.shots.forEach((value, si) => {
      const sh = value as Record<string, unknown>
      shots.push({
        id: uid(),
        episodeId,
        index: si + 1,
        title: String(sh.title || `镜头 ${si + 1}`),
        scene: String(sh.scene || '主场景'),
        characters: Array.isArray(sh.characters) ? sh.characters.map(String).filter(Boolean) : [],
        basePrompt: String(sh.prompt || sh.basePrompt || ''),
        dialogue: String(sh.dialogue || ''),
        duration: Math.min(15, Math.max(4, Number(sh.duration) || 6)),
        status: 'draft',
        progress: 0,
        versions: [],
        currentVersionId: null,
      })
    })
  })
  if (!episodes.length || !shots.length) throw new Error('LLM 返回的剧本没有有效镜头')

  // 合并 LLM 提取的角色与分镜里提及的角色
  const charMap = new Map<string, Character>()
  const rawChars = Array.isArray(obj?.characters) ? obj.characters : []
  for (const item of rawChars) {
    const c = item as Record<string, unknown>
    const name = String(c.name ?? '').trim()
    if (!name || charMap.has(name)) continue
    const profile = buildCharacterProfile(name, novelText, [name])
    charMap.set(name, {
      id: uid(),
      name,
      role: String(c.role || '配角'),
      description: String(c.description || '').trim() || profile.description,
      evidence: profile.evidence,
      designLog: [],
      status: 'pending',
      versions: [],
      currentVersionId: null,
    })
  }
  const allShotCharNames = [...new Set(shots.flatMap((s) => s.characters))]
  for (const name of allShotCharNames) {
    if (charMap.has(name)) continue
    const profile = buildCharacterProfile(name, novelText, allShotCharNames)
    charMap.set(name, {
      id: uid(),
      name,
      role: charMap.size === 0 ? '主角' : '配角',
      description: profile.description,
      evidence: profile.evidence,
      designLog: [],
      status: 'pending',
      versions: [],
      currentVersionId: null,
    })
  }
  const characters = charMap.size > 0 ? [...charMap.values()] : buildCharacters(novelText)
  return { characters, episodes, shots }
}

/** 更新当前项目并同步到 projects 列表 */
function updateActiveProject(s: StoreState, updater: (p: Project) => Project): Partial<StoreState> {
  const next = { ...updater(s.project), updatedAt: Date.now() }
  const exists = s.projects.some((p) => p.id === next.id)
  const projects = exists
    ? s.projects.map((p) => (p.id === next.id ? next : p))
    : [next, ...s.projects]
  return { project: next, projects, activeProjectId: next.id }
}

/** 收集一个镜头涉及的角色设定图(优先已确认角色,否则取已出图角色) */
function collectShotCharacterRefs(project: Project, shot: Shot): { name: string; imageUrl: string }[] {
  const refs: { name: string; imageUrl: string }[] = []
  const seen = new Set<string>()
  const names = shot.characters.length > 0 ? shot.characters : project.characters.map((c) => c.name)
  for (const name of names) {
    if (seen.has(name)) continue
    const c = project.characters.find((x) => x.name === name)
    if (!c) continue
    // 如果 shot 明确指定了角色则取该角色当前设定图;若 shot 未标注角色,仅在角色名出现在画面描述里时注入
    if (shot.characters.length === 0 && !shot.basePrompt.includes(c.name) && !shot.title.includes(c.name)) continue
    const ver = c.versions.find((v) => v.id === c.currentVersionId) ?? c.versions[c.versions.length - 1]
    if (ver?.imageUrl) {
      refs.push({ name: c.name, imageUrl: ver.imageUrl })
      seen.add(name)
    }
  }
  return refs.slice(0, 9)
}

/** 页面刷新/重启后恢复卡死在“提交中”的任务状态 */
function recoverStuckProject(project: Project): Project {
  const shots = project.shots.map((sh) => {
    if (sh.status === 'rendering' && !sh.comfyPromptId) {
      return {
        ...sh,
        status: sh.versions.length > 0 ? ('review' as const) : ('draft' as const),
        progress: 0,
        renderError: sh.renderError || '上次渲染在提交阶段中断,请点击重试',
      }
    }
    return sh
  })
  const characters = project.characters.map((c) => {
    if (c.status === 'generating' && !c.comfyPromptId) {
      return {
        ...c,
        status: c.versions.length > 0 ? ('review' as const) : ('pending' as const),
        renderError: c.renderError || '上次立绘生成在提交阶段中断,请重试',
      }
    }
    return c
  })
  return { ...project, shots, characters }
}

const INITIAL_PROJECT = createEmptyProject()

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      step: 'novel',
      settings: DEFAULT_SETTINGS,
      projects: [INITIAL_PROJECT],
      activeProjectId: INITIAL_PROJECT.id,
      project: INITIAL_PROJECT,
      adapting: false,
      adaptError: '',
      queuePaused: false,

      setStep: (step) => set({ step }),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),

      createProject: (title) =>
        set((s) => {
          const fresh = createEmptyProject(title?.trim() || `未命名短剧 ${s.projects.length + 1}`)
          return {
            projects: [fresh, ...s.projects],
            activeProjectId: fresh.id,
            project: fresh,
            step: 'novel',
            adaptError: '',
          }
        }),

      switchProject: (projectId) =>
        set((s) => {
          const target = s.projects.find((p) => p.id === projectId)
          if (!target) return s
          return {
            activeProjectId: target.id,
            project: target,
            adaptError: '',
          }
        }),

      deleteProject: (projectId) =>
        set((s) => {
          const rest = s.projects.filter((p) => p.id !== projectId)
          if (rest.length === 0) {
            const fresh = createEmptyProject()
            return { projects: [fresh], activeProjectId: fresh.id, project: fresh, step: 'novel' }
          }
          const next = s.activeProjectId === projectId ? rest[0] : s.project
          return { projects: rest, activeProjectId: next.id, project: next }
        }),

      exportProjectJson: () => {
        const { project } = get()
        return JSON.stringify({ schema: 'duanju-studio-project-v1', exportedAt: Date.now(), project }, null, 2)
      },

      importProjectJson: (raw) => {
        try {
          const parsed = JSON.parse(raw) as { project?: Project } | Project
          const candidate = ('project' in parsed && parsed.project ? parsed.project : parsed) as Partial<Project>
          if (!candidate || typeof candidate.title !== 'string' || !Array.isArray(candidate.shots)) {
            return { ok: false, detail: '文件不是有效的短剧工坊项目 JSON' }
          }
          const imported: Project = recoverStuckProject({
            ...createEmptyProject(candidate.title),
            ...candidate,
            id: uid(),
            updatedAt: Date.now(),
          })
          set((s) => ({
            projects: [imported, ...s.projects],
            activeProjectId: imported.id,
            project: imported,
            step: imported.shots.length > 0 ? 'storyboard' : 'novel',
          }))
          return { ok: true, detail: `已导入项目「${imported.title}」` }
        } catch {
          return { ok: false, detail: '项目文件解析失败(非合法 JSON)' }
        }
      },

      setNovelInfo: (p) => set((s) => updateActiveProject(s, (proj) => ({ ...proj, ...p }))),

      applySample: () =>
        set((s) =>
          updateActiveProject(s, (proj) => ({ ...proj, title: '青州夜话', novelText: SAMPLE_NOVEL })),
        ),

      adaptScript: async () => {
        const { project, settings } = get()
        if (!project.novelText.trim() || get().adapting) return
        set({ adapting: true, adaptError: '' })
        try {
          if (settings.mode === 'local') {
            const r = await llmAdaptScript(
              settings,
              project.novelText,
              project.episodeCount,
              project.episodeLength,
            )
            if (!r.ok) {
              set({ adaptError: r.detail })
              return
            }
            const { characters, episodes, shots } = normalizeLlmScript(r.json, project.novelText)
            set((s) =>
              updateActiveProject(s, (proj) => ({
                ...proj,
                characters,
                episodes,
                shots,
                styleApproved: false,
              })),
            )
          } else {
            const characters = buildCharacters(project.novelText)
            const { episodes, shots } = buildScript(
              project.novelText,
              project.episodeCount,
              project.episodeLength,
            )
            set((s) =>
              updateActiveProject(s, (proj) => ({
                ...proj,
                characters,
                episodes,
                shots,
                styleApproved: false,
              })),
            )
          }
        } catch (e) {
          set({ adaptError: e instanceof Error ? e.message : '剧本结构解析失败,请重试' })
        } finally {
          set({ adapting: false })
        }
      },

      updateShotField: (shotId, p) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) => (sh.id === shotId ? { ...sh, ...p } : sh)),
          })),
        ),

      updateCharacterDesc: (id, desc) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) => (c.id === id ? { ...c, description: desc } : c)),
          })),
        ),

      refineCharacter: async (id, instruction) => {
        const { project, settings } = get()
        const target = project.characters.find((x) => x.id === id)
        if (!target) return

        let result: { newDesc: string; note: string }
        if (settings.mode === 'local') {
          const llmRes = await llmRefineCharacterDescription(settings, target.name, target.description, instruction)
          result = llmRes.ok ? llmRes : refineDescription(target.description, instruction)
        } else {
          result = refineDescription(target.description, instruction)
        }

        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) =>
              c.id !== id
                ? c
                : {
                    ...c,
                    description: result.newDesc,
                    designLog: [...(c.designLog ?? []), { instruction, note: result.note, at: Date.now() }],
                  },
            ),
          })),
        )
        const updated = get().project.characters.find((x) => x.id === id)
        if (updated && updated.versions.length > 0) await get().renderCharacter(id)
      },

      renderCharacter: async (id, feedback, refId) => {
        const snap = get()
        const target = snap.project.characters.find((c) => c.id === id)
        if (!target) return
        const style = getStyle(snap.project.styleId)
        const photoHint = refId ? '严格以参考照片中的形象为基准(长相/品种/毛色/特征保持一致),' : ''
        const base = `${photoHint}${style.keywords},${snap.project.customStyle},角色设定三视图(正面/侧面/背面):${target.name},${target.description},全身像,纯白干净背景,精美角色设计稿`

        let prompt = base
        let fixes: string[] = []
        if (feedback) {
          const prev = target.versions.find((v) => v.id === target.currentVersionId)
          if (snap.settings.mode === 'local' && snap.settings.autoFix) {
            const llm = await llmRevisePrompt(snap.settings, prev?.prompt ?? base, feedback)
            if (llm.ok) {
              prompt = llm.newPrompt
              fixes = llm.fixes
            } else {
              const r = revisePrompt(prev?.prompt ?? base, feedback, true)
              prompt = r.newPrompt
              fixes = r.fixes
            }
          } else {
            const r = revisePrompt(prev?.prompt ?? base, feedback, snap.settings.autoFix)
            prompt = r.newPrompt
            fixes = r.fixes
          }
        }

        const n = target.versions.length + 1
        const v = makeVersion(n, prompt, feedback ?? '', fixes)
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) =>
              c.id !== id
                ? c
                : {
                    ...c,
                    status: 'generating' as const,
                    versions: [...c.versions, v],
                    currentVersionId: v.id,
                    renderError: undefined,
                    comfyPromptId: undefined,
                  },
            ),
          })),
        )

        const s = get()
        if (s.settings.mode === 'local' || s.settings.imageProvider === 'builtin') {
          void submitCharacterImage(id, v.id, v.prompt, v.seed, s.settings, refId)
        }
      },

      confirmCharacter: (id) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) =>
              c.id === id ? { ...c, status: 'confirmed' as const } : c,
            ),
          })),
        ),

      rollbackCharacter: (id, versionId) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) =>
              c.id === id ? { ...c, currentVersionId: versionId, status: 'review' as const } : c,
            ),
          })),
        ),

      addCharacter: (p) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: [
              ...proj.characters,
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
          })),
        ),

      removeCharacter: (id) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.filter((c) => c.id !== id),
          })),
        ),

      renameCharacter: (id, p) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            characters: proj.characters.map((c) =>
              c.id === id ? { ...c, name: p.name, role: p.role } : c,
            ),
          })),
        ),

      renderShot: async (shotId, feedback) => {
        const snap = get()
        const sh = snap.project.shots.find((x) => x.id === shotId)
        if (!sh) return
        const style = getStyle(snap.project.styleId)
        const descs = sh.characters.map(
          (name) => snap.project.characters.find((c) => c.name === name)?.description ?? '',
        )
        const base = composePrompt({
          basePrompt: sh.basePrompt,
          styleKeywords: style.keywords,
          customStyle: snap.project.customStyle,
          characterNames: sh.characters,
          characterDescs: descs,
        })
        const refs = collectShotCharacterRefs(snap.project, sh)

        let prompt = base
        let fixes: string[] = []
        if (feedback) {
          const prev = sh.versions.find((v) => v.id === sh.currentVersionId)
          if (snap.settings.mode === 'local' && snap.settings.autoFix) {
            const llm = await llmRevisePrompt(snap.settings, prev?.prompt ?? base, feedback)
            if (llm.ok) {
              prompt = llm.newPrompt
              fixes = llm.fixes
            } else {
              const r = revisePrompt(prev?.prompt ?? base, feedback, true)
              prompt = r.newPrompt
              fixes = r.fixes
            }
          } else {
            const r = revisePrompt(prev?.prompt ?? base, feedback, snap.settings.autoFix)
            prompt = r.newPrompt
            fixes = r.fixes
          }
        }

        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((item) => {
              if (item.id !== shotId) return item
              const v = makeVersion(
                item.versions.length + 1,
                prompt,
                feedback ?? '',
                fixes,
                refs.map((r) => r.name),
              )
              return {
                ...item,
                status: 'queued' as const,
                progress: 0,
                versions: [...item.versions, v],
                currentVersionId: v.id,
                renderError: undefined,
                comfyPromptId: undefined,
              }
            }),
          })),
        )
      },

      cancelShot: (shotId) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) => {
              if (sh.id !== shotId || (sh.status !== 'queued' && sh.status !== 'rendering')) return sh
              const hasOutput = sh.versions.some((v) => v.id === sh.currentVersionId && v.videoUrl)
              return {
                ...sh,
                status: hasOutput ? ('review' as const) : ('draft' as const),
                progress: 0,
                comfyPromptId: undefined,
                renderError: '已手动取消排队/渲染',
              }
            }),
          })),
        ),

      toggleQueuePaused: () => set((s) => ({ queuePaused: !s.queuePaused })),

      approveShot: (shotId) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) => (sh.id === shotId ? { ...sh, status: 'approved' as const } : sh)),
          })),
        ),

      approveAllReview: () =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) => (sh.status === 'review' ? { ...sh, status: 'approved' as const } : sh)),
          })),
        ),

      rollbackShot: (shotId, versionId) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) =>
              sh.id === shotId ? { ...sh, currentVersionId: versionId, status: 'review' as const } : sh,
            ),
          })),
        ),

      queueEpisode: (episodeId) => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.episodeId === episodeId && (sh.status === 'draft' || sh.status === 'review'))
          .forEach((sh) => void renderShot(sh.id))
      },

      queueAllPending: () => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.status === 'draft' || sh.status === 'review')
          .forEach((sh) => void renderShot(sh.id))
      },

      updateShotPrompt: (shotId, prompt) =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...proj,
            shots: proj.shots.map((sh) => {
              if (sh.id !== shotId || !sh.currentVersionId) return sh
              return {
                ...sh,
                versions: sh.versions.map((v) => (v.id === sh.currentVersionId ? { ...v, prompt } : v)),
              }
            }),
          })),
        ),

      approveStyle: () =>
        set((s) => updateActiveProject(s, (proj) => ({ ...proj, styleApproved: true }))),

      restyleUnapproved: (feedback) => {
        const { project, renderShot } = get()
        project.shots
          .filter((sh) => sh.status !== 'approved' && sh.versions.length > 0)
          .forEach((sh) => void renderShot(sh.id, feedback || '画风整体调整'))
      },

      tick: (dtMs) =>
        set((s) => {
          const perShotMs = s.settings.renderSecondsPerShot * 1000
          const isLocal = s.settings.mode === 'local'
          let changed = false

          // 角色立绘生成(带节流轮询)
          const liveImage = isLocal || s.settings.imageProvider === 'builtin'
          const characters: Character[] = s.project.characters.map((c) => {
            if (c.status !== 'generating') return c
            changed = true
            if (!liveImage) return { ...c, status: 'review' as const }
            if (c.renderError) return { ...c, status: 'review' as const }
            if (c.comfyPromptId) maybePollCharacterImage(s.project.id, c.id, c.comfyPromptId, s.settings.comfyUrl)
            return c
          })

          // 分镜渲染:同一时间只渲染一个(单卡队列)
          let renderingSeen = false
          const shots: Shot[] = s.project.shots.map((sh) => {
            if (sh.status === 'rendering') {
              renderingSeen = true
              changed = true
              if (!isLocal) {
                const progress = sh.progress + (dtMs / perShotMs) * 100
                if (progress >= 100) return { ...sh, progress: 100, status: 'review' as const }
                return { ...sh, progress }
              }
              if (sh.comfyPromptId) {
                maybePollVideoShot(s.project.id, sh.id, sh.comfyPromptId)
                return { ...sh, progress: Math.min(95, sh.progress + 0.2) }
              }
              if (sh.renderError) return { ...sh, status: 'review' as const }
              return sh
            }
            if (sh.status === 'queued' && !renderingSeen && !s.queuePaused) {
              renderingSeen = true
              changed = true
              if (!isLocal) return { ...sh, status: 'rendering' as const, progress: 0 }
              const v = sh.versions.find((x) => x.id === sh.currentVersionId)
              if (!v) return { ...sh, status: 'review' as const, renderError: '没有可用版本' }
              const refs = collectShotCharacterRefs(s.project, sh)
              if (s.settings.videoProvider === 'minimax') {
                void submitToMiniMax(s.project.id, sh.id, v.prompt, sh.duration, v.id, refs)
              } else {
                void submitToComfy(s.project.id, sh.id, v.prompt, v.seed, sh.duration, v.id, refs)
              }
              return {
                ...sh,
                status: 'rendering' as const,
                progress: 0,
                renderError: undefined,
                comfyPromptId: undefined,
              }
            }
            return sh
          })
          if (!changed) return s
          return updateActiveProject(s, (proj) => ({ ...proj, characters, shots }))
        }),

      resetAll: () =>
        set((s) =>
          updateActiveProject(s, (proj) => ({
            ...createEmptyProject(proj.title),
            id: proj.id,
          })),
        ),
    }),
    {
      name: 'duanju-studio-store',
      version: 3,
      migrate: (persisted: unknown) => {
        const old = (persisted ?? {}) as Partial<StoreState>
        const settings = { ...DEFAULT_SETTINGS, ...(old.settings ?? {}) }
        // 从 v2 单项目结构无缝升级到 v3 多项目结构
        if (old.project && !Array.isArray(old.projects)) {
          const upgraded: Project = recoverStuckProject({
            ...createEmptyProject(),
            ...old.project,
            id: (old.project as Partial<Project>).id || uid(),
            updatedAt: (old.project as Partial<Project>).updatedAt || Date.now(),
          })
          return {
            step: old.step ?? 'novel',
            settings,
            projects: [upgraded],
            activeProjectId: upgraded.id,
            project: upgraded,
            adapting: false,
            adaptError: '',
            queuePaused: false,
          } as StoreState
        }
        if (Array.isArray(old.projects) && old.projects.length > 0) {
          const projects = old.projects.map(recoverStuckProject)
          const active = projects.find((p) => p.id === old.activeProjectId) ?? projects[0]
          return {
            step: old.step ?? 'novel',
            settings,
            projects,
            activeProjectId: active.id,
            project: active,
            adapting: false,
            adaptError: '',
            queuePaused: false,
          } as StoreState
        }
        const fresh = createEmptyProject()
        return {
          step: 'novel',
          settings,
          projects: [fresh],
          activeProjectId: fresh.id,
          project: fresh,
          adapting: false,
          adaptError: '',
          queuePaused: false,
        } as StoreState
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>
        const rawProjects =
          Array.isArray(p.projects) && p.projects.length > 0
            ? p.projects.map(recoverStuckProject)
            : p.project
              ? [recoverStuckProject({ ...createEmptyProject(), ...p.project, id: p.project.id || uid() })]
              : current.projects
        const active =
          rawProjects.find((x) => x.id === p.activeProjectId) ?? rawProjects[0] ?? current.project
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          projects: rawProjects,
          activeProjectId: active.id,
          project: active,
          adapting: false,
          adaptError: '',
        }
      },
    },
  ),
)

// ============ 异步提交与节流轮询 ============

function patchProjectById(projectId: string, updater: (p: Project) => Project) {
  useStore.setState((s) => {
    const projects = s.projects.map((p) => (p.id === projectId ? { ...updater(p), updatedAt: Date.now() } : p))
    const active = projects.find((p) => p.id === s.activeProjectId) ?? s.project
    return { projects, project: active }
  })
}

function patchShot(projectId: string, shotId: string, patch: (sh: Shot) => Shot) {
  patchProjectById(projectId, (p) => ({
    ...p,
    shots: p.shots.map((sh) => (sh.id === shotId ? patch(sh) : sh)),
  }))
}

function patchCharacter(projectId: string, charId: string, patch: (c: Character) => Character) {
  patchProjectById(projectId, (p) => ({
    ...p,
    characters: p.characters.map((c) => (c.id === charId ? patch(c) : c)),
  }))
}

async function submitToComfy(
  projectId: string,
  shotId: string,
  prompt: string,
  seed: number,
  duration: number,
  versionId: string,
  characterRefs: { name: string; imageUrl: string }[],
) {
  const { settings } = useStore.getState()
  const r = await submitComfyVideoShot({ settings, prompt, seed, seconds: duration, characterRefs })
  patchShot(projectId, shotId, (sh) => {
    if (sh.currentVersionId !== versionId || sh.status !== 'rendering') return sh
    const versions = sh.versions.map((v) =>
      v.id === versionId ? { ...v, refCharacters: r.usedRefs } : v,
    )
    return r.ok && r.promptId
      ? { ...sh, versions, comfyPromptId: r.promptId }
      : { ...sh, versions, renderError: r.detail }
  })
}

async function submitToMiniMax(
  projectId: string,
  shotId: string,
  prompt: string,
  duration: number,
  versionId: string,
  characterRefs: { name: string; imageUrl: string }[],
) {
  const { settings } = useStore.getState()
  const r = await submitMiniMaxJob(settings, prompt, duration, characterRefs)
  patchShot(projectId, shotId, (sh) => {
    if (sh.currentVersionId !== versionId || sh.status !== 'rendering') return sh
    const versions = sh.versions.map((v) =>
      v.id === versionId ? { ...v, refCharacters: r.usedRefs } : v,
    )
    return r.ok && r.promptId
      ? { ...sh, versions, comfyPromptId: r.promptId }
      : { ...sh, versions, renderError: r.detail }
  })
}

const videoPollAt = new Map<string, number>()
const videoPolling = new Set<string>()

function maybePollVideoShot(projectId: string, shotId: string, promptId: string) {
  const key = `${projectId}:${shotId}:${promptId}`
  const isMiniMax = promptId.startsWith('minimax:')
  const now = Date.now()
  if (videoPolling.has(key) || now - (videoPollAt.get(key) ?? 0) < (isMiniMax ? 10000 : 3000)) return
  videoPollAt.set(key, now)
  videoPolling.add(key)
  void pollVideoShot(projectId, shotId, promptId).finally(() => videoPolling.delete(key))
}

async function pollVideoShot(projectId: string, shotId: string, promptId: string) {
  const { settings } = useStore.getState()
  const r = promptId.startsWith('minimax:')
    ? await fetchMiniMaxResult(settings, promptId.slice(8))
    : await fetchComfyResult(settings.comfyUrl, promptId, true)
  if (r.status === 'done') {
    patchShot(projectId, shotId, (sh) => {
      if (sh.comfyPromptId !== promptId) return sh
      return {
        ...sh,
        status: 'review',
        progress: 100,
        comfyPromptId: undefined,
        renderError: undefined,
        versions: sh.versions.map((v) =>
          v.id === sh.currentVersionId ? { ...v, videoUrl: r.videoUrl } : v,
        ),
      }
    })
  } else if (r.status === 'error') {
    patchShot(projectId, shotId, (sh) =>
      sh.comfyPromptId === promptId ? { ...sh, renderError: r.detail, comfyPromptId: undefined } : sh,
    )
  }
}

async function submitCharacterImage(
  charId: string,
  versionId: string,
  prompt: string,
  seed: number,
  settings: Settings,
  refId?: string,
) {
  const projectId = useStore.getState().activeProjectId
  const r = await submitImageJob(settings, prompt, seed, refId)
  if (r.ok && r.kind === 'ready') {
    patchCharacter(projectId, charId, (c) => ({
      ...c,
      status: 'review',
      versions: c.versions.map((v) => (v.id === versionId ? { ...v, imageUrl: r.imageUrl } : v)),
    }))
  } else if (r.ok && r.kind === 'submitted') {
    patchCharacter(projectId, charId, (c) => ({ ...c, comfyPromptId: r.promptId }))
  } else if (!r.ok) {
    patchCharacter(projectId, charId, (c) => ({ ...c, renderError: r.detail }))
  }
}

const charPollAt = new Map<string, number>()
const charPolling = new Set<string>()

function maybePollCharacterImage(projectId: string, charId: string, promptId: string, comfyUrl: string) {
  const key = `${projectId}:${charId}:${promptId}`
  const now = Date.now()
  if (charPolling.has(key) || now - (charPollAt.get(key) ?? 0) < 2500) return
  charPollAt.set(key, now)
  charPolling.add(key)
  void pollCharacterImage(projectId, charId, promptId, comfyUrl).finally(() => charPolling.delete(key))
}

async function pollCharacterImage(projectId: string, charId: string, promptId: string, comfyUrl: string) {
  const r = promptId.startsWith('builtin:')
    ? await fetchBuiltinResult(promptId.slice(8))
    : await fetchComfyResult(comfyUrl, promptId, false)
  if (r.status === 'done') {
    patchCharacter(projectId, charId, (c) => ({
      ...c,
      status: 'review',
      comfyPromptId: undefined,
      versions: c.versions.map((v) =>
        v.id === c.currentVersionId ? { ...v, imageUrl: r.videoUrl } : v,
      ),
    }))
  } else if (r.status === 'error') {
    patchCharacter(projectId, charId, (c) => ({ ...c, renderError: r.detail, comfyPromptId: undefined }))
  }
}

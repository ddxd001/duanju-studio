// ============ 生成引擎适配层 ============
// demo 模式: 本地模拟(画面由 seed 决定,立即可预览完整流程)
// local 模式: 对接本地 ComfyUI(内置 MiniMax-H3 自动 T2VA/Ref2VA 或自定义模板)、
//             MiniMax 云端 H3、以及 OpenAI 兼容 LLM / 图像接口
import type { Settings } from '@/types'
import { buildMiniMaxH3Workflow, type H3ReferenceInput } from './comfyH3'

/** 组装一段分镜的完整提示词 */
export function composePrompt(opts: {
  basePrompt: string
  styleKeywords: string
  customStyle: string
  characterNames: string[]
  characterDescs: string[]
}): string {
  const parts = [
    opts.styleKeywords,
    opts.customStyle,
    ...opts.characterDescs
      .map((d, i) => (d ? `${opts.characterNames[i]}:${d}` : opts.characterNames[i]))
      .filter(Boolean),
    opts.basePrompt,
    '竖屏9:16构图,画面主体居中,电影感打光',
  ].filter(Boolean)
  return parts.join(',')
}

function cleanBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// ============ ComfyUI 真实渲染链路(经本地同源代理,无 CORS 问题) ============

/**
 * 把自定义工作流模板与本次渲染参数合成 ComfyUI API 工作流对象。
 * 支持占位符:
 *   {{prompt}} {{seed}} {{frames}} {{steps}} {{width}} {{height}}
 *   {{ref_image}} / {{ref_image_1}} .. {{ref_image_9}} (已上传的 ComfyUI 参考图文件名)
 */
export function buildWorkflowBody(
  template: string,
  vars: {
    prompt: string
    seed: number
    frames: number
    steps: number
    width: number
    height: number
    refImages?: string[]
  },
): { ok: true; promptObj: Record<string, unknown>; body: string } | { ok: false; detail: string } {
  if (!template.trim()) {
    return { ok: false, detail: '自定义工作流模板为空,请导入 API JSON 或切换回内置 MiniMax-H3 模式' }
  }
  let out = template
  const escapedPrompt = vars.prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
  const map: Record<string, string | number> = {
    prompt: escapedPrompt,
    seed: vars.seed,
    frames: vars.frames,
    steps: vars.steps,
    width: vars.width,
    height: vars.height,
    ref_image: vars.refImages?.[0] ?? '',
  }
  ;(vars.refImages ?? []).forEach((img, idx) => {
    map[`ref_image_${idx + 1}`] = img
  })

  for (const [k, v] of Object.entries(map)) {
    const asString = new RegExp(`"\\{\\{${k}\\}\\}"`, 'g')
    const asBare = new RegExp(`\\{\\{${k}\\}\\}`, 'g')
    if (typeof v === 'number') {
      out = out.replace(asString, String(v)).replace(asBare, String(v))
    } else {
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      out = out.replace(asString, `"${escaped}"`).replace(asBare, escaped)
    }
  }
  try {
    const parsed = JSON.parse(out) as Record<string, unknown>
    return { ok: true, promptObj: parsed, body: JSON.stringify({ prompt: parsed }) }
  } catch {
    return { ok: false, detail: '工作流模板不是合法 JSON(替换占位符后解析失败)' }
  }
}

/** 探测 ComfyUI 是否在线(经本地代理转发,避免浏览器跨域拦截) */
export async function pingComfy(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('/api/comfy/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyUrl: cleanBase(url) }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      return { ok: false, detail: data.error ?? '无法连接 ComfyUI,请确认它已启动' }
    }
    const device = data.stats?.devices?.[0]?.name
    return { ok: true, detail: device ? `ComfyUI 已连接(${device})` : 'ComfyUI 连接成功' }
  } catch {
    return { ok: false, detail: '连不上本地代理或 ComfyUI,请确认服务已启动' }
  }
}

/** 把角色设定图上传到 ComfyUI input 目录,返回供 LoadImage 使用的文件名 */
export async function uploadImageToComfy(
  comfyUrl: string,
  imageUrl: string,
  filename?: string,
): Promise<{ ok: true; name: string } | { ok: false; detail: string }> {
  try {
    const res = await fetch('/api/comfy/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyUrl: cleanBase(comfyUrl), imageUrl, filename }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.name) {
      return { ok: false, detail: data.error ?? `上传参考图失败(${res.status})` }
    }
    return { ok: true, name: data.name }
  } catch {
    return { ok: false, detail: '上传参考图到 ComfyUI 失败(本地代理不可达)' }
  }
}

/** 提交 ComfyUI 工作流对象,返回 prompt_id */
export async function submitComfyJob(
  settings: Settings,
  promptObj: Record<string, unknown>,
): Promise<{ ok: boolean; promptId?: string; detail: string }> {
  try {
    const res = await fetch('/api/comfy/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyUrl: cleanBase(settings.comfyUrl), prompt: promptObj }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.promptId) {
      return { ok: false, detail: data.error ?? `ComfyUI 拒绝任务(${res.status})` }
    }
    return { ok: true, promptId: data.promptId, detail: '已提交' }
  } catch {
    return { ok: false, detail: `连不上 ComfyUI(${settings.comfyUrl}),请确认它已启动` }
  }
}

/** 提交一个分镜镜头到 ComfyUI:自动上传角色参考图并选择 MiniMax-H3 T2VA/Ref2VA 或自定义模板 */
export async function submitComfyVideoShot(opts: {
  settings: Settings
  prompt: string
  seed: number
  seconds: number
  characterRefs: { name: string; imageUrl: string }[]
}): Promise<{ ok: boolean; promptId?: string; usedRefs: string[]; detail: string }> {
  const { settings, prompt, seed, seconds, characterRefs } = opts
  const { width, height } = parseResolution(settings.resolution)

  // 上传角色设定图到 ComfyUI,失败不中断(降级为纯文本并提示)
  const uploadedRefs: H3ReferenceInput[] = []
  for (const ref of characterRefs.slice(0, 9)) {
    const up = await uploadImageToComfy(settings.comfyUrl, ref.imageUrl, ref.name)
    if (up.ok) {
      uploadedRefs.push({ characterName: ref.name, comfyImageName: up.name })
    }
  }

  let promptObj: Record<string, unknown>
  if (settings.comfyWorkflowMode === 'custom' && settings.workflowTemplate.trim()) {
    const built = buildWorkflowBody(settings.workflowTemplate, {
      prompt,
      seed,
      frames: Math.min(seconds, 15) * 24,
      steps: settings.steps,
      width,
      height,
      refImages: uploadedRefs.map((r) => r.comfyImageName),
    })
    if (!built.ok) return { ok: false, usedRefs: [], detail: built.detail }
    promptObj = built.promptObj
  } else {
    // 内置本地 MiniMax-H3(自动按是否存在角色参考图切换 T2VA / Ref2VA)
    promptObj = buildMiniMaxH3Workflow({
      prompt,
      seed,
      seconds,
      width,
      height,
      refs: uploadedRefs,
      models: {
        unet: settings.comfyH3Unet,
        clip: settings.comfyH3Clip,
        videoVae: settings.comfyH3VideoVae,
        audioVae: settings.comfyH3AudioVae,
        steps: settings.comfyH3Steps,
        refImageSize: settings.comfyRefImageSize,
      },
    })
  }

  const r = await submitComfyJob(settings, promptObj)
  return {
    ok: r.ok,
    promptId: r.promptId,
    usedRefs: uploadedRefs.map((x) => x.characterName),
    detail: r.detail,
  }
}

export type ComfyResult =
  | { status: 'pending' }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; detail: string }

/** 轮询 ComfyUI 任务结果;完成后本地代理会自动缓存成片到 /generated/ */
export async function fetchComfyResult(
  comfyUrl: string,
  promptId: string,
  preferVideo = true,
): Promise<ComfyResult> {
  try {
    const res = await fetch('/api/comfy/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyUrl: cleanBase(comfyUrl), promptId, preferVideo }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'pending' }
    if (data.status === 'done' && data.mediaUrl) return { status: 'done', videoUrl: data.mediaUrl }
    if (data.status === 'error') return { status: 'error', detail: data.detail ?? 'ComfyUI 渲染失败' }
    return { status: 'pending' }
  } catch {
    return { status: 'pending' }
  }
}

// ============ MiniMax H3 云端视频链路 ============

function friendlyVideoError(detail: string): string {
  if (/401|403|unauthorized|invalid.*key|api.?key/i.test(detail))
    return 'MiniMax 鉴权失败,请检查 API Key 是否完整、是否与接口地区匹配'
  if (/402|balance|insufficient|余额|欠费/i.test(detail))
    return 'MiniMax 账户余额不足或尚未开通按量付费,请到官方平台处理'
  if (/429|rate.?limit/i.test(detail)) return 'MiniMax 请求过于频繁,请稍后再手动重试'
  return detail
}

/** 创建 H3 视频任务。只提交一次,网络失败也不自动重试,避免重复计费。 */
export async function submitMiniMaxJob(
  settings: Settings,
  prompt: string,
  seconds: number,
  characterRefs: { name: string; imageUrl: string }[] = [],
): Promise<{ ok: boolean; promptId?: string; usedRefs: string[]; detail: string }> {
  if (!settings.minimaxApiKey.trim()) return { ok: false, usedRefs: [], detail: '请先在设置中填写 MiniMax API Key' }
  if (!settings.minimaxApiBase.trim()) return { ok: false, usedRefs: [], detail: '请先填写 MiniMax 接口地址' }
  const duration = Math.min(15, Math.max(settings.minimaxModel.includes('Max') ? 5 : 4, Math.round(seconds)))

  // 若角色设定图是公网 URL,可作为多模态参考注入 content
  const publicRefs = characterRefs.filter((r) => /^https?:\/\//i.test(r.imageUrl)).slice(0, 3)
  const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }]
  for (const ref of publicRefs) {
    content.push({ type: 'image_url', image_url: { url: ref.imageUrl } })
  }

  try {
    const res = await fetch('/api/video/minimax/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: cleanBase(settings.minimaxApiBase),
        apiKey: settings.minimaxApiKey.trim(),
        payload: {
          model: settings.minimaxModel.trim() || 'MiniMax-H3',
          content,
          resolution: parseResolution(settings.resolution).width >= 1080 ? '2K' : '768P',
          duration,
          ratio: '9:16',
          generate_audio: settings.minimaxGenerateAudio,
        },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, usedRefs: [], detail: friendlyVideoError(data.error ?? `MiniMax 返回 ${res.status}`) }
    if (!data.taskId) return { ok: false, usedRefs: [], detail: 'MiniMax 未返回任务 ID,未开始轮询' }
    return { ok: true, promptId: `minimax:${data.taskId}`, usedRefs: publicRefs.map((r) => r.name), detail: '已提交' }
  } catch {
    return {
      ok: false,
      usedRefs: [],
      detail: '连不上内置视频代理,请重启软件;为避免重复扣费,请确认任务是否已创建后再重试',
    }
  }
}

export async function fetchMiniMaxResult(settings: Settings, taskId: string): Promise<ComfyResult> {
  try {
    const res = await fetch('/api/video/minimax/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: cleanBase(settings.minimaxApiBase),
        apiKey: settings.minimaxApiKey.trim(),
        taskId,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'error', detail: friendlyVideoError(data.error ?? `MiniMax 查询返回 ${res.status}`) }
    if (data.status === 'done' && data.videoUrl) return { status: 'done', videoUrl: data.videoUrl }
    if (data.status === 'error') return { status: 'error', detail: friendlyVideoError(data.error ?? '视频生成失败') }
    return { status: 'pending' }
  } catch {
    return { status: 'pending' }
  }
}

export async function checkMiniMaxConfig(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  if (!settings.minimaxApiBase.trim() || !settings.minimaxApiKey.trim() || !settings.minimaxModel.trim())
    return { ok: false, detail: '请完整填写接口地址、API Key 和模型名' }
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, detail: '内置视频代理不可用,请重启软件' }
    return { ok: true, detail: '配置完整,本地代理正常;此检查不会创建付费任务' }
  } catch {
    return { ok: false, detail: '内置视频代理不可用,请重启软件' }
  }
}

// ============ 整集 MP4 导出 ============

export async function exportEpisodeVideos(
  title: string,
  videoUrls: string[],
): Promise<{ ok: true; videoUrl: string; filename: string; clipCount: number; engine: string } | { ok: false; detail: string }> {
  try {
    const res = await fetch('/api/video/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, videoUrls }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.videoUrl) {
      return { ok: false, detail: data.error ?? `整集导出失败(${res.status})` }
    }
    return {
      ok: true,
      videoUrl: data.videoUrl,
      filename: data.filename ?? `${title}.mp4`,
      clipCount: data.clipCount ?? videoUrls.length,
      engine: data.engine ?? 'unknown',
    }
  } catch {
    return { ok: false, detail: '连不上本地媒体服务,无法导出整集' }
  }
}

// ============ 立绘/设定图生成 ============

export async function fetchBuiltinResult(jobId: string): Promise<ComfyResult> {
  try {
    const res = await fetch(`/api/image/${jobId}`)
    if (!res.ok) return { status: 'error', detail: '任务不存在(服务可能已重启),请重新生成' }
    const data = await res.json()
    if (data.status === 'done' && data.imageUrl) return { status: 'done', videoUrl: data.imageUrl }
    if (data.status === 'error') return { status: 'error', detail: friendlyImageError(data.error ?? '生成失败') }
    return { status: 'pending' }
  } catch {
    return { status: 'pending' }
  }
}

export type ImageJobResult =
  | { ok: true; kind: 'ready'; imageUrl: string }
  | { ok: true; kind: 'submitted'; promptId: string }
  | { ok: false; detail: string }

export async function uploadReferenceImage(
  file: File,
): Promise<{ ok: boolean; refId?: string; previewUrl?: string; detail: string }> {
  try {
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || 'png')
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataBase64: btoa(binary), ext }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, detail: data.error ?? `上传失败(${res.status})` }
    }
    const data = await res.json()
    if (!data.refId) return { ok: false, detail: '图像服务未返回照片标识' }
    return { ok: true, refId: data.refId, previewUrl: data.previewUrl, detail: '已上传' }
  } catch {
    return { ok: false, detail: '连不上内置图像服务,无法上传照片' }
  }
}

export function friendlyImageError(detail: string): string {
  if (/moderation|copyright|rejected/i.test(detail))
    return '被生成平台的内容审核拦截。请调整设定描述的措辞(避免敏感词汇)后重试'
  if (/ConnectTimeout|timed? ?out|超时/i.test(detail))
    return '生成服务连接超时,请检查网络后重试'
  if (/API key|api_key/i.test(detail)) return '生成服务缺少密钥,请检查配置后重试'
  return detail
}

export async function submitImageJob(
  settings: Settings,
  prompt: string,
  seed: number,
  refId?: string,
): Promise<ImageJobResult> {
  if (settings.imageProvider === 'builtin') {
    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size: '1536x1024', ...(refId ? { refId } : {}) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, detail: friendlyImageError(data.error ?? `图像服务返回 ${res.status}`) }
      }
      const data = await res.json()
      if (!data.jobId) return { ok: false, detail: '图像服务未返回任务 ID' }
      return { ok: true, kind: 'submitted', promptId: `builtin:${data.jobId}` }
    } catch {
      return {
        ok: false,
        detail: '连不上内置图像服务,请确认本地服务已启动',
      }
    }
  }
  if (settings.imageProvider === 'cloudapi') {
    try {
      const res = await fetch('/api/image/cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: cleanBase(settings.imageApiBase),
          apiKey: settings.imageApiKey,
          payload: { model: settings.imageApiModel, prompt, size: '1024x1536', seed },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, detail: friendlyImageError(data.error ?? `图像接口返回 ${res.status}`) }
      const item = data.data?.[0]
      const url = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null)
      if (!url) return { ok: false, detail: '图像接口未返回图片' }
      return { ok: true, kind: 'ready', imageUrl: url }
    } catch {
      return { ok: false, detail: '连不上内置图像代理,请重启软件后检查配置' }
    }
  }
  const built = buildWorkflowBody(settings.imageWorkflowTemplate, {
    prompt,
    seed,
    frames: 1,
    steps: settings.steps,
    width: 1024,
    height: 1536,
  })
  if (!built.ok) return { ok: false, detail: built.detail }
  const r = await submitComfyJob(settings, built.promptObj)
  if (!r.ok) return { ok: false, detail: r.detail }
  return { ok: true, kind: 'submitted', promptId: r.promptId! }
}

export function parseResolution(res: string): { width: number; height: number } {
  const [w, h] = res.split('x').map(Number)
  return { width: w || 576, height: h || 1024 }
}

// ============ LLM 剧本改编、角色抽取与反馈改写(local 模式) ============

async function requestLlm(settings: Settings, payload: Record<string, unknown>) {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: cleanBase(settings.llmBase),
      apiKey: settings.llmKey,
      payload,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `LLM 返回 ${res.status}`)
  return data
}

function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('LLM 没有返回合法 JSON')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export async function llmAdaptScript(
  settings: Settings,
  novelText: string,
  episodeCount: number,
  episodeLength: number,
): Promise<{ ok: boolean; detail: string; json?: unknown }> {
  try {
    const data = await requestLlm(settings, {
      model: settings.llmModel,
      messages: [
        {
          role: 'system',
          content:
            '你是专业短剧编剧与视觉导演。把小说改编为角色表与分集分镜脚本，只输出合法 JSON，不要 Markdown 解释：' +
            '{"characters":[{"name":"姓名","role":"主角/对手/配角/宠物","description":"年龄、性别、五官、发型、服饰与标志物品的具象视觉描述"}],' +
            '"episodes":[{"title":"第1集 标题","synopsis":"本集梗概","shots":[{"title":"镜头摘要","scene":"场景","characters":["出场角色名"],"dialogue":"台词或旁白","prompt":"具体画面、人物动作、光影与镜头运动描述","duration":6}]}]}。' +
            '每个镜头 duration 在 4-15 秒之间，characters 里的名字必须与顶层 characters 数组一致。',
        },
        {
          role: 'user',
          content: `目标集数:${episodeCount}，每集目标时长约 ${episodeLength} 秒。\n\n小说原文:\n${novelText}`,
        },
      ],
      temperature: 0.7,
    })
    const content = data.choices?.[0]?.message?.content ?? ''
    const json = extractJsonObject(content)
    return { ok: true, detail: '改编完成', json }
  } catch (e) {
    return { ok: false, detail: `LLM 调用失败:${e instanceof Error ? e.message : '请检查接口配置'}` }
  }
}

/** 用真实 LLM 根据自然语言指令改写角色外形设定 */
export async function llmRefineCharacterDescription(
  settings: Settings,
  name: string,
  currentDesc: string,
  instruction: string,
): Promise<{ ok: true; newDesc: string; note: string } | { ok: false }> {
  if (!settings.llmBase.trim() || !settings.llmModel.trim()) return { ok: false }
  try {
    const data = await requestLlm(settings, {
      model: settings.llmModel,
      messages: [
        {
          role: 'system',
          content:
            '你是角色美术设定师。根据用户要求修改角色的外形视觉描述，保留未提及的原设定，用简洁中文短语逗号分隔。只输出合法 JSON：{"description":"修改后的完整设定","note":"一句话说明改了什么"}。',
        },
        {
          role: 'user',
          content: `角色:${name}\n原设定:${currentDesc}\n修改要求:${instruction}`,
        },
      ],
      temperature: 0.3,
    })
    const parsed = extractJsonObject(data.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
    const newDesc = String(parsed.description ?? '').trim()
    if (!newDesc) return { ok: false }
    return { ok: true, newDesc, note: String(parsed.note || 'LLM 已更新设定') }
  } catch {
    return { ok: false }
  }
}

/** 用真实 LLM 根据用户反馈重写分镜/立绘生成提示词 */
export async function llmRevisePrompt(
  settings: Settings,
  basePrompt: string,
  feedback: string,
): Promise<{ ok: true; newPrompt: string; fixes: string[] } | { ok: false }> {
  if (!settings.llmBase.trim() || !settings.llmModel.trim()) return { ok: false }
  try {
    const data = await requestLlm(settings, {
      model: settings.llmModel,
      messages: [
        {
          role: 'system',
          content:
            '你是 AI 视频/图像提示词导演。根据用户对上一版画面的反馈重写提示词，保留原有剧情、画风与角色特征，精准落实修改意见，不要输出解释。只输出合法 JSON：{"prompt":"改写后的完整提示词","fixes":["修正点1","修正点2"]}。',
        },
        {
          role: 'user',
          content: `原提示词:\n${basePrompt}\n\n用户反馈:\n${feedback}`,
        },
      ],
      temperature: 0.4,
    })
    const parsed = extractJsonObject(data.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
    const newPrompt = String(parsed.prompt ?? '').trim()
    if (!newPrompt) return { ok: false }
    const fixes = Array.isArray(parsed.fixes)
      ? parsed.fixes.map(String).filter(Boolean)
      : ['LLM 已按反馈重写提示词']
    return { ok: true, newPrompt, fixes }
  } catch {
    return { ok: false }
  }
}

export async function pingLlm(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  if (!settings.llmBase.trim() || !settings.llmModel.trim()) return { ok: false, detail: '请填写 LLM 地址和模型名' }
  try {
    await requestLlm(settings, {
      model: settings.llmModel,
      messages: [{ role: 'user', content: '只回复 OK' }],
      max_tokens: 4,
      temperature: 0,
    })
    return { ok: true, detail: '连接成功,模型已响应' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'LLM 连接失败' }
  }
}

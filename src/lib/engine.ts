// ============ 生成引擎适配层 ============
// demo 模式:本地模拟(画面由 seed 决定,立即可预览完整流程)
// local 模式:对接本机 ComfyUI(MiniMax H3 等)与 OpenAI 兼容 LLM 接口
import type { Settings } from '@/types'

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
    ...opts.characterDescs.map((d, i) => `${opts.characterNames[i]}:${d}`),
    opts.basePrompt,
    '竖屏9:16构图,画面主体居中,电影感打光',
  ].filter(Boolean)
  return parts.join(',')
}

// ============ ComfyUI 真实渲染链路 ============

/**
 * 把设置里的工作流模板与本次渲染参数合成 ComfyUI API 请求体。
 * 模板为用户从自己 ComfyUI 导出的 API 格式 JSON,内含占位符:
 *   {{prompt}} 画面提示词   {{seed}} 随机种子   {{frames}} 总帧数
 *   {{steps}} 采样步数      {{width}} {{height}} 分辨率
 * 占位符在 JSON 字符串层面直接替换 —— 数值型参数在模板里写成 "{{seed}}" 即可。
 */
export function buildWorkflowBody(
  template: string,
  vars: { prompt: string; seed: number; frames: number; steps: number; width: number; height: number },
): { ok: true; body: string } | { ok: false; detail: string } {
  let out = template
  const escapedPrompt = vars.prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  const map: Record<string, string | number> = {
    prompt: escapedPrompt,
    seed: vars.seed,
    frames: vars.frames,
    steps: vars.steps,
    width: vars.width,
    height: vars.height,
  }
  for (const [k, v] of Object.entries(map)) {
    // 数值占位符可能带引号("{{seed}}")或不带({{seed}}),统一替换成裸数值/字符串
    const asString = new RegExp(`"\\{\\{${k}\\}\\}"`, 'g')
    const asBare = new RegExp(`\\{\\{${k}\\}\\}`, 'g')
    if (typeof v === 'number') {
      out = out.replace(asString, String(v)).replace(asBare, String(v))
    } else {
      out = out.replace(asString, `"${v}"`).replace(asBare, v)
    }
  }
  try {
    const parsed = JSON.parse(out)
    return { ok: true, body: JSON.stringify({ prompt: parsed }) }
  } catch {
    return { ok: false, detail: '工作流模板不是合法 JSON(替换占位符后解析失败)' }
  }
}

/** 提交渲染任务到 ComfyUI,返回 prompt_id */
export async function submitComfyJob(
  settings: Settings,
  workflowBody: string,
): Promise<{ ok: boolean; promptId?: string; detail: string }> {
  try {
    const res = await fetch(`${settings.comfyUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: workflowBody,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, detail: `ComfyUI 拒绝任务(${res.status}):${text.slice(0, 120)}` }
    }
    const data = await res.json()
    if (!data.prompt_id) return { ok: false, detail: 'ComfyUI 未返回任务 ID' }
    return { ok: true, promptId: data.prompt_id, detail: '已提交' }
  } catch {
    return { ok: false, detail: `连不上 ComfyUI(${settings.comfyUrl}),请确认它已启动` }
  }
}

export type ComfyResult =
  | { status: 'pending' }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; detail: string }

/**
 * 轮询任务结果。preferVideo=true 优先匹配视频/动图,否则匹配静态图。
 * 返回的地址可直接用于 <video>/<img> 播放。
 */
export async function fetchComfyResult(
  comfyUrl: string,
  promptId: string,
  preferVideo = true,
): Promise<ComfyResult> {
  try {
    const res = await fetch(`${comfyUrl}/history/${promptId}`)
    if (!res.ok) return { status: 'pending' }
    const data = await res.json()
    const entry = data[promptId]
    if (!entry) return { status: 'pending' }
    if (entry.status?.status_str === 'error') {
      const msg = entry.status?.messages?.map((m: string[]) => m.join(' ')).join(';') ?? '未知错误'
      return { status: 'error', detail: msg.slice(0, 200) }
    }
    if (!entry.status?.completed) return { status: 'pending' }
    const wanted = preferVideo ? /\.(mp4|webm|mov|gif)$/i : /\.(png|jpe?g|webp)$/i
    const makeUrl = (g: { filename: string; subfolder: string; type: string }) =>
      `${comfyUrl}/view?filename=${encodeURIComponent(g.filename)}&subfolder=${encodeURIComponent(g.subfolder ?? '')}&type=${g.type ?? 'output'}`
    for (const nodeOut of Object.values(entry.outputs ?? {}) as Record<string, unknown>[]) {
      const groups = [nodeOut.gifs, nodeOut.videos, nodeOut.images].filter(
        (g): g is { filename: string; subfolder: string; type: string }[] => Array.isArray(g),
      )
      for (const g of groups.flat()) {
        if (wanted.test(g.filename)) return { status: 'done', videoUrl: makeUrl(g) }
      }
    }
    // 宽松兜底:任何输出文件
    for (const nodeOut of Object.values(entry.outputs ?? {}) as Record<string, unknown>[]) {
      const groups = [nodeOut.gifs, nodeOut.videos, nodeOut.images].filter(
        (g): g is { filename: string; subfolder: string; type: string }[] => Array.isArray(g),
      )
      for (const g of groups.flat()) {
        if (/\.(mp4|webm|mov|gif|png|jpe?g|webp)$/i.test(g.filename))
          return { status: 'done', videoUrl: makeUrl(g) }
      }
    }
    return { status: 'error', detail: '任务完成但没有找到媒体输出(工作流需要保存节点)' }
  } catch {
    return { status: 'pending' } // 网络抖动当作还在跑
  }
}

/** 轮询内置图像服务的任务结果 */
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

// ============ 立绘/设定图生成(内置双渠道) ============

export type ImageJobResult =
  | { ok: true; kind: 'ready'; imageUrl: string } // 云端接口直接出图
  | { ok: true; kind: 'submitted'; promptId: string } // ComfyUI 排队,需轮询
  | { ok: false; detail: string }

/** 上传一张参考照片,返回 refId(供生成时作为形象参考) */
export async function uploadReferenceImage(
  file: File,
): Promise<{ ok: boolean; refId?: string; detail: string }> {
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
    return { ok: true, refId: data.refId, detail: '已上传' }
  } catch {
    return { ok: false, detail: '连不上内置图像服务,无法上传照片' }
  }
}

/** 把生成服务的原始报错翻译成可操作的提示 */
export function friendlyImageError(detail: string): string {
  if (/moderation|copyright|rejected/i.test(detail))
    return '被生成平台的内容审核拦截。请调整设定描述的措辞(避免敏感词汇)后重试'
  if (/ConnectTimeout|timed? ?out|超时/i.test(detail))
    return '生成服务连接超时,请检查网络后重试'
  if (/API key|api_key/i.test(detail)) return '生成服务缺少密钥,请重启软件后重试'
  return detail
}

/** 提交一张角色设定图生成任务 */
export async function submitImageJob(
  settings: Settings,
  prompt: string,
  seed: number,
  refId?: string,
): Promise<ImageJobResult> {
  // 内置生成:调用随软件启动的本地图像服务(走同源 /api 代理)
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
        detail: '连不上内置图像服务,请用「启动短剧工坊.bat」启动(它会同时拉起生成服务)',
      }
    }
  }
  if (settings.imageProvider === 'cloudapi') {
    try {
      const res = await fetch(`${settings.imageApiBase}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.imageApiKey}`,
        },
        body: JSON.stringify({
          model: settings.imageApiModel,
          prompt,
          size: '1024x1536',
          seed,
        }),
      })
      if (!res.ok) return { ok: false, detail: `图像接口返回 ${res.status}` }
      const data = await res.json()
      const item = data.data?.[0]
      const url = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null)
      if (!url) return { ok: false, detail: '图像接口未返回图片' }
      return { ok: true, kind: 'ready', imageUrl: url }
    } catch {
      return { ok: false, detail: '连不上图像接口,请检查配置' }
    }
  }
  // ComfyUI 渠道:复用占位符机制
  const { width, height } = { width: 1024, height: 1536 }
  const body = buildWorkflowBody(settings.imageWorkflowTemplate, {
    prompt,
    seed,
    frames: 1,
    steps: settings.steps,
    width,
    height,
  })
  if (!body.ok) return { ok: false, detail: body.detail }
  const r = await submitComfyJob(settings, body.body)
  if (!r.ok) return { ok: false, detail: r.detail }
  return { ok: true, kind: 'submitted', promptId: r.promptId! }
}

/** 解析分辨率设置 */
export function parseResolution(res: string): { width: number; height: number } {
  const [w, h] = res.split('x').map(Number)
  return { width: w || 720, height: h || 1280 }
}

/** 探测 ComfyUI 是否在线 */
export async function pingComfy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

// ============ LLM 剧本改编(local 模式) ============

export async function llmAdaptScript(
  settings: Settings,
  novelText: string,
  episodeCount: number,
): Promise<{ ok: boolean; detail: string; json?: unknown }> {
  try {
    const res = await fetch(`${settings.llmBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.llmKey}`,
      },
      body: JSON.stringify({
        model: settings.llmModel,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧编剧。把小说改编为分集分镜脚本,输出 JSON:{episodes:[{title,synopsis,shots:[{title,scene,characters,dialogue,prompt,duration}]}]}。每个镜头4-15秒,prompt为画面描述。',
          },
          { role: 'user', content: `集数:${episodeCount}\n\n小说原文:\n${novelText}` },
        ],
        temperature: 0.7,
      }),
    })
    if (!res.ok) return { ok: false, detail: `LLM 返回 ${res.status}` }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? ''
    const json = JSON.parse(content.replace(/```json|```/g, ''))
    return { ok: true, detail: '改编完成', json }
  } catch {
    return { ok: false, detail: 'LLM 调用失败,请检查接口配置' }
  }
}

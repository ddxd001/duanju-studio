// ============ 短剧工坊 · 本地生成代理与媒体服务 ============
// 零第三方依赖 Node 服务,负责:
//  1. 本地 ComfyUI 代理(/api/comfy/*):无 CORS 问题、自动上传角色参考图、自动缓存成片
//  2. MiniMax 云端 H3 代理(/api/video/minimax/*):任务创建、查询、成片自动缓存
//  3. OpenAI 兼容 LLM 与云端图像代理(/api/llm/chat, /api/image/cloud, 云端图落盘防爆 localStorage)
//  4. 可选内置生图工具(/api/image, /api/upload, 任务状态落盘,超时强制终止子进程)
//  5. 整集 MP4 拼接导出(/api/video/export, 优先 FFmpeg, 自动降级 PyAV)
import http from 'node:http'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(__dirname)
const OUT_DIR = process.env.IMAGE_OUT_DIR ?? path.join(ROOT, 'public', 'generated')
const UPLOAD_DIR = path.join(OUT_DIR, 'uploads')
for (const d of [OUT_DIR, UPLOAD_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })

const PORT = Number(process.env.IMAGE_SERVER_PORT ?? 7101)
const CONCAT_SCRIPT = path.join(__dirname, 'concat_videos.py')

// 可选内置图像生成工具(优先读环境变量,其次自动探测本机可选运行时,找不到不崩溃)
const OPTIONAL_TOOL_CANDIDATES = [
  process.env.IMAGE_GEN_TOOL,
  'E:/KimiData/daimon-share/daimon/runtime/kimi-code/home/plugins/managed/image_generation/scripts/image_generation_tool.py',
].filter(Boolean)
const TOOL = OPTIONAL_TOOL_CANDIDATES.find((p) => existsSync(p)) ?? null

const OPTIONAL_PYTHON_CANDIDATES = [
  process.env.IMAGE_GEN_PYTHON,
  'E:/KimiData/daimon-share/daimon/runtime/python/.venv/Scripts/python.exe',
].filter(Boolean)
const PYTHON = OPTIONAL_PYTHON_CANDIDATES.find((p) => existsSync(p)) ?? 'python'

const PYAV_PYTHON_CANDIDATES = [
  process.env.PYAV_PYTHON,
  'D:/AI/ComfyUI-H3/ComfyUI_windows_portable/python_embeded/python.exe',
  process.env.IMAGE_GEN_PYTHON,
].filter(Boolean)
const PYAV_PYTHON = PYAV_PYTHON_CANDIDATES.find((p) => existsSync(p)) ?? 'python'

function resolveApiKey() {
  if (process.env.KIMI_API_KEY?.trim()) return process.env.KIMI_API_KEY.trim()
  const keyFile = process.env.KIMI_KEY_FILE ?? 'E:/KimiData/daimon-share/daimon/kimi-code-key.json'
  if (!existsSync(keyFile)) return null
  try {
    const data = JSON.parse(readFileSync(keyFile, 'utf-8'))
    const key = data?.keys?.[0]?.apiKey
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch {
    /* ignore */
  }
  return null
}
const API_KEY = resolveApiKey()
const BASE_URL = process.env.KIMI_BASE_URL?.trim() || 'https://agent-gw.kimi.com/coding/'

// ============ 仅允许本机来源访问代理(防止外部网页跨域滥用) ============

const LOCAL_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

function corsHeaders(req) {
  const origin = req.headers.origin
  if (!origin) return {}
  if (!LOCAL_ORIGIN_RE.test(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    Vary: 'Origin',
  }
}

function send(req, res, code, obj) {
  const cors = corsHeaders(req)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cors ?? {}),
  })
  res.end(JSON.stringify(obj))
}

function readJson(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (d) => {
      size += d.length
      if (size > limit) {
        req.destroy()
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(d)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function validateUrl(raw) {
  const u = new URL(raw)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new Error('接口地址不合法')
  }
  return u
}

function upstreamMessage(data, status) {
  return data?.error?.message || data?.base_resp?.status_msg || data?.message || `上游接口返回 ${status}`
}

async function forwardJson({ baseUrl, endpoint, apiKey, payload, method = 'POST', timeout = 90000 }) {
  const base = validateUrl(baseUrl)
  const url = new URL(`${base.pathname.replace(/\/$/, '')}${endpoint}`, base.origin)
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { message: text.slice(0, 300) }
  }
  const businessError = data?.base_resp?.status_code && data.base_resp.status_code !== 0
  return { ok: res.ok && !businessError && !data?.error, status: res.status, data }
}

// ============ 任务持久化(内置生图) ============

const jobs = new Map()
const jobFile = (jobId) => path.join(OUT_DIR, `${jobId}.json`)

function setJob(jobId, job) {
  jobs.set(jobId, job)
  try {
    writeFileSync(jobFile(jobId), JSON.stringify(job), 'utf-8')
  } catch {
    /* ignore */
  }
}

function getJob(jobId) {
  const mem = jobs.get(jobId)
  if (mem) return mem
  try {
    const disk = JSON.parse(readFileSync(jobFile(jobId), 'utf-8'))
    if (disk && disk.status) {
      jobs.set(jobId, disk)
      return disk
    }
  } catch {
    /* ignore */
  }
  if (existsSync(path.join(OUT_DIR, `${jobId}.png`))) {
    const job = { status: 'done', imageUrl: `/generated/${jobId}.png`, startedAt: Date.now() }
    jobs.set(jobId, job)
    return job
  }
  return null
}

/** 运行子进程并支持超时强制 kill */
function runProcess(cmd, args, { env = process.env, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, env })
    let log = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
    }, timeoutMs)
    child.stdout.on('data', (d) => (log += d.toString()))
    child.stderr.on('data', (d) => (log += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: timedOut ? -2 : code, log, timedOut })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, log: `无法启动进程(${cmd}):${e.message}`, timedOut: false })
    })
  })
}

function runTool(args, timeoutMs = 20 * 60 * 1000) {
  return runProcess(PYTHON, ['-u', TOOL, ...args], {
    env: { ...process.env, KIMI_BASE_URL: BASE_URL, ...(API_KEY ? { KIMI_API_KEY: API_KEY } : {}) },
    timeoutMs,
  })
}

function extractUrl(log) {
  const m = log.match(/https?:\/\/[^\s"'\\]+/)
  return m ? m[0] : null
}

async function runGeneration(jobId, prompt, size, refId) {
  const file = path.join(OUT_DIR, `${jobId}.png`)
  const startedAt = jobs.get(jobId)?.startedAt ?? Date.now()

  if (!TOOL) {
    setJob(jobId, {
      status: 'error',
      error: '未检测到内置生图工具。请在「生成引擎设置」切换到 ComfyUI 或云端图像 API，或设置环境变量 IMAGE_GEN_TOOL',
      startedAt,
    })
    return
  }

  const args = ['generate', '--description', prompt, '--size', size, '--background', 'opaque', '--output', file]
  if (refId) {
    const refFile = path.join(UPLOAD_DIR, path.basename(refId))
    if (!existsSync(refFile)) {
      setJob(jobId, { status: 'error', error: '参考照片不存在,请重新上传', startedAt })
      return
    }
    const up = await runTool(['image-to-url', '--image-path', refFile], 3 * 60 * 1000)
    const refUrl = up.code === 0 ? extractUrl(up.log) : null
    if (!refUrl) {
      const tail = up.log.trim().split('\n').slice(-2).join(' | ').slice(0, 200)
      setJob(jobId, { status: 'error', error: `参考照片上传失败:${tail || '未获得图片链接'}`, startedAt })
      return
    }
    args.push('--reference-image', refUrl)
  }

  const r = await runTool(args, 20 * 60 * 1000)
  if (r.timedOut) {
    setJob(jobId, { status: 'error', error: '生成超时(20 分钟),已终止进程', startedAt })
  } else if (r.code === 0 && existsSync(file)) {
    setJob(jobId, { status: 'done', imageUrl: `/generated/${jobId}.png`, startedAt })
  } else {
    const tail = r.log.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
    setJob(jobId, { status: 'error', error: tail || `生成进程退出码 ${r.code}`, startedAt })
  }
}

// ============ 本地媒体缓存工具 ============

async function cacheRemoteMedia(prefix, key, remoteUrl, defaultExt = '.mp4', maxBytes = 512 * 1024 * 1024) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex')
  const extMatch = remoteUrl.split('?')[0].match(/\.(mp4|webm|mov|gif|png|jpe?g|webp)$/i)
  const ext = extMatch ? extMatch[0].toLowerCase() : defaultExt
  const name = `${prefix}-${hash}${ext}`
  const file = path.join(OUT_DIR, name)
  if (existsSync(file)) return `/generated/${name}`

  const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(180000) })
  if (!res.ok) throw new Error(`媒体下载失败(${res.status})`)
  const size = Number(res.headers.get('content-length') || 0)
  if (size > maxBytes) throw new Error('媒体体积超过限制,已停止自动缓存')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error('媒体体积超过限制,已停止自动缓存')
  writeFileSync(file, buf)
  return `/generated/${name}`
}

/** 把 /generated/... 或 data URL 或 http URL 解析成二进制 Buffer */
async function readMediaBuffer(mediaUrl) {
  if (typeof mediaUrl !== 'string' || !mediaUrl.trim()) throw new Error('缺少媒体地址')
  if (mediaUrl.startsWith('/generated/')) {
    const f = path.join(OUT_DIR, path.basename(mediaUrl.split('?')[0]))
    if (!existsSync(f)) throw new Error('本地媒体文件不存在')
    return { buf: readFileSync(f), ext: path.extname(f).toLowerCase() || '.png' }
  }
  if (mediaUrl.startsWith('data:')) {
    const m = mediaUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
    if (!m) throw new Error('不支持的 data URL 格式')
    const ext = `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`
    return { buf: Buffer.from(m[2], 'base64'), ext }
  }
  validateUrl(mediaUrl)
  const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`拉取参考图失败(${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') || ''
  const ext = ct.includes('jpeg') ? '.jpg' : ct.includes('webp') ? '.webp' : '.png'
  return { buf, ext }
}

// ============ LLM 与云端生图代理 ============

async function llmChatRoute(req, res) {
  try {
    const { baseUrl, apiKey = '', payload } = await readJson(req)
    if (!baseUrl || !payload) return send(req, res, 400, { error: '缺少接口地址或请求参数' })
    const r = await forwardJson({ baseUrl, endpoint: '/chat/completions', apiKey, payload, timeout: 120000 })
    return send(req, res, r.ok ? 200 : r.status, r.ok ? r.data : { error: upstreamMessage(r.data, r.status) })
  } catch (e) {
    return send(req, res, 502, { error: `LLM 接口连接失败:${e.message}` })
  }
}

/** 云端生图后自动落盘到 OUT_DIR,避免把几 MB base64 塞进 localStorage */
async function cloudImageRoute(req, res) {
  try {
    const { baseUrl, apiKey = '', payload } = await readJson(req)
    if (!baseUrl || !payload) return send(req, res, 400, { error: '缺少接口地址或请求参数' })
    const r = await forwardJson({ baseUrl, endpoint: '/images/generations', apiKey, payload, timeout: 180000 })
    if (!r.ok) return send(req, res, r.status, { error: upstreamMessage(r.data, r.status) })

    const item = r.data?.data?.[0]
    if (item?.b64_json) {
      const name = `cloud-${crypto.randomBytes(8).toString('hex')}.png`
      writeFileSync(path.join(OUT_DIR, name), Buffer.from(item.b64_json, 'base64'))
      return send(req, res, 200, { data: [{ url: `/generated/${name}` }] })
    }
    if (item?.url) {
      try {
        const localUrl = await cacheRemoteMedia('cloud', item.url, item.url, '.png', 50 * 1024 * 1024)
        return send(req, res, 200, { data: [{ url: localUrl }] })
      } catch {
        return send(req, res, 200, r.data)
      }
    }
    return send(req, res, 200, r.data)
  } catch (e) {
    return send(req, res, 502, { error: `云端图像接口连接失败:${e.message}` })
  }
}

// ============ ComfyUI 同源代理(含参考图上传与成片缓存) ============

async function comfyStatsRoute(req, res) {
  try {
    const { comfyUrl } = await readJson(req)
    if (!comfyUrl) return send(req, res, 400, { error: '缺少 ComfyUI 地址' })
    const base = validateUrl(comfyUrl)
    const r = await fetch(new URL('/system_stats', base), { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return send(req, res, r.status, { ok: false, error: `ComfyUI 返回 ${r.status}` })
    const data = await r.json().catch(() => ({}))
    return send(req, res, 200, { ok: true, stats: data })
  } catch (e) {
    return send(req, res, 502, { ok: false, error: `连不上 ComfyUI:${e.message}` })
  }
}

async function comfyUploadRoute(req, res) {
  try {
    const { comfyUrl, imageUrl, filename } = await readJson(req)
    if (!comfyUrl || !imageUrl) return send(req, res, 400, { error: '缺少 ComfyUI 地址或图片地址' })
    const base = validateUrl(comfyUrl)
    const { buf, ext } = await readMediaBuffer(imageUrl)
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
    const safeName = filename ? `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}_${hash}${ext}` : `duanju_ref_${hash}${ext}`
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'

    const form = new FormData()
    form.append('image', new Blob([buf], { type: mime }), safeName)
    form.append('type', 'input')
    form.append('overwrite', 'true')

    const r = await fetch(new URL('/upload/image', base), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.name) {
      return send(req, res, r.ok ? 502 : r.status, { error: data.error || `ComfyUI 上传参考图失败(${r.status})` })
    }
    const storedName = data.subfolder ? `${data.subfolder}/${data.name}` : data.name
    return send(req, res, 200, { name: storedName, raw: data })
  } catch (e) {
    return send(req, res, 502, { error: `上传参考图到 ComfyUI 失败:${e.message}` })
  }
}

async function comfyPromptRoute(req, res) {
  try {
    const { comfyUrl, prompt } = await readJson(req)
    if (!comfyUrl || !prompt) return send(req, res, 400, { error: '缺少 ComfyUI 地址或工作流' })
    const base = validateUrl(comfyUrl)
    const r = await fetch(new URL('/prompt', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await r.text()
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { error: text.slice(0, 200) }
    }
    if (!r.ok || !data.prompt_id) {
      return send(req, res, r.ok ? 502 : r.status, {
        error: data?.error?.message || data?.error || `ComfyUI 拒绝任务(${r.status})`,
      })
    }
    return send(req, res, 200, { promptId: data.prompt_id })
  } catch (e) {
    return send(req, res, 502, { error: `提交 ComfyUI 任务失败:${e.message}` })
  }
}

async function comfyHistoryRoute(req, res) {
  try {
    const { comfyUrl, promptId, preferVideo = true } = await readJson(req)
    if (!comfyUrl || !promptId) return send(req, res, 400, { error: '缺少参数' })
    const base = validateUrl(comfyUrl)
    const r = await fetch(new URL(`/history/${encodeURIComponent(promptId)}`, base), {
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return send(req, res, 200, { status: 'pending' })
    const data = await r.json().catch(() => ({}))
    const entry = data[promptId]
    if (!entry) return send(req, res, 200, { status: 'pending' })
    if (entry.status?.status_str === 'error') {
      const msg = entry.status?.messages?.map((m) => (Array.isArray(m) ? m.join(' ') : String(m))).join(';') ?? '未知错误'
      return send(req, res, 200, { status: 'error', detail: msg.slice(0, 240) })
    }
    if (!entry.status?.completed) return send(req, res, 200, { status: 'pending' })

    const wanted = preferVideo ? /\.(mp4|webm|mov|gif)$/i : /\.(png|jpe?g|webp)$/i
    const anyMedia = /\.(mp4|webm|mov|gif|png|jpe?g|webp)$/i
    const makeViewUrl = (g) =>
      `${base.origin}/view?filename=${encodeURIComponent(g.filename)}&subfolder=${encodeURIComponent(g.subfolder ?? '')}&type=${encodeURIComponent(g.type ?? 'output')}`

    let picked = null
    const allItems = []
    for (const nodeOut of Object.values(entry.outputs ?? {})) {
      if (!nodeOut || typeof nodeOut !== 'object') continue
      for (const arr of [nodeOut.videos, nodeOut.gifs, nodeOut.images]) {
        if (Array.isArray(arr)) allItems.push(...arr)
      }
    }
    picked = allItems.find((g) => g?.filename && wanted.test(g.filename)) ?? allItems.find((g) => g?.filename && anyMedia.test(g.filename))
    if (!picked) {
      return send(req, res, 200, { status: 'error', detail: '任务完成但没有找到媒体输出(工作流需要 SaveVideo / SaveImage 节点)' })
    }
    const viewUrl = makeViewUrl(picked)
    try {
      const localUrl = await cacheRemoteMedia(
        'comfy',
        `${promptId}:${picked.subfolder ?? ''}:${picked.filename}`,
        viewUrl,
        preferVideo ? '.mp4' : '.png',
      )
      return send(req, res, 200, { status: 'done', mediaUrl: localUrl })
    } catch {
      // 缓存失败时退回 ComfyUI 直链
      return send(req, res, 200, { status: 'done', mediaUrl: viewUrl })
    }
  } catch (e) {
    return send(req, res, 200, { status: 'pending', note: e.message })
  }
}

// ============ MiniMax 云端 H3 代理 ============

async function minimaxCreateRoute(req, res) {
  try {
    const { baseUrl, apiKey, payload } = await readJson(req)
    if (!baseUrl || !apiKey || !payload) return send(req, res, 400, { error: 'MiniMax 配置不完整' })
    const r = await forwardJson({ baseUrl, endpoint: '/v2/video_generation', apiKey, payload })
    if (!r.ok) return send(req, res, r.status, { error: upstreamMessage(r.data, r.status) })
    if (!r.data.task_id) return send(req, res, 502, { error: 'MiniMax 未返回 task_id' })
    return send(req, res, 200, { taskId: String(r.data.task_id) })
  } catch (e) {
    return send(req, res, 502, { error: `MiniMax 创建请求失败:${e.message}` })
  }
}

async function minimaxQueryRoute(req, res) {
  try {
    const { baseUrl, apiKey, taskId } = await readJson(req)
    if (!baseUrl || !apiKey || !taskId) return send(req, res, 400, { error: 'MiniMax 查询参数不完整' })
    const r = await forwardJson({
      baseUrl,
      endpoint: `/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      apiKey,
      method: 'GET',
    })
    if (!r.ok) return send(req, res, r.status, { error: upstreamMessage(r.data, r.status) })
    const task = r.data.task ?? r.data
    const status = String(task.status ?? '').toLowerCase()
    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
      return send(req, res, 200, { status: 'error', error: task.error?.message || task.fail_reason || 'MiniMax 视频生成失败' })
    }
    if (status === 'succeeded' || status === 'success') {
      const sourceUrl = task.content?.url || task.video_url || r.data.video_url
      if (!sourceUrl) return send(req, res, 200, { status: 'error', error: '任务成功但没有成片地址' })
      try {
        const localUrl = await cacheRemoteMedia('minimax', taskId, sourceUrl, '.mp4')
        return send(req, res, 200, { status: 'done', videoUrl: localUrl })
      } catch (e) {
        return send(req, res, 200, { status: 'error', error: e.message })
      }
    }
    return send(req, res, 200, { status: 'running', upstreamStatus: status || 'unknown' })
  } catch (e) {
    return send(req, res, 502, { error: `MiniMax 查询失败:${e.message}` })
  }
}

// ============ 整集 MP4 导出(优先 FFmpeg, 自动降级 PyAV) ============

async function exportEpisodeRoute(req, res) {
  let tmpDir = null
  try {
    const { title = 'episode', videoUrls } = await readJson(req)
    if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
      return send(req, res, 400, { error: '没有可导出的真实视频镜头' })
    }
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'duanju-export-'))
    const localInputs = []

    for (let i = 0; i < videoUrls.length; i++) {
      const u = videoUrls[i]
      if (typeof u !== 'string' || !u.trim()) continue
      if (u.startsWith('/generated/')) {
        const f = path.join(OUT_DIR, path.basename(u.split('?')[0]))
        if (!existsSync(f)) return send(req, res, 404, { error: `第 ${i + 1} 个镜头文件不存在` })
        localInputs.push(f)
      } else {
        validateUrl(u)
        const r = await fetch(u, { signal: AbortSignal.timeout(120000) })
        if (!r.ok) return send(req, res, 502, { error: `下载第 ${i + 1} 个镜头失败(${r.status})` })
        const dst = path.join(tmpDir, `clip_${i}.mp4`)
        writeFileSync(dst, Buffer.from(await r.arrayBuffer()))
        localInputs.push(dst)
      }
    }

    if (localInputs.length === 0) {
      return send(req, res, 400, { error: '没有有效的视频片段' })
    }

    const outName = `export-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`
    const outFile = path.join(OUT_DIR, outName)
    const safeTitle = String(title).replace(/[\\/:*?"<>|]/g, '_').trim() || 'episode'

    if (localInputs.length === 1) {
      copyFileSync(localInputs[0], outFile)
      return send(req, res, 200, { videoUrl: `/generated/${outName}`, filename: `${safeTitle}.mp4`, clipCount: 1, engine: 'copy' })
    }

    // 1) 优先尝试 FFmpeg
    const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'
    const listFile = path.join(tmpDir, 'list.txt')
    writeFileSync(
      listFile,
      localInputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf-8',
    )
    const ff = await runProcess(
      ffmpegBin,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outFile],
      { timeoutMs: 5 * 60 * 1000 },
    )
    if (ff.code === 0 && existsSync(outFile)) {
      return send(req, res, 200, { videoUrl: `/generated/${outName}`, filename: `${safeTitle}.mp4`, clipCount: localInputs.length, engine: 'ffmpeg' })
    }

    // 2) 降级尝试 PyAV(本机 ComfyUI-H3 内置 Python 自带 PyAV)
    if (existsSync(CONCAT_SCRIPT)) {
      const py = await runProcess(PYAV_PYTHON, ['-u', CONCAT_SCRIPT, outFile, ...localInputs], {
        timeoutMs: 5 * 60 * 1000,
      })
      if (py.code === 0 && existsSync(outFile)) {
        return send(req, res, 200, { videoUrl: `/generated/${outName}`, filename: `${safeTitle}.mp4`, clipCount: localInputs.length, engine: 'pyav' })
      }
      return send(req, res, 500, {
        error: `整集导出失败(FFmpeg 不可用, PyAV 报错):${py.log.trim().slice(-240)}`,
      })
    }

    return send(req, res, 500, {
      error: `整集导出需要本机安装 FFmpeg 或 PyAV:${ff.log.trim().slice(-200)}`,
    })
  } catch (e) {
    return send(req, res, 500, { error: `整集导出失败:${e.message}` })
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

// ============ HTTP 路由 ============

export async function handleRequest(req, res) {
  const cors = corsHeaders(req)
  if (cors === null) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '禁止非本机来源跨域访问本地代理' }))
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  const url = new URL(req.url, 'http://127.0.0.1')

  // 同源代理路由
  if (req.method === 'POST' && url.pathname === '/api/comfy/stats') return comfyStatsRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/comfy/upload') return comfyUploadRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/comfy/prompt') return comfyPromptRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/comfy/history') return comfyHistoryRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/video/minimax/create') return minimaxCreateRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/video/minimax/query') return minimaxQueryRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/video/export') return exportEpisodeRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/llm/chat') return llmChatRoute(req, res)
  if (req.method === 'POST' && url.pathname === '/api/image/cloud') return cloudImageRoute(req, res)

  // 上传参考照片(base64 JSON,最大约 15MB)
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    try {
      const { dataBase64, ext = '.png' } = await readJson(req, 20 * 1024 * 1024)
      if (!dataBase64 || typeof dataBase64 !== 'string') return send(req, res, 400, { error: '缺少图片数据' })
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.png'
      const refId = `${crypto.randomBytes(8).toString('hex')}${safeExt}`
      writeFileSync(path.join(UPLOAD_DIR, refId), Buffer.from(dataBase64, 'base64'))
      return send(req, res, 200, { refId, previewUrl: `/generated/uploads/${refId}` })
    } catch (e) {
      return send(req, res, 400, { error: e.message || '请求体不是合法 JSON' })
    }
  }

  // 提交内置生图任务
  if (req.method === 'POST' && url.pathname === '/api/image') {
    try {
      const { prompt, size = '1536x1024', refId } = await readJson(req)
      if (!prompt || typeof prompt !== 'string') return send(req, res, 400, { error: '缺少 prompt' })
      if (refId && !/^[a-f0-9]{16}\.(png|jpe?g|webp)$/.test(refId)) {
        return send(req, res, 400, { error: '参考照片标识不合法' })
      }
      const jobId = crypto.randomBytes(8).toString('hex')
      setJob(jobId, { status: 'running', startedAt: Date.now() })
      void runGeneration(jobId, prompt, size, refId)
      return send(req, res, 200, { jobId })
    } catch (e) {
      return send(req, res, 400, { error: e.message || '请求体不是合法 JSON' })
    }
  }

  // 查询内置生图任务状态
  const m = url.pathname.match(/^\/api\/image\/([a-f0-9]{16})$/)
  if (req.method === 'GET' && m) {
    const job = getJob(m[1])
    if (!job) return send(req, res, 404, { error: '任务不存在,请重新生成' })
    return send(req, res, 200, job)
  }

  // 健康检查
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(req, res, 200, {
      ok: true,
      builtinImageReady: Boolean(TOOL && API_KEY),
      tool: Boolean(TOOL),
      key: Boolean(API_KEY),
      pyavPython: existsSync(PYAV_PYTHON),
    })
  }

  send(req, res, 404, { error: 'not found' })
}

const server = http.createServer(handleRequest)

export const imageServer = server

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[短剧工坊] 本地代理与媒体服务已启动: http://127.0.0.1:${PORT}`)
    console.log(`[短剧工坊] 内置生图工具: ${TOOL ? TOOL : '未配置(可使用 ComfyUI / 云端图像 API)'}`)
  })
}

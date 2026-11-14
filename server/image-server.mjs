// ============ 短剧工坊 · 内置图像生成服务 ============
// 轻量 Node 服务(零依赖),随「启动短剧工坊.bat」一起启动。
// 前端 POST /api/image 提交提示词 → 后台调用本机图像生成工具 →
// 前端轮询 /api/image/:jobId 拿结果,图片从 /generated/ 提供。
// 支持导入照片做参考图:POST /api/upload 存照片 → POST /api/image 带 refId。
// 任务状态持久化到磁盘(<jobId>.json),服务重启后轮询不会丢任务。
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// 生成图输出目录:可用 IMAGE_OUT_DIR 覆盖(桌面版会指向用户数据目录,
// 避免往安装目录里写文件)
const OUT_DIR = process.env.IMAGE_OUT_DIR ?? path.join(ROOT, 'public', 'generated')
const UPLOAD_DIR = path.join(OUT_DIR, 'uploads')
for (const d of [OUT_DIR, UPLOAD_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })

// 图像生成工具(可通过环境变量覆盖)
const TOOL =
  process.env.IMAGE_GEN_TOOL ??
  'E:/KimiData/daimon-share/daimon/runtime/kimi-code/home/plugins/managed/image_generation/scripts/image_generation_tool.py'
// 默认使用 Kimi Work 托管 Python(图像生成 SDK 已安装在其中);
// 找不到时退回 PATH 里的 python;均可用 IMAGE_GEN_PYTHON 环境变量覆盖。
const MANAGED_PYTHON = 'E:/KimiData/daimon-share/daimon/runtime/python/.venv/Scripts/python.exe'
const PYTHON = process.env.IMAGE_GEN_PYTHON ?? (existsSync(MANAGED_PYTHON) ? MANAGED_PYTHON : 'python')
const PORT = Number(process.env.IMAGE_SERVER_PORT ?? 7101)

// 解析图像生成 API Key:环境变量 > Kimi Work 本地密钥文件。
// 直接双击启动脚本打开的进程不带有 Kimi Work 的环境变量,需要从密钥文件读取。
const KEY_FILE = 'E:/KimiData/daimon-share/daimon/kimi-code-key.json'
function resolveApiKey() {
  if (process.env.KIMI_API_KEY?.trim()) return process.env.KIMI_API_KEY.trim()
  try {
    const data = JSON.parse(readFileSync(KEY_FILE, 'utf-8'))
    const key = data?.keys?.[0]?.apiKey
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch {
    /* 密钥文件不存在或格式异常时返回 null,由生成工具报错 */
  }
  return null
}
const API_KEY = resolveApiKey()

// 生成网关地址:SDK 内置默认是不可达的 dev 域名,必须显式指定正式地址。
// 优先级:环境变量 KIMI_BASE_URL > 正式地址。
const BASE_URL = process.env.KIMI_BASE_URL?.trim() || 'https://agent-gw.kimi.com/coding/'

/** jobId → { status, imageUrl?, error?, startedAt } */
const jobs = new Map()

function jobFile(jobId) {
  return path.join(OUT_DIR, `${jobId}.json`)
}

/** 更新任务状态并持久化到磁盘(服务重启后仍可查询) */
function setJob(jobId, job) {
  jobs.set(jobId, job)
  try {
    writeFileSync(jobFile(jobId), JSON.stringify(job), 'utf-8')
  } catch {
    /* 磁盘写入失败不影响内存状态 */
  }
}

/** 查询任务:内存 > 磁盘快照 > 生成图存在性 */
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
    /* 无磁盘快照 */
  }
  if (existsSync(path.join(OUT_DIR, `${jobId}.png`))) {
    const job = { status: 'done', imageUrl: `/generated/${jobId}.png`, startedAt: Date.now() }
    jobs.set(jobId, job)
    return job
  }
  return null
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(obj))
}

/** 运行一个工具子进程,收集输出 */
function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ['-u', TOOL, ...args], {
      windowsHide: true,
      env: { ...process.env, KIMI_BASE_URL: BASE_URL, ...(API_KEY ? { KIMI_API_KEY: API_KEY } : {}) },
    })
    let log = ''
    child.stdout.on('data', (d) => (log += d.toString()))
    child.stderr.on('data', (d) => (log += d.toString()))
    child.on('close', (code) => resolve({ code, log }))
    child.on('error', (e) => resolve({ code: -1, log: `无法启动生成进程:${e.message}` }))
  })
}

/** 从工具输出中提取公网图片 URL */
function extractUrl(log) {
  const m = log.match(/https?:\/\/[^\s"'\\]+/)
  return m ? m[0] : null
}

async function runGeneration(jobId, prompt, size, refId) {
  const file = path.join(OUT_DIR, `${jobId}.png`)
  const startedAt = jobs.get(jobId)?.startedAt ?? Date.now()

  const killer = setTimeout(() => {
    setJob(jobId, { status: 'error', error: '生成超时(20 分钟)', startedAt })
    process.exitCode = 0
  }, 20 * 60 * 1000)

  try {
    const args = ['generate', '--description', prompt, '--size', size, '--background', 'opaque', '--output', file]

    // 有参考照片:先转公网链接,再作为参考图参与生成
    if (refId) {
      const refFile = path.join(UPLOAD_DIR, path.basename(refId))
      if (!existsSync(refFile)) {
        setJob(jobId, { status: 'error', error: '参考照片不存在(服务可能已重启),请重新上传', startedAt })
        return
      }
      const up = await runTool(['image-to-url', '--image-path', refFile])
      const refUrl = up.code === 0 ? extractUrl(up.log) : null
      if (!refUrl) {
        const tail = up.log.trim().split('\n').slice(-2).join(' | ').slice(0, 200)
        setJob(jobId, { status: 'error', error: `参考照片上传失败:${tail || '未获得图片链接'}`, startedAt })
        return
      }
      args.push('--reference-image', refUrl)
    }

    const r = await runTool(args)
    if (r.code === 0 && existsSync(file)) {
      setJob(jobId, { status: 'done', imageUrl: `/generated/${jobId}.png`, startedAt })
    } else {
      const tail = r.log.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
      setJob(jobId, { status: 'error', error: tail || `生成进程退出码 ${r.code}`, startedAt })
    }
  } finally {
    clearTimeout(killer)
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET',
    })
    return res.end()
  }

  // 上传参考照片(base64 JSON,最大约 15MB)
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > 20 * 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        const { dataBase64, ext = '.png' } = JSON.parse(body || '{}')
        if (!dataBase64 || typeof dataBase64 !== 'string') return send(res, 400, { error: '缺少图片数据' })
        const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.png'
        const refId = `${crypto.randomBytes(8).toString('hex')}${safeExt}`
        writeFileSync(path.join(UPLOAD_DIR, refId), Buffer.from(dataBase64, 'base64'))
        send(res, 200, { refId })
      } catch {
        send(res, 400, { error: '请求体不是合法 JSON' })
      }
    })
    return
  }

  // 提交生成任务(可带 refId 参考照片)
  if (req.method === 'POST' && url.pathname === '/api/image') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const { prompt, size = '1536x1024', refId } = JSON.parse(body || '{}')
        if (!prompt || typeof prompt !== 'string') return send(res, 400, { error: '缺少 prompt' })
        if (refId && !/^[a-f0-9]{16}\.(png|jpe?g|webp)$/.test(refId)) {
          return send(res, 400, { error: '参考照片标识不合法' })
        }
        const jobId = crypto.randomBytes(8).toString('hex')
        setJob(jobId, { status: 'running', startedAt: Date.now() })
        runGeneration(jobId, prompt, size, refId)
        send(res, 200, { jobId })
      } catch {
        send(res, 400, { error: '请求体不是合法 JSON' })
      }
    })
    return
  }

  // 查询任务状态(支持服务重启后从磁盘恢复)
  const m = url.pathname.match(/^\/api\/image\/([a-f0-9]{16})$/)
  if (req.method === 'GET' && m) {
    const job = getJob(m[1])
    if (!job) return send(res, 404, { error: '任务不存在,请重新生成' })
    return send(res, 200, job)
  }

  // 健康检查
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, tool: existsSync(TOOL), key: Boolean(API_KEY), baseUrl: BASE_URL })
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[短剧工坊] 图像生成服务已启动: http://127.0.0.1:${PORT}`)
  console.log(`[短剧工坊] 生成工具: ${TOOL} (${existsSync(TOOL) ? '存在' : '未找到!'})`)
})

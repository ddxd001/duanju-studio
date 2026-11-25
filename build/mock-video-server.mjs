// 本地集成测试桩:模拟 MiniMax H3、ComfyUI 与 OpenAI 兼容 LLM。
// 不连接真实账户、不产生费用;仅用于验证请求结构、轮询、缓存与播放链路。
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const media = readFileSync(path.join(ROOT, 'build', 'test-media.mp4'))
const state = { minimaxQueries: 0, comfyQueries: 0, lastVideoPayload: null, lastWorkflow: null }
const reportFile = path.join(ROOT, 'build', 'mock-report.json')
const saveReport = () => writeFileSync(reportFile, JSON.stringify(state, null, 2))

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}
function body(req) {
  return new Promise((resolve) => {
    let text = ''
    req.on('data', (d) => (text += d))
    req.on('end', () => resolve(JSON.parse(text || '{}')))
  })
}
function video(res) {
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': media.length, 'Access-Control-Allow-Origin': '*' })
  res.end(media)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
    return res.end()
  }
  if (url.pathname === '/media/test.mp4' || url.pathname === '/view') return video(res)
  if (req.method === 'GET' && url.pathname === '/system_stats') return json(res, 200, { system: { os: 'mock' } })
  if (req.method === 'POST' && url.pathname === '/v2/video_generation') {
    state.lastVideoPayload = await body(req)
    state.minimaxQueries = 0
    saveReport()
    return json(res, 200, { task_id: 'mock-h3-task' })
  }
  if (req.method === 'GET' && url.pathname === '/v2/query/video_generation/mock-h3-task') {
    state.minimaxQueries += 1
    saveReport()
    if (state.minimaxQueries < 2) return json(res, 200, { task: { status: 'running' } })
    return json(res, 200, { task: { status: 'succeeded', content: { url: 'http://127.0.0.1:7199/media/test.mp4' } } })
  }
  if (req.method === 'POST' && url.pathname === '/prompt') {
    state.lastWorkflow = await body(req)
    state.comfyQueries = 0
    saveReport()
    return json(res, 200, { prompt_id: 'mock-comfy-task' })
  }
  if (req.method === 'GET' && url.pathname === '/history/mock-comfy-task') {
    state.comfyQueries += 1
    saveReport()
    if (state.comfyQueries < 2) return json(res, 200, {})
    return json(res, 200, {
      'mock-comfy-task': {
        status: { completed: true, status_str: 'success' },
        outputs: { 9: { videos: [{ filename: 'mock.mp4', subfolder: '', type: 'output' }] } },
      },
    })
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const payload = await body(req)
    const testOnly = payload.max_tokens === 1
    return json(res, 200, {
      choices: [{ message: { content: testOnly ? 'OK' : JSON.stringify({
        episodes: [{ title: '模拟接口剧集', synopsis: '验证 LLM 改编', shots: [{
          title: '花田试拍', scene: '花田', characters: ['主角'], dialogue: '链路测试',
          prompt: '一朵花在风中轻轻摇动,镜头缓慢推近', duration: 5,
        }] }],
      }) } }],
    })
  }
  json(res, 404, { error: 'not found' })
})
server.listen(7199, '127.0.0.1', () => console.log('mock video services: http://127.0.0.1:7199'))

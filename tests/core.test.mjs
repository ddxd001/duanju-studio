import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(__dirname)

/** 将单个 TS 模块转译为临时 ESM 以便在 Node 20/22+ 直接运行单元测试 */
async function loadTsModule(relPath) {
  const src = readFileSync(path.join(ROOT, relPath), 'utf-8')
  const { code } = await transform(src, { loader: 'ts', format: 'esm' })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'duanju-test-'))
  const outFile = path.join(dir, 'mod.mjs')
  writeFileSync(outFile, code, 'utf-8')
  try {
    return await import(pathToFileURL(outFile).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const comfyH3 = await loadTsModule('src/lib/comfyH3.ts')
const promptLib = await loadTsModule('src/lib/prompt.ts')

test('MiniMax-H3 frame alignment follows 17k+5 grid', () => {
  for (const sec of [2, 4, 5, 6, 8, 10, 15]) {
    const frames = comfyH3.alignH3Frames(sec)
    assert.equal(frames % 17, 5, `sec=${sec} -> ${frames} should satisfy n % 17 === 5`)
    assert.ok(frames >= Math.round(sec * 24))
  }
  assert.equal(comfyH3.alignH3Frames(5), 124)
})

test('MiniMax-H3 dimension alignment snaps to multiples of 32', () => {
  assert.equal(comfyH3.alignH3Dim(576), 576)
  assert.equal(comfyH3.alignH3Dim(720), 736)
  assert.equal(comfyH3.alignH3Dim(1080), 1088)
})

test('buildMiniMaxH3Workflow produces T2VA without refs and Ref2VA with character refs', () => {
  const t2v = comfyH3.buildMiniMaxH3Workflow({
    prompt: '雨夜青州城头',
    seed: 42,
    seconds: 5,
    width: 576,
    height: 1024,
    models: comfyH3.DEFAULT_H3_MODELS,
  })
  assert.equal(t2v['131'].class_type, 'MiniMaxH3ImageToVideo')
  assert.equal(t2v['131'].inputs.length, 124)
  assert.equal(t2v['124'].inputs.steps, 4)

  const ref2v = comfyH3.buildMiniMaxH3Workflow({
    prompt: '沈昭与苏挽在院中对峙',
    seed: 100,
    seconds: 6,
    width: 576,
    height: 1024,
    models: comfyH3.DEFAULT_H3_MODELS,
    refs: [
      { characterName: '沈昭', comfyImageName: 'shenzhao_ref.png' },
      { characterName: '苏挽', comfyImageName: 'suwan_ref.png' },
    ],
  })
  assert.equal(ref2v['131'].class_type, 'MiniMaxH3ReferenceToVideo')
  assert.deepEqual(ref2v['131'].inputs['ref_images.ref_image_0'], ['910', 0])
  assert.deepEqual(ref2v['131'].inputs['ref_images.ref_image_1'], ['911', 0])
  assert.equal(ref2v['910'].class_type, 'LoadImage')
  assert.equal(ref2v['910'].inputs.image, 'shenzhao_ref.png')
  assert.equal(ref2v['911'].inputs.image, 'suwan_ref.png')
  assert.match(String(ref2v['1'].inputs.value), /<Picture 1>.*沈昭/)
  assert.match(String(ref2v['1'].inputs.value), /<Picture 2>.*苏挽/)
})

test('injectPictureTags leaves prompt unchanged when no refs', () => {
  assert.equal(comfyH3.injectPictureTags('纯场景空镜', []), '纯场景空镜')
})

test('revisePrompt appends rule fixes and director note', () => {
  const r = promptLib.revisePrompt('国漫3D,雨夜城楼', '脸变了而且太暗', true)
  assert.ok(r.fixes.includes('加强角色面部一致性约束'))
  assert.ok(r.fixes.includes('提高画面亮度'))
  assert.match(r.newPrompt, /导演备注:脸变了而且太暗/)
})

async function invokeHandler(handleRequest, method, reqPath, headers = {}) {
  const result = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, hdrs = {}) {
      result.status = status
      result.headers = Object.fromEntries(Object.entries(hdrs).map(([k, v]) => [k.toLowerCase(), v]))
    },
    end(chunk = '') {
      result.body += String(chunk)
    },
  }
  await handleRequest({ method, url: reqPath, headers }, res)
  return result
}

test('image-server rejects non-local CORS origins and responds to /api/health', async () => {
  const { handleRequest } = await import('../server/image-server.mjs')

  const health = await invokeHandler(handleRequest, 'GET', '/api/health')
  assert.equal(health.status, 200)
  assert.equal(JSON.parse(health.body).ok, true)

  const blocked = await invokeHandler(handleRequest, 'GET', '/api/health', {
    origin: 'https://evil.example.com',
  })
  assert.equal(blocked.status, 403)

  const allowed = await invokeHandler(handleRequest, 'GET', '/api/health', {
    origin: 'http://127.0.0.1:3000',
  })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://127.0.0.1:3000')
})

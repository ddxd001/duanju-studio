import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import type { StepId } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BookOpen,
  Clapperboard,
  Users,
  LayoutGrid,
  Film,
  Play,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Download,
  Upload,
} from 'lucide-react'
import NovelInput from '@/pages/NovelInput'
import ScriptPage from '@/pages/ScriptPage'
import CharactersPage from '@/pages/CharactersPage'
import StoryboardPage from '@/pages/StoryboardPage'
import RenderPage from '@/pages/RenderPage'
import TheaterPage from '@/pages/TheaterPage'
import { pingComfy, checkMiniMaxConfig, pingLlm } from '@/lib/engine'

const STEPS: { id: StepId; name: string; icon: typeof BookOpen }[] = [
  { id: 'novel', name: '小说输入', icon: BookOpen },
  { id: 'script', name: '剧本改编', icon: Clapperboard },
  { id: 'characters', name: '角色工坊', icon: Users },
  { id: 'storyboard', name: '分镜板', icon: LayoutGrid },
  { id: 'render', name: '试拍渲染', icon: Film },
  { id: 'theater', name: '放映厅', icon: Play },
]

export default function App() {
  const {
    step,
    setStep,
    project,
    projects,
    activeProjectId,
    settings,
    tick,
    createProject,
    switchProject,
    deleteProject,
    exportProjectJson,
    importProjectJson,
  } = useStore()
  const importRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')

  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // 渲染 worker 心跳
  useEffect(() => {
    const t = setInterval(() => tick(500), 500)
    return () => clearInterval(t)
  }, [tick])

  const onExportProject = () => {
    const json = exportProjectJson()
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.title.replace(/[\\/:*?"<>|]/g, '_') || 'duanju-project'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-screen bg-[#0a0a12] text-white">
      {/* 左侧流程导航 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-[#0d0d17]">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="text-base font-bold tracking-wide">短剧工坊</div>
          <div className="mt-0.5 text-[11px] text-white/40">你的小说,你来拍</div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {STEPS.map((s, i) => {
            const active = step === s.id
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-violet-600/90 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    active ? 'bg-white/20' : 'bg-white/10'
                  }`}
                >
                  {i + 1}
                </span>
                <s.icon className="h-4 w-4" />
                {s.name}
              </button>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <SettingsDialog />
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-white/10 px-5 py-2.5">
          {/* 多项目切换 */}
          <Select value={activeProjectId} onValueChange={switchProject}>
            <SelectTrigger className="h-8 w-44 border-white/10 bg-white/5 text-xs">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge
            variant="outline"
            className={`text-[10px] ${
              settings.mode === 'demo'
                ? 'border-amber-500/40 text-amber-300'
                : 'border-emerald-500/40 text-emerald-300'
            }`}
          >
            {settings.mode === 'demo'
              ? '演示模式'
              : settings.videoProvider === 'minimax'
                ? '真实生成 · MiniMax 云端 H3'
                : settings.comfyWorkflowMode === 'minimax-h3-auto'
                  ? '真实生成 · ComfyUI MiniMax-H3'
                  : '真实生成 · ComfyUI 自定义'}
          </Badge>
          {project.styleApproved && (
            <Badge variant="outline" className="border-violet-500/40 text-[10px] text-violet-300">
              画风已锁定
            </Badge>
          )}
          {importMsg && <span className="text-[11px] text-emerald-300/80">{importMsg}</span>}

          <div className="ml-auto flex items-center gap-1.5">
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const res = importProjectJson(await file.text())
                setImportMsg(res.detail)
                setTimeout(() => setImportMsg(''), 3500)
                e.target.value = ''
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-white/55 hover:text-white"
              onClick={onExportProject}
              title="导出当前项目为 JSON 备份"
            >
              <Download className="mr-1 h-3.5 w-3.5" /> 备份
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-white/55 hover:text-white"
              onClick={() => importRef.current?.click()}
              title="从 JSON 导入项目"
            >
              <Upload className="mr-1 h-3.5 w-3.5" /> 导入
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-white/60 hover:text-white"
              onClick={() => createProject()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 新项目
            </Button>
            {projects.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-white/40 hover:text-red-400"
                onClick={() => {
                  if (confirm(`确定删除项目「${project.title}」?`)) deleteProject(project.id)
                }}
                title="删除当前项目"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 'novel' && <NovelInput />}
          {step === 'script' && <ScriptPage />}
          {step === 'characters' && <CharactersPage />}
          {step === 'storyboard' && <StoryboardPage />}
          {step === 'render' && <RenderPage />}
          {step === 'theater' && <TheaterPage />}
        </div>
      </main>
    </div>
  )
}

function SettingsDialog() {
  const { settings, setSettings } = useStore()
  const [ping, setPing] = useState<string>('')
  const [llmPing, setLlmPing] = useState<string>('')
  const [showAdvancedH3, setShowAdvancedH3] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white/80 hover:bg-white/10">
          <SettingsIcon className="mr-2 h-4 w-4" /> 生成引擎设置
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-white/10 bg-[#12121c] text-white">
        <DialogHeader>
          <DialogTitle>生成引擎设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pr-1 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
            <div>
              <div className="font-medium">运行模式</div>
              <div className="text-xs text-white/40">演示模式体验流程;真实生成使用本地 ComfyUI 或 MiniMax 云端 H3</div>
            </div>
            <Select value={settings.mode} onValueChange={(v) => setSettings({ mode: v as 'demo' | 'local' })}>
              <SelectTrigger className="w-32 border-white/10 bg-black/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">演示模式</SelectItem>
                <SelectItem value="local">真实生成</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>视频生成渠道</Label>
                <p className="mt-1 text-[11px] text-white/40">本地优先 ComfyUI MiniMax-H3(自动支持角色参考图 Ref2VA);无本地显卡时用云端</p>
              </div>
              <Select
                value={settings.videoProvider}
                onValueChange={(v) => { setSettings({ videoProvider: v as 'comfy' | 'minimax' }); setPing('') }}
              >
                <SelectTrigger className="w-44 shrink-0 border-white/10 bg-black/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfy">ComfyUI 本地 H3</SelectItem>
                  <SelectItem value="minimax">MiniMax 云端 H3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {settings.videoProvider === 'comfy' ? (
              <>
                <div className="space-y-2">
                  <Label>ComfyUI 地址</Label>
                  <div className="flex gap-2">
                    <Input value={settings.comfyUrl} onChange={(e) => setSettings({ comfyUrl: e.target.value })} className="border-white/10 bg-black/40" />
                    <Button variant="outline" className="shrink-0 border-white/10" onClick={async () => {
                      setPing('检测中…')
                      const r = await pingComfy(settings.comfyUrl)
                      setPing(r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`)
                    }}>测试连接</Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded bg-black/25 p-2.5">
                  <div>
                    <div className="text-xs font-medium text-white/80">工作流模式</div>
                    <div className="text-[11px] text-white/40">
                      内置模式直接适配本地 MiniMax-H3(含 SLA + LowVRAM + 角色图 Ref2VA 锁脸)
                    </div>
                  </div>
                  <Select
                    value={settings.comfyWorkflowMode}
                    onValueChange={(v) => setSettings({ comfyWorkflowMode: v as 'minimax-h3-auto' | 'custom' })}
                  >
                    <SelectTrigger className="w-48 shrink-0 border-white/10 bg-black/40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimax-h3-auto">内置 MiniMax-H3 (自动)</SelectItem>
                      <SelectItem value="custom">自定义 API JSON 模板</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {settings.comfyWorkflowMode === 'minimax-h3-auto' ? (
                  <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">H3 采样步数:{settings.comfyH3Steps}</Label>
                        <Input
                          type="range"
                          min={2}
                          max={12}
                          value={settings.comfyH3Steps}
                          onChange={(e) => setSettings({ comfyH3Steps: Number(e.target.value) })}
                          className="border-white/10 bg-black/40"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">参考图分辨率策略</Label>
                        <Select
                          value={settings.comfyRefImageSize}
                          onValueChange={(v) => setSettings({ comfyRefImageSize: v as 'match' | 'max' })}
                        >
                          <SelectTrigger className="h-8 border-white/10 bg-black/40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="match">match (16GB 显存推荐)</SelectItem>
                            <SelectItem value="max">max (最高一致性,更慢)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedH3((v) => !v)}
                      className="text-[11px] text-violet-300/80 hover:text-violet-200"
                    >
                      {showAdvancedH3 ? '收起模型文件名配置 ▲' : '展开本地模型文件名配置 ▼'}
                    </button>
                    {showAdvancedH3 && (
                      <div className="grid grid-cols-1 gap-2 pt-1">
                        <Input value={settings.comfyH3Unet} onChange={(e) => setSettings({ comfyH3Unet: e.target.value })} placeholder="UNET 模型文件名" className="h-8 border-white/10 bg-black/40 font-mono text-[11px]" />
                        <Input value={settings.comfyH3Clip} onChange={(e) => setSettings({ comfyH3Clip: e.target.value })} placeholder="CLIP 模型文件名" className="h-8 border-white/10 bg-black/40 font-mono text-[11px]" />
                        <div className="grid grid-cols-2 gap-2">
                          <Input value={settings.comfyH3VideoVae} onChange={(e) => setSettings({ comfyH3VideoVae: e.target.value })} placeholder="Video VAE" className="h-8 border-white/10 bg-black/40 font-mono text-[11px]" />
                          <Input value={settings.comfyH3AudioVae} onChange={(e) => setSettings({ comfyH3AudioVae: e.target.value })} placeholder="Audio VAE" className="h-8 border-white/10 bg-black/40 font-mono text-[11px]" />
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] leading-4 text-white/40">
                      出镜角色有设定图时自动上传并切换至 <code className="text-violet-300">MiniMaxH3ReferenceToVideo</code> + <code className="text-violet-300">&lt;Picture i&gt;</code> 锁脸; 无设定图时自动使用 T2VA。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>视频工作流(API 格式 JSON)</Label>
                      <Input
                        type="file"
                        accept=".json,application/json"
                        className="h-8 w-44 cursor-pointer border-white/10 bg-black/40 text-xs file:mr-2 file:border-0 file:bg-violet-600 file:text-white"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            const text = await file.text()
                            JSON.parse(text)
                            setSettings({ workflowTemplate: text })
                            setPing(`✓ 已导入 ${file.name}`)
                          } catch { setPing('✗ 工作流不是合法 JSON') }
                          e.target.value = ''
                        }}
                      />
                    </div>
                    <Textarea
                      value={settings.workflowTemplate}
                      onChange={(e) => setSettings({ workflowTemplate: e.target.value })}
                      placeholder='粘贴 ComfyUI API 格式 JSON。可用 "{{prompt}}" "{{seed}}" "{{frames}}" "{{steps}}" "{{width}}" "{{height}}" "{{ref_image_1}}" 占位符。'
                      className="min-h-[110px] resize-y border-white/10 bg-black/40 font-mono text-[11px] leading-4 placeholder:text-white/25"
                    />
                    <p className="text-[11px] leading-4 text-white/40">需包含 SaveVideo / VHS Video Combine 保存节点;完成后会自动缓存成片到本地。</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>接口地址</Label>
                    <Input value={settings.minimaxApiBase} onChange={(e) => setSettings({ minimaxApiBase: e.target.value })} className="border-white/10 bg-black/40 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>模型</Label>
                    <Input value={settings.minimaxModel} onChange={(e) => setSettings({ minimaxModel: e.target.value })} className="border-white/10 bg-black/40 text-xs" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>MiniMax API Key</Label>
                  <Input type="password" value={settings.minimaxApiKey} onChange={(e) => setSettings({ minimaxApiKey: e.target.value })} placeholder="只保存在本机,用于创建和查询视频任务" className="border-white/10 bg-black/40" />
                </div>
                <div className="flex items-center justify-between rounded bg-black/25 p-2.5">
                  <span className="text-xs text-white/65">生成原生音频</span>
                  <Switch checked={settings.minimaxGenerateAudio} onCheckedChange={(v) => setSettings({ minimaxGenerateAudio: v })} />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="border-white/10" onClick={async () => {
                    setPing('检查中…')
                    setPing((await checkMiniMaxConfig(settings)).detail)
                  }}>检查配置</Button>
                  <span className="text-[11px] leading-4 text-amber-200/60">云端按 MiniMax 平台规则计费;检查配置不会创建视频任务。</span>
                </div>
              </>
            )}
            {ping && <div className="text-xs leading-5 text-white/55">{ping}</div>}
          </div>

          {/* 角色设定图生成渠道(已修复 builtin 下误渲染 cloudapi 输入框的问题) */}
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <Label>角色设定图(三视图)生成渠道</Label>
              <Select
                value={settings.imageProvider}
                onValueChange={(v) => setSettings({ imageProvider: v as 'builtin' | 'comfy' | 'cloudapi' })}
              >
                <SelectTrigger className="w-36 border-white/10 bg-black/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">内置生成</SelectItem>
                  <SelectItem value="comfy">ComfyUI 生图</SelectItem>
                  <SelectItem value="cloudapi">云端图像 API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settings.imageProvider === 'builtin' && (
              <p className="text-[11px] leading-4 text-white/40">
                使用本机可选内置生图工具(通过环境变量 <code className="text-white/60">IMAGE_GEN_TOOL</code> / <code className="text-white/60">KIMI_API_KEY</code> 或本机托管环境自动探测)。如未配置可切换到 ComfyUI 或云端图像 API。
              </p>
            )}
            {settings.imageProvider === 'comfy' && (
              <Textarea
                value={settings.imageWorkflowTemplate}
                onChange={(e) => setSettings({ imageWorkflowTemplate: e.target.value })}
                placeholder='粘贴 ComfyUI 文生图工作流(API 格式 JSON),用 "{{prompt}}" "{{seed}}" "{{width}}" "{{height}}" "{{steps}}" 标记参数。建议 1024x1536 竖版三视图'
                className="min-h-[80px] resize-y border-white/10 bg-black/40 font-mono text-[11px] leading-4 placeholder:text-white/25"
              />
            )}
            {settings.imageProvider === 'cloudapi' && (
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={settings.imageApiBase}
                  onChange={(e) => setSettings({ imageApiBase: e.target.value })}
                  placeholder="接口地址 /v1"
                  className="border-white/10 bg-black/40 text-xs"
                />
                <Input
                  type="password"
                  value={settings.imageApiKey}
                  onChange={(e) => setSettings({ imageApiKey: e.target.value })}
                  placeholder="API Key"
                  className="border-white/10 bg-black/40 text-xs"
                />
                <Input
                  value={settings.imageApiModel}
                  onChange={(e) => setSettings({ imageApiModel: e.target.value })}
                  placeholder="模型名"
                  className="border-white/10 bg-black/40 text-xs"
                />
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-white/10 p-3">
            <div>
              <Label>剧本改编与智能改稿 LLM(OpenAI 兼容接口)</Label>
              <p className="mt-1 text-[11px] text-white/40">真实生成模式下,剧本分镜、角色抽取、设定修改和反馈重写提示词都会调用此 LLM;演示模式使用本地规则。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>接口地址(含 /v1)</Label>
                <Input value={settings.llmBase} onChange={(e) => setSettings({ llmBase: e.target.value })} className="border-white/10 bg-black/40" />
              </div>
              <div className="space-y-2">
                <Label>模型名</Label>
                <Input value={settings.llmModel} onChange={(e) => setSettings({ llmModel: e.target.value })} className="border-white/10 bg-black/40" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>API Key(本地 Ollama 可留空)</Label>
              <Input type="password" value={settings.llmKey} onChange={(e) => setSettings({ llmKey: e.target.value })} className="border-white/10 bg-black/40" />
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="border-white/10" onClick={async () => {
                setLlmPing('正在发送极短测试请求…')
                setLlmPing((await pingLlm(settings)).detail)
              }}>测试 LLM</Button>
              {llmPing && <span className="text-xs text-white/50">{llmPing}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>分辨率</Label>
              <Select
                value={settings.resolution}
                onValueChange={(v) => setSettings({ resolution: v })}
              >
                <SelectTrigger className="border-white/10 bg-black/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="480x864">480×864 竖屏(快/省显存)</SelectItem>
                  <SelectItem value="576x1024">576×1024 竖屏(5080 16GB 推荐)</SelectItem>
                  <SelectItem value="736x1280">736×1280 竖屏(高清)</SelectItem>
                  <SelectItem value="960x544">960×544 横屏 16:9(0.5MP)</SelectItem>
                  <SelectItem value="1088x1920">1088×1920 竖屏(慢)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>自定义工作流采样步数:{settings.steps}</Label>
              <Input
                type="range"
                min={4}
                max={50}
                value={settings.steps}
                onChange={(e) => setSettings({ steps: Number(e.target.value) })}
                className="border-white/10 bg-black/40"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
            <div>
              <div className="font-medium">AI 自动微调</div>
              <div className="text-xs text-white/40">
                真实模式下由 LLM 按反馈重写提示词;演示模式使用内置规则自动补全一致性约束
              </div>
            </div>
            <Switch
              checked={settings.autoFix}
              onCheckedChange={(v) => setSettings({ autoFix: v })}
            />
          </div>

          {settings.mode === 'demo' && (
            <div className="space-y-2">
              <Label>演示模式单镜头耗时:{settings.renderSecondsPerShot} 秒</Label>
              <Input
                type="range"
                min={1}
                max={15}
                value={settings.renderSecondsPerShot}
                onChange={(e) => setSettings({ renderSecondsPerShot: Number(e.target.value) })}
                className="border-white/10 bg-black/40"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

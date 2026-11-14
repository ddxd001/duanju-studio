import { useEffect, useState } from 'react'
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
  RotateCcw,
} from 'lucide-react'
import NovelInput from '@/pages/NovelInput'
import ScriptPage from '@/pages/ScriptPage'
import CharactersPage from '@/pages/CharactersPage'
import StoryboardPage from '@/pages/StoryboardPage'
import RenderPage from '@/pages/RenderPage'
import TheaterPage from '@/pages/TheaterPage'
import { pingComfy } from '@/lib/engine'

const STEPS: { id: StepId; name: string; icon: typeof BookOpen }[] = [
  { id: 'novel', name: '小说输入', icon: BookOpen },
  { id: 'script', name: '剧本改编', icon: Clapperboard },
  { id: 'characters', name: '角色工坊', icon: Users },
  { id: 'storyboard', name: '分镜板', icon: LayoutGrid },
  { id: 'render', name: '试拍渲染', icon: Film },
  { id: 'theater', name: '放映厅', icon: Play },
]

export default function App() {
  const { step, setStep, project, settings, tick, resetAll } = useStore()

  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // 渲染 worker 心跳
  useEffect(() => {
    const t = setInterval(() => tick(500), 500)
    return () => clearInterval(t)
  }, [tick])

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
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <h1 className="truncate text-sm font-medium">{project.title}</h1>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              settings.mode === 'demo'
                ? 'border-amber-500/40 text-amber-300'
                : 'border-emerald-500/40 text-emerald-300'
            }`}
          >
            {settings.mode === 'demo' ? '演示模式' : '本地生成'}
          </Badge>
          {project.styleApproved && (
            <Badge variant="outline" className="border-violet-500/40 text-[10px] text-violet-300">
              画风已锁定
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/50 hover:text-white"
              onClick={() => {
                if (confirm('确定清空当前项目并重新开始?')) resetAll()
              }}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> 新项目
            </Button>
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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white/80 hover:bg-white/10">
          <SettingsIcon className="mr-2 h-4 w-4" /> 生成引擎设置
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-white/10 bg-[#12121c] text-white">
        <DialogHeader>
          <DialogTitle>生成引擎设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pr-1 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
            <div>
              <div className="font-medium">运行模式</div>
              <div className="text-xs text-white/40">
                演示模式无需显卡即可体验完整流程;本地模式对接你的 ComfyUI
              </div>
            </div>
            <Select
              value={settings.mode}
              onValueChange={(v) => setSettings({ mode: v as 'demo' | 'local' })}
            >
              <SelectTrigger className="w-32 border-white/10 bg-black/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">演示模式</SelectItem>
                <SelectItem value="local">本地生成</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>ComfyUI 地址(MiniMax H3)</Label>
            <div className="flex gap-2">
              <Input
                value={settings.comfyUrl}
                onChange={(e) => setSettings({ comfyUrl: e.target.value })}
                className="border-white/10 bg-black/40"
              />
              <Button
                variant="outline"
                className="border-white/10 shrink-0"
                onClick={async () => {
                  setPing('检测中…')
                  setPing((await pingComfy(settings.comfyUrl)) ? '✓ 连接成功' : '✗ 无法连接')
                }}
              >
                测试
              </Button>
            </div>
            {ping && <div className="text-xs text-white/50">{ping}</div>}
          </div>

          <div className="space-y-2">
            <Label>视频生成工作流(API 格式 JSON)</Label>
            <Textarea
              value={settings.workflowTemplate}
              onChange={(e) => setSettings({ workflowTemplate: e.target.value })}
              placeholder='在 ComfyUI 里搭好 H3 工作流后,点「保存(API 格式)」导出 JSON 粘贴到这里。用占位符标记参数:"{{prompt}}" "{{seed}}" "{{frames}}" "{{steps}}" "{{width}}" "{{height}}"'
              className="min-h-[110px] resize-y border-white/10 bg-black/40 font-mono text-[11px] leading-4 placeholder:text-white/25"
            />
            <p className="text-[11px] leading-4 text-white/35">
              工作流里需要包含视频保存节点(如 VHS Video Combine),渲染完成后软件会自动取回视频播放。
            </p>
          </div>

          {/* 角色设定图生成渠道 */}
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
                用软件自带的图像生成服务出图,无需任何配置。角色卡上点「生成三视图设定图」即可,约 1-2 分钟一张。
              </p>
            )}
            {settings.imageProvider === 'comfy' ? (
              <Textarea
                value={settings.imageWorkflowTemplate}
                onChange={(e) => setSettings({ imageWorkflowTemplate: e.target.value })}
                placeholder='粘贴 ComfyUI 文生图工作流(API 格式 JSON),用 "{{prompt}}" "{{seed}}" "{{width}}" "{{height}}" "{{steps}}" 标记参数。建议 1024x1536 竖版三视图'
                className="min-h-[80px] resize-y border-white/10 bg-black/40 font-mono text-[11px] leading-4 placeholder:text-white/25"
              />
            ) : (
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>LLM 接口地址</Label>
              <Input
                value={settings.llmBase}
                onChange={(e) => setSettings({ llmBase: e.target.value })}
                className="border-white/10 bg-black/40"
              />
            </div>
            <div className="space-y-2">
              <Label>模型名</Label>
              <Input
                value={settings.llmModel}
                onChange={(e) => setSettings({ llmModel: e.target.value })}
                className="border-white/10 bg-black/40"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>LLM API Key(本地可留空)</Label>
            <Input
              type="password"
              value={settings.llmKey}
              onChange={(e) => setSettings({ llmKey: e.target.value })}
              className="border-white/10 bg-black/40"
            />
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
                  <SelectItem value="480x864">480p(快)</SelectItem>
                  <SelectItem value="720x1280">720p(推荐)</SelectItem>
                  <SelectItem value="1080x1920">1080p(慢)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>采样步数:{settings.steps}</Label>
              <Input
                type="range"
                min={10}
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
                反馈命中规则时自动修正提示词(如"脸变了"→加强角色一致性)
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

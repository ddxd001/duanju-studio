// ① 小说输入:粘贴原文 / 载入示例,选画风,定集数与时长
import { useStore } from '@/lib/store'
import { STYLE_PRESETS } from '@/lib/mockData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Sparkles, ArrowRight, FileText } from 'lucide-react'

export default function NovelInput() {
  const { project, setNovelInfo, applySample, adaptScript, setStep, adapting, adaptError } = useStore()

  const canAdapt = project.novelText.trim().length >= 50

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h2 className="text-xl font-bold">想拍什么故事?</h2>
        <p className="mt-1 text-sm text-white/50">
          粘贴你的小说原文(或一段脑洞),工坊会把它改编成分集分镜脚本。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 左:文本输入 */}
        <div className="space-y-3 lg:col-span-3">
          <div className="flex items-center gap-2">
            <Input
              value={project.title}
              onChange={(e) => setNovelInfo({ title: e.target.value })}
              placeholder="给你的短剧起个名字"
              className="border-white/10 bg-white/5"
            />
            <Button
              variant="outline"
              className="shrink-0 border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
              onClick={applySample}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" /> 载入示例小说
            </Button>
          </div>
          <Textarea
            value={project.novelText}
            onChange={(e) => setNovelInfo({ novelText: e.target.value })}
            placeholder="在这里粘贴小说原文…(至少 50 字,越长分镜越丰富)"
            className="h-80 resize-none border-white/10 bg-white/5 leading-6"
          />
          <div className="text-right text-xs text-white/30">{project.novelText.length} 字</div>
        </div>

        {/* 右:画风与参数 */}
        <div className="space-y-4 lg:col-span-2">
          <div>
            <Label className="text-white/70">选择画风(试拍前随时可改)</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setNovelInfo({ styleId: s.id })}
                  className={`rounded-lg border p-2 text-left transition-all ${
                    project.styleId === s.id
                      ? 'border-violet-500 bg-violet-500/15'
                      : 'border-white/10 bg-white/5 hover:border-white/25'
                  }`}
                >
                  <div
                    className="mb-1.5 h-8 rounded"
                    style={{
                      background: `linear-gradient(120deg, ${s.palette[0]}, ${s.palette[1]})`,
                    }}
                  />
                  <div className="text-xs font-medium">{s.name}</div>
                  <div className="text-[10px] text-white/40">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-white/70">追加画风描述(可选)</Label>
            <Input
              value={project.customStyle}
              onChange={(e) => setNovelInfo({ customStyle: e.target.value })}
              placeholder="例:整体偏冷色调,雨夜氛围"
              className="border-white/10 bg-white/5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-white/70">集数:{project.episodeCount}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="range"
                  min={1}
                  max={100}
                  value={Math.min(project.episodeCount, 100)}
                  onChange={(e) => setNovelInfo({ episodeCount: Number(e.target.value) })}
                  className="flex-1 border-white/10 bg-white/5"
                />
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={project.episodeCount}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(200, Number(e.target.value) || 1))
                    setNovelInfo({ episodeCount: v })
                  }}
                  className="h-8 w-16 shrink-0 border-white/10 bg-black/40 text-center text-xs"
                  title="可直接输入,最大 200 集"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-white/70">每集时长:{project.episodeLength} 秒</Label>
              <Input
                type="range"
                min={30}
                max={180}
                step={10}
                value={project.episodeLength}
                onChange={(e) => setNovelInfo({ episodeLength: Number(e.target.value) })}
                className="border-white/10 bg-white/5"
              />
            </div>
          </div>

          <Button
            disabled={!canAdapt || adapting}
            onClick={async () => {
              await adaptScript()
              if (!useStore.getState().adaptError) setStep('script')
            }}
            className="w-full bg-violet-600 py-5 text-base hover:bg-violet-500"
          >
            <Sparkles className={`mr-2 h-4 w-4 ${adapting ? 'animate-pulse' : ''}`} />
            {adapting ? 'AI 正在改编…' : '开始改编剧本'} {!adapting && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
          {adaptError && <p className="rounded bg-red-500/10 p-2 text-xs leading-5 text-red-300">{adaptError}</p>}
          {!canAdapt && !adaptError && (
            <p className="text-center text-xs text-white/30">至少输入 50 字才能改编</p>
          )}
        </div>
      </div>
    </div>
  )
}

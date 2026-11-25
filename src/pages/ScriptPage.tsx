// ② 剧本改编:分集大纲 + 分镜脚本(可直接编辑,改完再进角色工坊)
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

export default function ScriptPage() {
  const { project, adaptScript, updateShotField, setStep, adapting, adaptError } = useStore()
  const [openEp, setOpenEp] = useState<string | null>(project.episodes[0]?.id ?? null)

  if (project.episodes.length === 0) {
    return (
      <EmptyHint text="还没有剧本。回到「小说输入」,粘贴原文后点「开始改编剧本」。" />
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">剧本分镜</h2>
          <p className="mt-1 text-sm text-white/50">
            共 {project.episodes.length} 集 · {project.shots.length} 个镜头。每个镜头的画面描述、台词都可以直接改。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-white/10 text-white/70"
            disabled={adapting}
            onClick={() => {
              if (confirm('重新改编会清空现有分镜与角色,确定?')) void adaptScript()
            }}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${adapting ? 'animate-spin' : ''}`} />
            {adapting ? '改编中…' : '重新改编'}
          </Button>
          <Button className="bg-violet-600 hover:bg-violet-500" onClick={() => setStep('characters')}>
            进入角色工坊 <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
      {adaptError && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{adaptError}</div>}

      <div className="space-y-3">
        {project.episodes.map((ep) => {
          const shots = project.shots.filter((s) => s.episodeId === ep.id)
          const open = openEp === ep.id
          return (
            <div key={ep.id} className="rounded-xl border border-white/10 bg-white/[0.03]">
              <button
                onClick={() => setOpenEp(open ? null : ep.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                {open ? <ChevronDown className="h-4 w-4 text-white/40" /> : <ChevronRight className="h-4 w-4 text-white/40" />}
                <span className="font-medium">{ep.title}</span>
                <span className="truncate text-sm text-white/45">{ep.synopsis}</span>
                <Badge variant="outline" className="ml-auto shrink-0 border-white/15 text-[10px] text-white/50">
                  {shots.length} 镜头
                </Badge>
              </button>

              {open && (
                <div className="space-y-3 border-t border-white/10 p-4">
                  {shots.map((sh) => (
                    <div key={sh.id} className="rounded-lg bg-black/30 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs">
                        <Badge className="bg-white/10 text-[10px]">镜头 {sh.index}</Badge>
                        <span className="text-white/40">{sh.scene}</span>
                        <span className="text-white/40">· {sh.duration}s</span>
                        {sh.characters.length > 0 && (
                          <span className="text-violet-300/70">出场:{sh.characters.join('、')}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <Input
                          value={sh.title}
                          onChange={(e) => updateShotField(sh.id, { title: e.target.value })}
                          className="border-white/10 bg-white/5 text-xs"
                          placeholder="镜头摘要"
                        />
                        <Input
                          value={sh.dialogue}
                          onChange={(e) => updateShotField(sh.id, { dialogue: e.target.value })}
                          className="border-white/10 bg-white/5 text-xs"
                          placeholder="台词 / 旁白"
                        />
                        <Input
                          type="number"
                          min={4}
                          max={15}
                          value={sh.duration}
                          onChange={(e) =>
                            updateShotField(sh.id, {
                              duration: Math.min(15, Math.max(4, Number(e.target.value) || 6)),
                            })
                          }
                          className="border-white/10 bg-white/5 text-xs"
                          placeholder="时长(4-15秒)"
                        />
                      </div>
                      <Textarea
                        value={sh.basePrompt}
                        onChange={(e) => updateShotField(sh.id, { basePrompt: e.target.value })}
                        className="mt-2 min-h-[44px] resize-y border-white/10 bg-white/5 text-xs leading-5"
                        placeholder="画面描述(将作为视频生成提示词的主体)"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EmptyHint({ text }: { text: string }) {
  const { setStep } = useStore()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-white/40">
      <p className="text-sm">{text}</p>
      <Button variant="outline" className="border-white/15" onClick={() => setStep('novel')}>
        去输入小说
      </Button>
    </div>
  )
}

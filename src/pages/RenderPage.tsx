// ⑤ 试拍与批量渲染:先试拍一段锁画风,满意后再批量开拍(支持队列暂停与单任务取消)
import { useState } from 'react'
import { useStore, getStyle } from '@/lib/store'
import MockClip from '@/components/MockClip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Check, Film, Layers, Loader2, Lock, Info, Pause, Play, X } from 'lucide-react'
import { EmptyHint } from './ScriptPage'

export default function RenderPage() {
  const {
    project,
    settings,
    queuePaused,
    renderShot,
    cancelShot,
    toggleQueuePaused,
    approveStyle,
    restyleUnapproved,
    queueAllPending,
    setStep,
  } = useStore()
  const style = getStyle(project.styleId)
  const [styleFeedback, setStyleFeedback] = useState('')

  if (project.shots.length === 0) {
    return <EmptyHint text="还没有可渲染的分镜。先去改编剧本。" />
  }

  const sampleShot = project.shots[0]
  const sampleCurrent = sampleShot?.versions.find((v) => v.id === sampleShot.currentVersionId)
  const queued = project.shots.filter((s) => s.status === 'queued' || s.status === 'rendering')
  const pending = project.shots.filter((s) => s.status === 'draft' || s.status === 'review')
  const approved = project.shots.filter((s) => s.status === 'approved')

  const estMinutes =
    settings.mode === 'local' && settings.videoProvider === 'comfy'
      ? Math.round(pending.length * 3 * (settings.resolution.startsWith('7') ? 1.5 : 1))
      : Math.round((pending.length * settings.renderSecondsPerShot) / 60)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* ===== 第一步:试拍锁画风 ===== */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Film className="h-5 w-5 text-violet-400" /> 第一步:试拍样片
          </h3>
          {project.styleApproved ? (
            <Badge className="bg-emerald-600/80">画风已锁定</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/40 text-amber-300">
              未锁定
            </Badge>
          )}
        </div>
        <p className="mb-4 text-sm text-white/50">
          正式开拍前先渲染一段样片。画风不满意就直说,系统会带着你的意见重拍全部未通过镜头 ——
          <span className="text-white/80"> 确认画风后才解锁批量生成,避免跑一整夜结果方向错了。</span>
        </p>

        <div className="flex flex-col gap-5 md:flex-row">
          <div className="w-48 shrink-0">
            {sampleCurrent ? (
              <MockClip
                seed={sampleCurrent.seed}
                style={style}
                subtitle={sampleShot.dialogue}
                label={`试拍 · v${sampleCurrent.n}`}
                playing={sampleShot.status !== 'approved'}
                videoUrl={sampleCurrent.videoUrl}
              />
            ) : (
              <button
                onClick={() => void renderShot(sampleShot.id)}
                className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 text-white/40 hover:border-violet-500/50 hover:text-violet-300"
              >
                <Film className="h-6 w-6" />
                <span className="text-xs">渲染试拍样片</span>
              </button>
            )}
            {sampleShot.status === 'rendering' && (
              <div className="mt-2 flex items-center gap-2 text-xs text-amber-300">
                <Loader2 className="h-3 w-3 animate-spin" /> 渲染中 {Math.floor(sampleShot.progress)}%
              </div>
            )}
            {sampleShot.renderError && (
              <div className="mt-2 rounded bg-red-500/10 p-1.5 text-[11px] text-red-300">
                {sampleShot.renderError}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3">
            <div className="rounded-lg bg-black/30 p-3 text-xs leading-5 text-white/60">
              <div className="mb-1 text-white/40">当前画风配方</div>
              {style.keywords}
              {project.customStyle && <span className="text-violet-300"> + {project.customStyle}</span>}
            </div>

            {!project.styleApproved ? (
              <>
                <div className="flex gap-2">
                  <Input
                    value={styleFeedback}
                    onChange={(e) => setStyleFeedback(e.target.value)}
                    placeholder="画风不满意?例:太暗了 / 人物不够精致 / 换成暖色调"
                    className="border-white/10 bg-black/40 text-sm"
                  />
                  <Button
                    variant="outline"
                    className="shrink-0 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                    disabled={!styleFeedback.trim() || !sampleCurrent}
                    onClick={() => {
                      restyleUnapproved(styleFeedback.trim())
                      setStyleFeedback('')
                    }}
                  >
                    带意见重拍
                  </Button>
                </div>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-500"
                  disabled={!sampleCurrent || sampleShot.status === 'rendering'}
                  onClick={approveStyle}
                >
                  <Check className="mr-1 h-4 w-4" /> 画风满意,锁定并解锁批量生成
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <Lock className="h-4 w-4" /> 画风已锁定。如需整体调整,回「小说输入」修改画风后重新试拍。
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== 第二步:批量渲染 ===== */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Layers className="h-5 w-5 text-violet-400" /> 第二步:批量生成
          </h3>
          {queued.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto border-white/15 text-xs text-white/75"
              onClick={toggleQueuePaused}
            >
              {queuePaused ? (
                <>
                  <Play className="mr-1 h-3.5 w-3.5" /> 继续队列
                </>
              ) : (
                <>
                  <Pause className="mr-1 h-3.5 w-3.5" /> 暂停后续派发
                </>
              )}
            </Button>
          )}
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="待拍摄" value={pending.length} cls="text-white" />
          <Stat label="队列中" value={queued.length} cls="text-amber-300" />
          <Stat label="已通过" value={approved.length} cls="text-emerald-300" />
        </div>

        <Button
          className="w-full bg-violet-600 py-5 hover:bg-violet-500"
          disabled={!project.styleApproved || pending.length === 0}
          onClick={queueAllPending}
        >
          {project.styleApproved ? (
            <>一键开拍全部 {pending.length} 个镜头</>
          ) : (
            <>
              <Lock className="mr-2 h-4 w-4" /> 先在上方锁定画风
            </>
          )}
        </Button>

        {pending.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-sky-500/10 p-3 text-xs text-sky-200/80">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {settings.mode === 'demo'
              ? `演示模式预计 ${Math.max(1, estMinutes)} 分钟跑完。`
              : settings.videoProvider === 'minimax'
                ? 'MiniMax 云端将按镜头依次创建任务,耗时取决于平台队列并会产生平台费用。完成后成片自动缓存到本机。'
                : `本地 ComfyUI MiniMax-H3 预计约 ${Math.max(1, estMinutes)} 分钟(RTX 5080 16GB / 4步 SLA 估算)。出镜角色如有设定图将自动以 Ref2VA 锁脸。`}
          </div>
        )}

        {/* 渲染队列 */}
        {queued.length > 0 && (
          <div className="mt-4 space-y-2">
            {queued.map((sh) => (
              <div key={sh.id} className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-2">
                <span className="w-28 truncate text-xs text-white/60">镜头 {sh.index} · {sh.title}</span>
                <Progress value={sh.status === 'queued' ? 0 : sh.progress} className="h-1.5 flex-1" />
                <span className="w-14 text-right text-[10px] text-white/40">
                  {sh.status === 'queued' ? '排队中' : `${Math.floor(sh.progress)}%`}
                </span>
                <button
                  onClick={() => cancelShot(sh.id)}
                  className="text-white/35 hover:text-red-400"
                  title="取消此任务"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {approved.length > 0 && (
          <div className="mt-4 text-center">
            <Button variant="outline" className="border-white/15" onClick={() => setStep('theater')}>
              去放映厅观看已通过片段 →
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-lg bg-black/30 py-3">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="mt-0.5 text-xs text-white/40">{label}</div>
    </div>
  )
}

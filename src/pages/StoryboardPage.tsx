// ④ 分镜板(核心):每个镜头 = 预览 + 状态 + 反馈重拍 + 版本回溯
import { useMemo, useState } from 'react'
import { useStore, getStyle } from '@/lib/store'
import MockClip from '@/components/MockClip'
import FeedbackBox from '@/components/FeedbackBox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Check, Clapperboard, Code2, Film } from 'lucide-react'
import { EmptyHint } from './ScriptPage'
import type { Shot, ShotStatus } from '@/types'

const STATUS_META: Record<ShotStatus, { label: string; cls: string }> = {
  draft: { label: '待拍摄', cls: 'border-white/20 text-white/50' },
  queued: { label: '排队中', cls: 'border-sky-500/40 text-sky-300' },
  rendering: { label: '渲染中', cls: 'border-amber-500/40 text-amber-300' },
  review: { label: '待确认', cls: 'border-violet-500/50 text-violet-300' },
  approved: { label: '已通过', cls: 'border-emerald-500/40 text-emerald-300' },
}

export default function StoryboardPage() {
  const {
    project,
    renderShot,
    approveShot,
    approveAllReview,
    rollbackShot,
    queueEpisode,
    setStep,
  } = useStore()
  const [epFilter, setEpFilter] = useState<string>('all')
  const style = getStyle(project.styleId)

  const shots = useMemo(
    () =>
      project.shots.filter(
        (s) => epFilter === 'all' || s.episodeId === epFilter,
      ),
    [project.shots, epFilter],
  )

  if (project.shots.length === 0) {
    return <EmptyHint text="还没有分镜。先去「小说输入」改编剧本。" />
  }

  const stats = {
    approved: project.shots.filter((s) => s.status === 'approved').length,
    review: project.shots.filter((s) => s.status === 'review').length,
    working: project.shots.filter((s) => s.status === 'queued' || s.status === 'rendering').length,
    total: project.shots.length,
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-bold">分镜板</h2>
          <p className="mt-1 text-sm text-white/50">
            哪个镜头不满意,就在卡片下面直接说 —— 每一次重拍都会留档,随时回滚。
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {stats.review > 0 && (
            <Button
              variant="outline"
              className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              onClick={approveAllReview}
            >
              <Check className="mr-1 h-4 w-4" /> 通过全部待确认({stats.review})
            </Button>
          )}
          <Button className="bg-violet-600 hover:bg-violet-500" onClick={() => setStep('render')}>
            <Film className="mr-1 h-4 w-4" /> 去试拍渲染
          </Button>
        </div>
      </div>

      {/* 进度 + 集筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-2 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/60">
          已通过 {stats.approved}/{stats.total}
          {stats.working > 0 && <span className="text-amber-300">· 渲染中 {stats.working}</span>}
        </div>
        <FilterBtn active={epFilter === 'all'} onClick={() => setEpFilter('all')}>
          全部
        </FilterBtn>
        {project.episodes.map((ep) => (
          <FilterBtn key={ep.id} active={epFilter === ep.id} onClick={() => setEpFilter(ep.id)}>
            {ep.title}
          </FilterBtn>
        ))}
      </div>

      {/* 镜头卡片网格 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {shots.map((sh) => (
          <ShotCard
            key={sh.id}
            shot={sh}
            episodeTitle={project.episodes.find((e) => e.id === sh.episodeId)?.title ?? ''}
            stylePalette={style}
            onRender={(fb) => renderShot(sh.id, fb)}
            onApprove={() => approveShot(sh.id)}
            onRollback={(vid) => rollbackShot(sh.id, vid)}
          />
        ))}
      </div>

      {/* 按集开拍入口 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <span className="flex items-center gap-1.5 text-sm text-white/50">
          <Clapperboard className="h-4 w-4" /> 按集开拍:
        </span>
        {project.episodes.map((ep) => (
          <Button
            key={ep.id}
            size="sm"
            variant="outline"
            className="border-white/15 text-white/70"
            onClick={() => queueEpisode(ep.id)}
          >
            {ep.title}
          </Button>
        ))}
      </div>
    </div>
  )
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition-colors ${
        active ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function ShotCard({
  shot,
  episodeTitle,
  stylePalette,
  onRender,
  onApprove,
  onRollback,
}: {
  shot: Shot
  episodeTitle: string
  stylePalette: ReturnType<typeof getStyle>
  onRender: (feedback?: string) => void
  onApprove: () => void
  onRollback: (versionId: string) => void
}) {
  const { updateShotPrompt } = useStore()
  const [promptOpen, setPromptOpen] = useState(false)
  const current = shot.versions.find((v) => v.id === shot.currentVersionId)
  const meta = STATUS_META[shot.status]
  const busy = shot.status === 'queued' || shot.status === 'rendering'

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        shot.status === 'approved'
          ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-white/35">{episodeTitle} · 镜头 {shot.index}</span>
        <Badge variant="outline" className={`ml-auto text-[9px] ${meta.cls}`}>
          {meta.label}
        </Badge>
      </div>

      {/* 预览区 */}
      <div className="relative mx-auto max-w-[170px]">
        {current ? (
          <MockClip
            seed={current.seed}
            style={stylePalette}
            subtitle={shot.dialogue}
            label={`v${current.n} · ${shot.duration}s`}
            playing={shot.status !== 'approved'}
            videoUrl={current.videoUrl}
          />
        ) : (
          <button
            onClick={() => onRender()}
            className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-violet-500/50 hover:text-violet-300"
          >
            <Film className="h-5 w-5" />
            <span className="text-[11px]">开拍此镜头</span>
          </button>
        )}
        {shot.status === 'rendering' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/70">
            <Progress value={shot.progress} className="w-3/4 h-1.5" />
            <span className="text-[10px] text-white/70">{Math.floor(shot.progress)}%</span>
          </div>
        )}
      </div>

      <div className="mt-2 line-clamp-2 min-h-[28px] text-[11px] leading-4 text-white/55">
        {shot.title}
      </div>

      {/* 本地模式渲染失败提示 */}
      {shot.renderError && (
        <div className="mt-1.5 rounded bg-red-500/10 p-1.5 text-[10px] leading-4 text-red-300">
          渲染失败:{shot.renderError}
          <button
            className="ml-1 underline hover:text-red-200"
            onClick={() => onRender()}
          >
            重试
          </button>
        </div>
      )}

      {/* 操作行 */}
      <div className="mt-1.5 space-y-1.5">
        {shot.status === 'review' && (
          <Button
            size="sm"
            className="h-7 w-full bg-emerald-600 text-xs hover:bg-emerald-500"
            onClick={onApprove}
          >
            <Check className="mr-1 h-3 w-3" /> 满意,通过
          </Button>
        )}

        {current && (
          <>
            <div className="flex items-center gap-1">
              <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
                <DialogTrigger asChild>
                  <button className="flex items-center gap-1 text-[10px] text-white/35 hover:text-white/70">
                    <Code2 className="h-3 w-3" /> 提示词
                  </button>
                </DialogTrigger>
                <DialogContent className="border-white/10 bg-[#12121c] text-white">
                  <DialogHeader>
                    <DialogTitle className="text-sm">
                      镜头 {shot.index} · v{current.n} 完整提示词(可直接改)
                    </DialogTitle>
                  </DialogHeader>
                  <Textarea
                    value={current.prompt}
                    onChange={(e) => updateShotPrompt(shot.id, e.target.value)}
                    className="min-h-[220px] border-white/10 bg-black/40 text-xs leading-5"
                  />
                  {current.autoFix.length > 0 && (
                    <p className="text-xs text-emerald-300/70">
                      系统自动修正:{current.autoFix.join('、')}
                    </p>
                  )}
                </DialogContent>
              </Dialog>
            </div>
            <FeedbackBox
              versions={shot.versions}
              currentVersionId={shot.currentVersionId}
              busy={busy}
              onSubmit={(fb) => onRender(fb)}
              onRollback={onRollback}
            />
          </>
        )}
      </div>
    </div>
  )
}

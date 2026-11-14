// ⑥ 放映厅:按集连播已通过镜头
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getStyle } from '@/lib/store'
import MockClip from '@/components/MockClip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Pause, Play, SkipBack, SkipForward, LayoutGrid } from 'lucide-react'
import { EmptyHint } from './ScriptPage'

export default function TheaterPage() {
  const { project, setStep } = useStore()
  const style = getStyle(project.styleId)
  const [epId, setEpId] = useState<string | null>(project.episodes[0]?.id ?? null)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shotMs, setShotMs] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const approvedShots = useMemo(
    () =>
      project.shots
        .filter((s) => s.episodeId === epId && s.status === 'approved')
        .sort((a, b) => a.index - b.index),
    [project.shots, epId],
  )

  const current = approvedShots[Math.min(idx, approvedShots.length - 1)]
  const currentVersion = current?.versions.find((v) => v.id === current.currentVersionId)

  // 播放计时
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!playing || !current) return
    timerRef.current = setInterval(() => {
      setShotMs((ms) => {
        if (ms + 200 >= current.duration * 1000) {
          // 播完本镜头,切下一个
          if (idx < approvedShots.length - 1) {
            setIdx((i) => i + 1)
            return 0
          }
          setPlaying(false)
          return current.duration * 1000
        }
        return ms + 200
      })
    }, 200)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [playing, current, idx, approvedShots.length])

  useEffect(() => {
    setIdx(0)
    setShotMs(0)
    setPlaying(false)
  }, [epId])

  if (project.shots.length === 0) {
    return <EmptyHint text="还没有内容可播。先去改编剧本、拍摄镜头。" />
  }

  const totalApproved = project.shots.filter((s) => s.status === 'approved').length

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-bold">放映厅</h2>
          <p className="mt-1 text-sm text-white/50">
            已通过 {totalApproved} 个镜头。只播放已通过的,未拍完的镜头会自动跳过。
          </p>
        </div>
        <Button
          variant="outline"
          className="ml-auto border-white/15 text-white/70"
          onClick={() => setStep('storyboard')}
        >
          <LayoutGrid className="mr-1 h-4 w-4" /> 回分镜板继续改
        </Button>
      </div>

      {/* 选集 */}
      <div className="flex flex-wrap gap-2">
        {project.episodes.map((ep) => {
          const count = project.shots.filter(
            (s) => s.episodeId === ep.id && s.status === 'approved',
          ).length
          const total = project.shots.filter((s) => s.episodeId === ep.id).length
          return (
            <button
              key={ep.id}
              onClick={() => setEpId(ep.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                epId === ep.id ? 'bg-violet-600' : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {ep.title}
              <span className="ml-1.5 text-[10px] opacity-60">
                {count}/{total}
              </span>
            </button>
          )
        })}
      </div>

      {/* 播放器 */}
      <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
        <div className="w-64 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl shadow-violet-900/20">
          {current && currentVersion ? (
            <MockClip
              seed={currentVersion.seed}
              style={style}
              subtitle={current.dialogue}
              label={`镜头 ${current.index}/${approvedShots.length}`}
              playing={playing}
              className="rounded-none"
              videoUrl={currentVersion.videoUrl}
            />
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center text-sm text-white/30">
              本集暂无已通过镜头
            </div>
          )}
        </div>

        <div className="w-full flex-1 space-y-4">
          {current && (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Badge className="bg-violet-600/80 text-[10px]">正在播放</Badge>
                  <span className="text-sm font-medium">{current.title}</span>
                </div>
                <p className="text-xs leading-5 text-white/50">{current.basePrompt}</p>
              </div>

              {/* 控制条 */}
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={idx === 0}
                  onClick={() => {
                    setIdx((i) => Math.max(0, i - 1))
                    setShotMs(0)
                  }}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  className="h-11 w-11 rounded-full bg-violet-600 hover:bg-violet-500"
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={idx >= approvedShots.length - 1}
                  onClick={() => {
                    setIdx((i) => Math.min(approvedShots.length - 1, i + 1))
                    setShotMs(0)
                  }}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                  <Progress value={(shotMs / (current.duration * 1000)) * 100} className="h-1.5" />
                </div>
                <span className="w-20 text-right text-xs text-white/40">
                  {(shotMs / 1000).toFixed(1)}s / {current.duration}s
                </span>
              </div>

              {/* 镜头列表 */}
              <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pr-1">
                {approvedShots.map((sh, i) => (
                  <button
                    key={sh.id}
                    onClick={() => {
                      setIdx(i)
                      setShotMs(0)
                    }}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      i === idx ? 'bg-violet-600/25 text-white' : 'bg-white/[0.03] text-white/50 hover:bg-white/10'
                    }`}
                  >
                    <span className="w-10 shrink-0 text-white/30">#{sh.index}</span>
                    <span className="truncate">{sh.title}</span>
                    <span className="ml-auto shrink-0 text-white/30">{sh.duration}s</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


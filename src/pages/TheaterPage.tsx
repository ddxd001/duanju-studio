// ⑥ 放映厅:按集连播已通过镜头(真视频按实际播放结束切镜) + 整集 MP4 拼接导出
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getStyle } from '@/lib/store'
import { exportEpisodeVideos } from '@/lib/engine'
import MockClip from '@/components/MockClip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Pause, Play, SkipBack, SkipForward, LayoutGrid, Download, Loader2 } from 'lucide-react'
import { EmptyHint } from './ScriptPage'

export default function TheaterPage() {
  const { project, setStep } = useStore()
  const style = getStyle(project.styleId)
  const [epId, setEpId] = useState<string | null>(project.episodes[0]?.id ?? null)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shotMs, setShotMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportInfo, setExportInfo] = useState<{ url?: string; filename?: string; msg: string; error?: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const activeEp = project.episodes.find((e) => e.id === epId) ?? project.episodes[0]

  const approvedShots = useMemo(
    () =>
      project.shots
        .filter((s) => s.episodeId === activeEp?.id && s.status === 'approved')
        .sort((a, b) => a.index - b.index),
    [project.shots, activeEp?.id],
  )

  const safeIdx = Math.min(idx, Math.max(0, approvedShots.length - 1))
  const current = approvedShots[safeIdx]
  const currentVersion = current?.versions.find((v) => v.id === current.currentVersionId)
  const hasRealVideo = Boolean(currentVersion?.videoUrl)

  const realVideoUrls = useMemo(
    () =>
      approvedShots
        .map((s) => s.versions.find((v) => v.id === s.currentVersionId)?.videoUrl)
        .filter((u): u is string => Boolean(u)),
    [approvedShots],
  )

  const selectEpisode = (nextEpId: string) => {
    setEpId(nextEpId)
    setIdx(0)
    setShotMs(0)
    setVideoDurationMs(0)
    setPlaying(false)
    setExportInfo(null)
  }

  const advanceNext = useCallback(() => {
    if (safeIdx < approvedShots.length - 1) {
      setIdx(safeIdx + 1)
      setShotMs(0)
      setVideoDurationMs(0)
    } else {
      setPlaying(false)
    }
  }, [safeIdx, approvedShots.length])

  // 演示模式走定时器推进;真实视频由 <video onEnded/onTimeUpdate> 精确驱动
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!playing || !current || hasRealVideo) return
    const targetMs = current.duration * 1000
    timerRef.current = setInterval(() => {
      setShotMs((ms) => {
        if (ms + 200 >= targetMs) {
          advanceNext()
          return 0
        }
        return ms + 200
      })
    }, 200)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [playing, current, hasRealVideo, advanceNext])

  if (project.shots.length === 0) {
    return <EmptyHint text="还没有内容可播。先去改编剧本、拍摄镜头。" />
  }

  const totalApproved = project.shots.filter((s) => s.status === 'approved').length
  const effectiveDurationMs = hasRealVideo && videoDurationMs > 0
    ? videoDurationMs
    : (current?.duration ?? 6) * 1000

  const handleExportEpisode = async () => {
    if (!activeEp || realVideoUrls.length === 0 || exporting) return
    setExporting(true)
    setExportInfo(null)
    const r = await exportEpisodeVideos(`${project.title}-${activeEp.title}`, realVideoUrls)
    setExporting(false)
    if (!r.ok) {
      setExportInfo({ msg: r.detail, error: true })
      return
    }
    setExportInfo({
      url: r.videoUrl,
      filename: r.filename,
      msg: `已合成 ${r.clipCount} 段成片(${r.engine}),点击右侧保存`,
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-bold">放映厅</h2>
          <p className="mt-1 text-sm text-white/50">
            已通过 {totalApproved} 个镜头。只播放已通过的,支持把本集真实视频一键拼接导出为完整 MP4。
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            className="bg-emerald-600 hover:bg-emerald-500"
            disabled={realVideoUrls.length === 0 || exporting}
            onClick={() => void handleExportEpisode()}
            title={realVideoUrls.length === 0 ? '需先在真实模式下生成并「通过」视频镜头' : '拼接本集全部已通过镜头为整集 MP4'}
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {exporting ? '正在拼接 MP4…' : `导出整集 MP4 (${realVideoUrls.length}镜)`}
          </Button>
          <Button
            variant="outline"
            className="border-white/15 text-white/70"
            onClick={() => setStep('storyboard')}
          >
            <LayoutGrid className="mr-1 h-4 w-4" /> 回分镜板继续改
          </Button>
        </div>
      </div>

      {exportInfo && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-2.5 text-xs ${
            exportInfo.error ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-200'
          }`}
        >
          <span>{exportInfo.msg}</span>
          {exportInfo.url && (
            <a
              href={exportInfo.url}
              download={exportInfo.filename}
              className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500"
            >
              下载 {exportInfo.filename}
            </a>
          )}
        </div>
      )}

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
              onClick={() => selectEpisode(ep.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                activeEp?.id === ep.id ? 'bg-violet-600' : 'bg-white/5 text-white/60 hover:bg-white/10'
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
              key={currentVersion.id}
              seed={currentVersion.seed}
              style={style}
              subtitle={current.dialogue}
              label={`镜头 ${current.index}/${approvedShots.length}`}
              playing={playing}
              className="rounded-none"
              videoUrl={currentVersion.videoUrl}
              withAudio={hasRealVideo}
              loopVideo={false}
              onVideoEnded={advanceNext}
              onVideoTimeUpdate={(cur, dur) => {
                setShotMs(cur)
                setVideoDurationMs(dur)
              }}
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
                  disabled={safeIdx === 0}
                  onClick={() => {
                    setIdx(Math.max(0, safeIdx - 1))
                    setShotMs(0)
                    setVideoDurationMs(0)
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
                  disabled={safeIdx >= approvedShots.length - 1}
                  onClick={() => {
                    setIdx(Math.min(approvedShots.length - 1, safeIdx + 1))
                    setShotMs(0)
                    setVideoDurationMs(0)
                  }}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                  <Progress value={Math.min(100, (shotMs / effectiveDurationMs) * 100)} className="h-1.5" />
                </div>
                <span className="w-24 text-right text-xs text-white/40">
                  {(shotMs / 1000).toFixed(1)}s / {(effectiveDurationMs / 1000).toFixed(1)}s
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
                      setVideoDurationMs(0)
                    }}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      i === safeIdx ? 'bg-violet-600/25 text-white' : 'bg-white/[0.03] text-white/50 hover:bg-white/10'
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

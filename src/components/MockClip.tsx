// 演示模式"成片":由 seed 决定的动态画面,模拟镜头运动 + 字幕
import { useMemo } from 'react'
import { seededRandom } from '@/lib/prompt'
import type { StylePreset } from '@/types'

interface Props {
  seed: number
  style: StylePreset
  subtitle?: string
  label?: string
  portrait?: boolean // 角色立绘模式
  playing?: boolean
  className?: string
  videoUrl?: string // 本地模式:真实视频地址(存在时优先播放真视频)
  imageUrl?: string // 生成的真实图片(存在时优先展示)
}

const GLYPHS = ['山', '月', '剑', '雪', '城', '灯', '舟', '火', '风', '影']

export default function MockClip({ seed, style, subtitle, label, portrait, playing = true, className, videoUrl, imageUrl }: Props) {
  const rnd = useMemo(() => seededRandom(seed), [seed])

  // 真实图片(角色设定图等)优先展示
  if (imageUrl) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg bg-white ${className ?? ''}`}
        style={{ aspectRatio: portrait ? '3/4' : '9/16' }}
      >
        <img src={imageUrl} alt={label ?? '设定图'} className="h-full w-full object-contain" />
        {label && (
          <div className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85 backdrop-blur">
            {label}
          </div>
        )}
      </div>
    )
  }

  // 本地模式拿到真实视频后,直接播放真视频(保留标签与字幕覆盖层)
  if (videoUrl) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg bg-black ${className ?? ''}`}
        style={{ aspectRatio: portrait ? '3/4' : '9/16' }}
      >
        <video
          src={videoUrl}
          className="h-full w-full object-cover"
          autoPlay={playing}
          loop
          muted
          playsInline
          controls={false}
        />
        {label && (
          <div className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85 backdrop-blur">
            {label}
          </div>
        )}
        {subtitle && (
          <div className="absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-1 text-center text-[11px] leading-4 text-white backdrop-blur">
            {subtitle}
          </div>
        )}
      </div>
    )
  }
  const conf = useMemo(() => {
    const glyphs = Array.from({ length: portrait ? 1 : 3 }, () => GLYPHS[Math.floor(rnd() * GLYPHS.length)])
    const positions = glyphs.map(() => ({ x: 15 + rnd() * 60, y: 18 + rnd() * 45, s: 0.9 + rnd() * 1.6 }))
    const pan = rnd() > 0.5 ? 'pan-left' : 'pan-right'
    const hueShift = Math.floor(rnd() * 40 - 20)
    return { glyphs, positions, pan, hueShift }
  }, [rnd, portrait])

  const [c1, c2, c3] = style.palette
  const dur = 6 + (seed % 3)

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-black ${className ?? ''}`}
      style={{ aspectRatio: portrait ? '3/4' : '9/16' }}
    >
      {/* 背景氛围 */}
      <div
        className="absolute inset-[-20%]"
        style={{
          background: `radial-gradient(circle at 30% 25%, ${c1}66, transparent 55%), radial-gradient(circle at 75% 70%, ${c2}88, transparent 60%), linear-gradient(180deg, ${c3}, #000)`,
          filter: `hue-rotate(${conf.hueShift}deg)`,
          animation: playing ? `mockpan ${dur}s ease-in-out infinite alternate` : undefined,
        }}
      />
      {/* 场景字形(模拟画面主体) */}
      {conf.glyphs.map((g, i) => (
        <span
          key={i}
          className="absolute font-serif text-white/25 select-none"
          style={{
            left: `${conf.positions[i].x}%`,
            top: `${conf.positions[i].y}%`,
            fontSize: `${conf.positions[i].s * (portrait ? 3.2 : 2.2)}rem`,
            animation: playing ? `mockfloat ${dur + i}s ease-in-out ${i * 0.6}s infinite alternate` : undefined,
            textShadow: `0 0 30px ${c1}`,
          }}
        >
          {g}
        </span>
      ))}
      {/* 光束 */}
      <div
        className="absolute inset-x-0 top-0 h-1/2 opacity-30"
        style={{ background: `linear-gradient(180deg, ${c1}55, transparent)` }}
      />
      {/* 标签 */}
      {label && (
        <div className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85 backdrop-blur">
          {label}
        </div>
      )}
      {/* 字幕条 */}
      {subtitle && (
        <div className="absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-1 text-center text-[11px] leading-4 text-white backdrop-blur">
          {subtitle}
        </div>
      )}
      <style>{`
        @keyframes mockpan { from { transform: translateX(-4%) scale(1.06); } to { transform: translateX(4%) scale(1.12); } }
        @keyframes mockfloat { from { transform: translateY(0); opacity:.22; } to { transform: translateY(-10px); opacity:.4; } }
      `}</style>
    </div>
  )
}

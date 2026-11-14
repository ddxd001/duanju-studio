// 反馈-改稿-重拍 核心交互组件:版本条 + 反馈输入 + 自动修正说明
import { useState } from 'react'
import type { Version } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { History, RotateCcw, Send, Wand2 } from 'lucide-react'

interface Props {
  versions: Version[]
  currentVersionId: string | null
  busy: boolean
  placeholder?: string
  onSubmit: (feedback: string) => void
  onRollback: (versionId: string) => void
}

export default function FeedbackBox({
  versions,
  currentVersionId,
  busy,
  placeholder = '不满意?直接说:脸变了 / 太暗 / 动作僵硬…',
  onSubmit,
  onRollback,
}: Props) {
  const [text, setText] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const current = versions.find((v) => v.id === currentVersionId)

  return (
    <div className="space-y-2">
      {/* 版本条 */}
      {versions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => v.id !== currentVersionId && onRollback(v.id)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                v.id === currentVersionId
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
              title={v.feedback ? `反馈:${v.feedback}` : '初版'}
            >
              v{v.n}
            </button>
          ))}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="ml-auto text-white/40 hover:text-white/80"
            title="修改记录"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 历史版本详情 */}
      {showHistory && (
        <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md bg-black/40 p-2 text-[11px]">
          {versions.map((v) => (
            <div key={v.id} className="border-b border-white/5 pb-1.5 last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                  v{v.n}
                </Badge>
                <span className="text-white/40">{new Date(v.createdAt).toLocaleTimeString()}</span>
                {v.id !== currentVersionId && (
                  <button
                    onClick={() => onRollback(v.id)}
                    className="ml-auto flex items-center gap-0.5 text-violet-300 hover:text-violet-200"
                  >
                    <RotateCcw className="h-3 w-3" /> 回滚
                  </button>
                )}
              </div>
              {v.feedback && <div className="mt-0.5 text-amber-200/80">反馈:{v.feedback}</div>}
              {v.autoFix.length > 0 && (
                <div className="mt-0.5 flex items-start gap-1 text-emerald-300/80">
                  <Wand2 className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>自动修正:{v.autoFix.join('、')}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 反馈输入 */}
      <div className="flex gap-1.5">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="min-h-[36px] flex-1 resize-none border-white/10 bg-black/40 text-xs text-white placeholder:text-white/30"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault()
              onSubmit(text.trim())
              setText('')
            }
          }}
        />
        <Button
          size="sm"
          disabled={!text.trim() || busy}
          onClick={() => {
            onSubmit(text.trim())
            setText('')
          }}
          className="h-9 bg-violet-600 px-2.5 hover:bg-violet-500"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      {current?.feedback && !showHistory && (
        <div className="truncate text-[10px] text-white/35">最近反馈:{current.feedback}</div>
      )}
    </div>
  )
}

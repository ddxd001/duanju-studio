// ③ 角色工坊:AI 依据小说自动建模 → 用户自然语言多轮改设定 → App 内生成三视图设定图
// 支持任意数量角色:AI 提取 + 手动新增(人物/宠物/灵宠等),可改名、可删除
import { useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { uploadReferenceImage } from '@/lib/engine'
import FeedbackBox from '@/components/FeedbackBox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Check,
  Brush,
  ArrowRight,
  Loader2,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Wand2,
  Plus,
  Trash2,
  Pencil,
  UserPlus,
  ImagePlus,
} from 'lucide-react'
import type { Character } from '@/types'

const ROLE_OPTIONS = ['主角', '对手/反派', '配角', '伙伴', '宠物', '灵宠/坐骑', '其他']

export default function CharactersPage() {
  const { project, setStep } = useStore()
  const [addOpen, setAddOpen] = useState(false)

  const confirmedCount = project.characters.filter((c) => c.status === 'confirmed').length
  const allConfirmed =
    project.characters.length > 0 && confirmedCount === project.characters.length

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">角色工坊</h2>
          <p className="mt-1 text-sm text-white/50">
            AI 已根据小说原文为每个角色建了模。设定和立绘都能用大白话反复改,确认后全剧锁定这张脸。
            角色数量不限——漏了的人物、宠物、灵兽都可以手动补上。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={`${allConfirmed ? 'border-emerald-500/40 text-emerald-300' : 'border-white/15 text-white/50'}`}
          >
            {confirmedCount}/{project.characters.length} 已确认
          </Badge>
          <Button variant="outline" className="border-violet-500/40 text-violet-300" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> 添加角色
          </Button>
          <Button
            disabled={!allConfirmed}
            className="bg-violet-600 hover:bg-violet-500"
            onClick={() => setStep('storyboard')}
          >
            去分镜板 <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      {project.characters.length === 0 ? (
        <button
          onClick={() => setAddOpen(true)}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 py-16 text-white/40 transition-colors hover:border-violet-500/50 hover:text-violet-300"
        >
          <UserPlus className="h-8 w-8" />
          <span className="text-sm">还没有角色</span>
          <span className="text-xs text-white/30">
            去「小说输入」改编剧本可自动提取人物,也可以直接点这里手动添加(人物、宠物都可以)
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {project.characters.map((c) => (
            <CharacterCard key={c.id} character={c} />
          ))}
        </div>
      )}

      <AddCharacterDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}

/** 手动添加角色(人物/宠物/灵宠均可) */
function AddCharacterDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { addCharacter } = useStore()
  const [name, setName] = useState('')
  const [role, setRole] = useState('配角')
  const [description, setDescription] = useState('')

  const reset = () => {
    setName('')
    setRole('配角')
    setDescription('')
  }

  const submit = () => {
    const n = name.trim()
    if (!n) return
    const d = description.trim() || `${n}的外形设定(待完善,可直接在卡片里用大白话描述)`
    addCharacter({ name: n, role, description: d })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加角色</DialogTitle>
          <DialogDescription className="text-white/40">
            不限数量,人物、宠物、灵兽、坐骑都可以。添加后同样能生成设定图、反复修改。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">名字</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例:小白 / 雪球 / 阿黄 / 林清雪"
              className="border-white/10 bg-black/40 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">类型</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="border-white/10 bg-black/40 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-900 text-white">
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">外形设定(可留空,之后补)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例:一只通体雪白的狐狸,眼尾有一撮红毛,尾巴尖是金色的,脖子上挂着小铃铛"
              className="min-h-[72px] resize-y border-white/10 bg-black/40 text-xs leading-5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-white/15" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!name.trim()} className="bg-violet-600 hover:bg-violet-500" onClick={submit}>
            <Plus className="mr-1 h-4 w-4" /> 创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CharacterCard({ character: c }: { character: Character }) {
  const {
    updateCharacterDesc,
    refineCharacter,
    renderCharacter,
    confirmCharacter,
    rollbackCharacter,
    removeCharacter,
    renameCharacter,
  } = useStore()
  const [designInput, setDesignInput] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [roleDraft, setRoleDraft] = useState('')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const current = c.versions.find((v) => v.id === c.currentVersionId)
  const generating = c.status === 'generating'
  const sheetSrc = current?.imageUrl

  // 导入照片 → 上传为参考图 → 以照片形象为基准生成设定图
  const onPhotoPicked = async (file: File | undefined) => {
    if (!file || generating || uploading) return
    setPhotoError('')
    setUploading(true)
    try {
      const r = await uploadReferenceImage(file)
      if (!r.ok || !r.refId) {
        setPhotoError(r.detail)
        return
      }
      setPhotoPreview(URL.createObjectURL(file))
      renderCharacter(c.id, undefined, r.refId)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submitDesign = () => {
    const t = designInput.trim()
    if (!t || generating) return
    refineCharacter(c.id, t)
    setDesignInput('')
  }

  const startEditName = () => {
    setNameDraft(c.name)
    setRoleDraft(c.role)
    setEditingName(true)
  }

  const saveName = () => {
    const n = nameDraft.trim()
    if (n) renameCharacter(c.id, { name: n, role: roleDraft.trim() || c.role })
    setEditingName(false)
  }

  const onDelete = () => {
    if (generating) return
    if (window.confirm(`确定删除角色「${c.name}」吗?该角色的设定图和修改记录会一并移除。`)) {
      removeCharacter(c.id)
    }
  }

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        c.status === 'confirmed'
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        {editingName ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="h-7 w-24 border-white/15 bg-black/40 text-xs"
              placeholder="名字"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
              }}
            />
            <Input
              value={roleDraft}
              onChange={(e) => setRoleDraft(e.target.value)}
              className="h-7 w-20 border-white/15 bg-black/40 text-xs"
              placeholder="类型"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
              }}
            />
            <Button size="sm" className="h-7 bg-violet-600 px-2 text-xs hover:bg-violet-500" onClick={saveName}>
              确定
            </Button>
          </div>
        ) : (
          <>
            <span className="text-base font-semibold">{c.name}</span>
            <Badge variant="outline" className="border-white/15 text-[10px] text-white/50">
              {c.role}
            </Badge>
            <button
              onClick={startEditName}
              className="text-white/25 transition-colors hover:text-violet-300"
              title="修改名字/类型"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </>
        )}
        {c.status === 'confirmed' && (
          <Badge className="ml-auto bg-emerald-600/80 text-[10px]">
            <Check className="mr-0.5 h-3 w-3" /> 已确认
          </Badge>
        )}
        {!editingName && (
          <button
            onClick={onDelete}
            disabled={generating}
            className={`${c.status === 'confirmed' ? '' : 'ml-auto'} text-white/25 transition-colors hover:text-red-400 disabled:opacity-30`}
            title="删除角色"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 设定图(App 内现场生成,唯一视图;支持导入照片做形象参考) */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onPhotoPicked(e.target.files?.[0])}
      />
      <div className="mb-3">
        {generating ? (
          <div className="flex h-40 items-center justify-center gap-3 rounded-lg bg-black/50 text-xs text-white/50">
            {photoPreview && (
              <img src={photoPreview} alt="参考照片" className="h-28 w-28 rounded-lg object-cover opacity-80" />
            )}
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
              {photoPreview ? '正在按照片形象生成设定图…' : '正在生成设定图,约需 1-2 分钟…'}
            </div>
          </div>
        ) : sheetSrc ? (
          <div className="overflow-hidden rounded-lg bg-white">
            <img src={sheetSrc} alt={`${c.name} 三视图设定`} className="w-full object-contain" />
            <div className="flex items-center justify-between bg-black/60 px-2 py-0.5 text-[9px] text-white/50">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-white/60 hover:text-violet-300"
              >
                <ImagePlus className="h-3 w-3" /> 导入照片重画
              </button>
              <span>v{current?.n} · App 内生成</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => renderCharacter(c.id)}
              className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-violet-500/50 hover:text-violet-300"
            >
              <Brush className="h-6 w-6" />
              <span className="text-xs">生成三视图设定图</span>
              <span className="px-2 text-center text-[10px] text-white/25">按设定现场生成</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-violet-500/50 hover:text-violet-300 disabled:opacity-40"
            >
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
              <span className="text-xs">导入照片生成</span>
              <span className="px-2 text-center text-[10px] text-white/25">以照片里的形象为基准</span>
            </button>
          </div>
        )}
        {/* 生成失败 */}
        {(c.renderError || photoError) && !generating && (
          <div className="mt-2 rounded bg-red-500/10 p-2 text-[11px] leading-4 text-red-300">
            生成失败:{photoError || c.renderError}
            <button className="ml-1 underline hover:text-red-200" onClick={() => renderCharacter(c.id)}>
              重试
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {/* 设定层 */}
        <div className="min-w-0 flex-1 space-y-2">
          {c.evidence && (
            <div className="rounded-lg bg-black/30 p-2">
              <button
                onClick={() => setShowEvidence((v) => !v)}
                className="flex w-full items-center gap-1 text-[10px] text-white/40 hover:text-white/70"
              >
                <BookMarked className="h-3 w-3" /> AI 建模依据(小说原文)
                {showEvidence ? (
                  <ChevronUp className="ml-auto h-3 w-3" />
                ) : (
                  <ChevronDown className="ml-auto h-3 w-3" />
                )}
              </button>
              {showEvidence && (
                <p className="mt-1.5 text-[10px] leading-4 text-white/45">{c.evidence}…</p>
              )}
            </div>
          )}

          <Textarea
            value={c.description}
            onChange={(e) => updateCharacterDesc(c.id, e.target.value)}
            className="min-h-[64px] resize-y border-white/10 bg-black/30 text-xs leading-5"
            placeholder="角色外形设定"
          />

          {/* 自然语言改设定 */}
          <div className="flex gap-1.5">
            <Input
              value={designInput}
              onChange={(e) => setDesignInput(e.target.value)}
              placeholder="改设定:加上一把折扇 / 去掉披风 / 黑发换成白发"
              className="h-8 border-white/10 bg-black/40 text-xs placeholder:text-white/25"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDesign()
              }}
            />
            <Button
              size="sm"
              disabled={!designInput.trim() || generating}
              onClick={submitDesign}
              className="h-8 shrink-0 bg-violet-600 px-2.5 hover:bg-violet-500"
              title="应用设定修改"
            >
              <Wand2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* 设定修改记录 */}
          {c.designLog.length > 0 && (
            <div>
              <button
                onClick={() => setShowLog((v) => !v)}
                className="text-[10px] text-white/35 hover:text-white/60"
              >
                设定修改记录({c.designLog.length})
              </button>
              {showLog && (
                <div className="mt-1 max-h-24 space-y-1 overflow-y-auto rounded bg-black/40 p-2">
                  {c.designLog.map((log, i) => (
                    <div key={i} className="text-[10px] leading-4">
                      <span className="text-amber-200/70">「{log.instruction}」</span>
                      <span className="text-emerald-300/70"> → {log.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 形象层操作 */}
      <div className="mt-3 space-y-2">
        {c.status === 'review' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500"
              onClick={() => confirmCharacter(c.id)}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> 确认形象
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/15"
              onClick={() => renderCharacter(c.id)}
            >
              重画
            </Button>
          </div>
        )}
        {c.status === 'confirmed' && (
          <p className="text-[10px] text-white/35">
            已锁定。想改形象?直接在上方改设定或下方反馈,会重新生成并需再次确认。
          </p>
        )}
        {c.versions.length > 0 && (
          <FeedbackBox
            versions={c.versions}
            currentVersionId={c.currentVersionId}
            busy={generating}
            placeholder="立绘不满意?例:脸太老 / 发型不对 / 表情再冷一点"
            onSubmit={(fb) => renderCharacter(c.id, fb)}
            onRollback={(vid) => rollbackCharacter(c.id, vid)}
          />
        )}
      </div>
    </div>
  )
}

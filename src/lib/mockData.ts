// ============ 演示模式:小说 → 剧本/角色/分镜 的本地启发式改编 ============
import type { Character, Episode, Shot } from '@/types'
import { uid } from './prompt'

/** 从小说文本里高频提取疑似人名(名字 + 言语/动作动词) */
export function extractCharacters(text: string): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  const add = (name: string) => {
    if (/^(自己|他们|我们|大家|众人|这时|然后|只见|只听|忽然|此时|同时|良久|门外|院中|窗|烛火|月光)$/.test(name)) return
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  // 模式一:名字 + 言语动词(沈昭说道)
  const speech = /([一-龥]{2,3})(?:说道|答道|叹道|笑道|喊道|喝道|心想|问道|说|道|问)/g
  let m: RegExpExecArray | null
  while ((m = speech.exec(text)) !== null) add(m[1])
  // 模式二:名字 + 动作动词(沈昭转身、林肃拔刀、苏挽抬起头)
  const action =
    /([一-龥]{2,3})(?:站在|望着|转身|提剑|抬手|抬起|拔刀|走近|疾步|奔|走|站起|坐下|点头|摇头|皱眉|后退|握着|拦住|解开|跪下|抬头|闭|睁)/g
  while ((m = action.exec(text)) !== null) add(m[1])
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

const ROLE_NAMES = ['主角', '对手', '配角', '配角', '配角', '配角']
const APPEARANCES = [
  '眉目清俊,眼神锐利,一身剪裁利落的深色长衣',
  '气场冷峻,轮廓分明,举手投足带着压迫感',
  '面容温和,笑意浅浅,衣着素雅',
  '身形高挑,长发束起,行动干练',
  '气质沉稳,声线低沉,常着素色衣衫',
  '灵动活泼,眼神狡黠,衣饰明快',
]

/** 从小说语境为角色自动建模:提取该角色出场的句子,推断性别/气质/服饰/器物 */
export function buildCharacterProfile(
  name: string,
  text: string,
  allNames: string[] = [name],
): { description: string; evidence: string } {
  // 出场语境:包含该名字的句子
  const sentences = text
    .replace(/\r/g, '')
    .split(/(?<=[。!?;!?\n])/g)
    .map((s) => s.trim())
    .filter((s) => s.includes(name))
  const evidence = sentences.slice(0, 3).join('').slice(0, 120)
  const ctx = sentences.join('')
  // 去掉台词(引号内容),避免把角色说的话当成他自己的特征
  const narration = ctx.replace(/[「""][^」""]*[」""]/g, '')

  const traits: string[] = []

  // 性别推断:主语继承法 —— 逐句扫描,句中无新名字时代词归最近的角色。
  // 先剔除台词,避免别人口中提到该角色时抢走主语。
  const cleanText = text.replace(/[「""][^」""]*[」""]/g, '')
  let subject = ''
  let femaleHits = 0
  let maleHits = 0
  for (const s of cleanText.split(/(?<=[。!?;!?\n])/g)) {
    const named = allNames.find((n) => s.includes(n))
    if (named) subject = named
    if (subject !== name) continue
    femaleHits += (s.match(/她/g) ?? []).length
    maleHits += (s.match(/他/g) ?? []).length
  }
  traits.push(femaleHits > maleHits ? '青年女性' : '青年男性')

  // 身份/气质关键词(命中原文才采用)
  const TRAIT_WORDS: [RegExp, string][] = [
    [/将军|元帅|统帅/, '将军身份'],
    [/甲胄|铠甲|披甲/, '身披甲胄'],
    [/剑|刀/, '随身兵器'],
    [/披风|斗篷/, '外罩披风'],
    [/长袍|长衣/, '身着长衣'],
    [/寒|冷|冰/, '气质冷峻'],
    [/温柔|温和|浅浅/, '气质温和'],
    [/狡黠|灵动|活泼/, '神情灵动'],
    [/沉稳|威严|压迫/, '气场沉稳威严'],
    [/苍白|憔悴|泪/, '面容带几分憔悴'],
    [/笑/, '常带笑意'],
  ]
  const seen = new Set<string>()
  for (const [re, label] of TRAIT_WORDS) {
    if (re.test(narration) && !seen.has(label)) {
      traits.push(label)
      seen.add(label)
    }
    if (traits.length >= 6) break
  }

  const description =
    traits.length > 1 ? traits.join(',') : APPEARANCES[name.length % APPEARANCES.length]
  return { description, evidence }
}

/** 设定层的自然语言修改:用户说"加上一把折扇"/"去掉披风"/"换成白发" */
export function refineDescription(
  desc: string,
  instruction: string,
): { newDesc: string; note: string } {
  let m: RegExpMatchArray | null

  if ((m = instruction.match(/(?:去掉|不要|取消|摘下)(?:了)?(.+)/))) {
    const target = m[1].trim().replace(/[。.]$/, '')
    // 别名映射:用户说"短刀",设定里可能写的是"随身兵器"
    const ALIAS: [RegExp, RegExp][] = [
      [/刀|剑|兵器|武器/, /兵器|武器/],
      [/披风|斗篷/, /披风|斗篷/],
      [/发簪|簪子|发饰/, /发簪|发饰/],
      [/甲|铠甲/, /甲胄|铠甲/],
    ]
    const aliases = ALIAS.filter(([a]) => a.test(target)).map(([, b]) => b)
    const hit = (seg: string) =>
      seg.includes(target) || aliases.some((re) => re.test(seg))
    const segs = desc.split(/[,、]/)
    const kept = segs.filter((s) => !hit(s))
    if (kept.length !== segs.length) {
      return { newDesc: kept.join(','), note: `已移除「${target}」相关描述` }
    }
    return { newDesc: desc, note: `设定里没有找到「${target}」,保持原样` }
  }

  if ((m = instruction.match(/(.+?)(?:换成|改成|改为|变为)(.+)/))) {
    const from = m[1].trim()
    const to = m[2].trim().replace(/[。.]$/, '')
    const segs = desc.split(/[,、]/)
    const idx = segs.findIndex((s) => s.includes(from))
    if (idx >= 0) {
      segs[idx] = to
      return { newDesc: segs.join(','), note: `「${from}」已改为「${to}」` }
    }
    return { newDesc: `${desc},${to}`, note: `未找到「${from}」,已追加「${to}」` }
  }

  if ((m = instruction.match(/(?:加上|增加|添加|要有|佩戴|戴上)(?:了|一个|一把|一件|一条)?(.+)/))) {
    const target = m[1].trim().replace(/[。.]$/, '')
    if (desc.includes(target)) return { newDesc: desc, note: `「${target}」已在设定中` }
    return { newDesc: `${desc},${target}`, note: `已加入「${target}」` }
  }

  if (/年轻|少年|少女/.test(instruction)) {
    return { newDesc: desc.replace(/青年|中年|老年/g, '少年感'), note: '年龄感已调小' }
  }
  if (/成熟|老成|中年|年长/.test(instruction)) {
    return { newDesc: desc.replace(/青年|少年/g, '中年'), note: '年龄感已调大' }
  }

  // 兜底:原话附加为设定补充
  return { newDesc: `${desc},${instruction.replace(/[。.]$/, '')}`, note: '已按原话追加到设定' }
}

export function buildCharacters(text: string): Character[] {
  const found = extractCharacters(text)
  const list = found.length > 0 ? found : [{ name: '主角', count: 1 }]
  const allNames = list.map((c) => c.name)
  return list.map((c, i) => {
    const profile = buildCharacterProfile(c.name, text, allNames)
    return {
      id: uid(),
      name: c.name,
      role: ROLE_NAMES[i] ?? '配角',
      description: profile.description,
      evidence: profile.evidence,
      designLog: [],
      status: 'pending',
      versions: [],
      currentVersionId: null,
    }
  })
}

/** 把正文按集数切块,每集再按目标时长切成镜头 */
export function buildScript(
  text: string,
  episodeCount: number,
  episodeLength: number,
): { episodes: Episode[]; shots: Shot[] } {
  // 清洗并按段落/句子切分
  const clean = text.replace(/\r/g, '').trim()
  const paragraphs = clean.split(/\n+/).filter((p) => p.trim().length > 0)
  const units = paragraphs.length >= episodeCount * 3 ? paragraphs : splitSentences(clean)

  const perEpisode = Math.max(1, Math.ceil(units.length / episodeCount))
  const episodes: Episode[] = []
  const shots: Shot[] = []
  const shotSeconds = 6 // 每个镜头约 6 秒(H3 单段 4-15 秒)
  const shotsPerEpisode = Math.max(2, Math.round(episodeLength / shotSeconds))

  for (let e = 0; e < episodeCount; e++) {
    const chunk = units.slice(e * perEpisode, (e + 1) * perEpisode)
    if (chunk.length === 0 && e > 0) break
    const ep: Episode = {
      id: uid(),
      index: e + 1,
      title: `第 ${e + 1} 集`,
      synopsis: summarize(chunk.join('')),
    }
    episodes.push(ep)

    const perShot = Math.max(1, Math.ceil(chunk.length / shotsPerEpisode))
    for (let s = 0; s < shotsPerEpisode; s++) {
      const seg = chunk.slice(s * perShot, (s + 1) * perShot).join('')
      if (!seg) break
      shots.push({
        id: uid(),
        episodeId: ep.id,
        index: s + 1,
        title: summarize(seg, 14),
        scene: guessScene(seg),
        characters: guessCharacters(seg),
        basePrompt: seg.slice(0, 120),
        dialogue: extractDialogue(seg),
        duration: shotSeconds,
        status: 'draft',
        progress: 0,
        versions: [],
        currentVersionId: null,
      })
    }
  }
  return { episodes, shots }
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[。!?;!?])/g).filter((s) => s.trim().length > 0)
}

function summarize(text: string, max = 30): string {
  const t = text.replace(/[「」""\s]/g, '').trim()
  return t.length > max ? t.slice(0, max) + '…' : t || '无内容'
}

function guessScene(seg: string): string {
  const scenes = ['殿内', '街道', '山林', '书房', '客栈', '庭院', '战场', '室内']
  for (const s of scenes) if (seg.includes(s.replace(/[殿街山书客庭战室]/, ''))) return s
  if (/夜|月|烛/.test(seg)) return '夜景'
  if (/雨|雪|风/.test(seg)) return '室外'
  return '主场景'
}

function guessCharacters(seg: string): string[] {
  const found = extractCharacters(seg)
  return found.map((f) => f.name)
}

function extractDialogue(seg: string): string {
  const m = seg.match(/[「""]([^」""]{2,60})[」""]/)
  return m ? m[1] : seg.slice(0, 40)
}

// ============ 画风预设 ============
export const STYLE_PRESETS = [
  {
    id: 'guoman3d',
    name: '国漫 3D',
    desc: '精致三维渲染,国产动画质感',
    keywords: '国漫3D风格,精致三维渲染,柔和体积光,电影级质感',
    palette: ['#7c3aed', '#312e81', '#0f0a1e'] as [string, string, string],
  },
  {
    id: 'riman',
    name: '日漫 2D',
    desc: '赛璐璐上色,新海诚式光影',
    keywords: '日式动画风格,赛璐璐上色,通透光影,细腻背景美术',
    palette: ['#38bdf8', '#1e3a8a', '#0b1220'] as [string, string, string],
  },
  {
    id: 'xieshi',
    name: '写实电影',
    desc: '真人质感,电影调色',
    keywords: '写实电影风格,真人质感,胶片颗粒,电影调色,浅景深',
    palette: ['#d4a373', '#5c3d2e', '#14100c'] as [string, string, string],
  },
  {
    id: 'gufeng',
    name: '古风水墨',
    desc: '留白意境,水墨晕染',
    keywords: '中国水墨画风,留白构图,晕染笔触,古典意境',
    palette: ['#94a3b8', '#334155', '#0b0f14'] as [string, string, string],
  },
  {
    id: 'saibo',
    name: '赛博朋克',
    desc: '霓虹灯影,未来都市',
    keywords: '赛博朋克风格,霓虹灯光,雨夜都市,高对比冷暖色',
    palette: ['#f472b6', '#164e63', '#0a0f1e'] as [string, string, string],
  },
  {
    id: 'tianmei',
    name: '甜宠短剧',
    desc: '柔光美颜,网感竖屏',
    keywords: '短剧网感风格,柔光美颜,明亮通透,竖屏构图',
    palette: ['#fda4af', '#9d174d', '#1a0a12'] as [string, string, string],
  },
]

// ============ 演示用示例小说 ============
export const SAMPLE_NOVEL = `夜色沉沉,青州城头的更鼓声敲过三下。

沈昭站在城墙之上,望着远处连绵的营火,手指紧紧扣住冰冷的城砖。三日前,北狄铁骑压境,城中守军不过三千,而城外,是整整五万敌军。

"将军,城南粮仓起火了!"副将林肃疾步奔来,甲胄上满是烟尘,"是内鬼,有人在井里下了药,守粮仓的兄弟全都倒下了。"

沈昭眼中寒光一闪:"果然来了。"他转身下楼,声音冷得像城头的风,"传令,封城。一只苍蝇也不许放出去。"

与此同时,城南的一座小院里,苏挽正把一封信塞进鸽笼。烛火摇曳,映着她苍白的脸。

"再送一封信出去,沈昭必死无疑。"她低声自语,手指却微微发抖。窗外忽然传来脚步声,她猛地吹灭烛火。

院门被人一脚踹开。沈昭提剑而立,月光落在他的剑锋上,亮得刺眼。

"苏姑娘,三更半夜,是在给谁送信?"沈昭缓缓走近。

苏挽后退一步,袖中的短刀滑入掌心:"将军既然都知道了,还问什么?"

"我要听你亲口说。"沈昭的声音第一次有了裂痕,"城楼之上,我救过你的命。"

院中死寂,只有更漏滴答。良久,苏挽抬起头,眼中含泪:"因为城破之日,我父亲的人头,就挂在北狄可汗的旗杆上。"

林肃拔刀上前:"将军!此女通敌,当斩!"

沈昭抬手拦住他,盯着苏挽看了很久很久。忽然,他解下自己的披风,扔在她脚下。

"明日午时,北狄会收到一封假情报。"沈昭转身走向院门,声音低哑,"你若还恨我,就把真的送出去。城破之后,不必为我收尸。"

门外的月光落了一地。苏挽握着袖中的短刀,泪水终于滚落下来。`

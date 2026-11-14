// ============ 反馈 → 提示词修改引擎 ============
// 用户说一句"不满意:脸变了",这里把自然语言反馈翻译成具体的提示词修正。
// 每一条修正都会记录到版本的 autoFix 里,让用户看得见系统改了什么。

export interface ReviseResult {
  newPrompt: string
  fixes: string[] // 人类可读的修正说明
}

interface Rule {
  match: RegExp
  fix: string
  note: string
}

const RULES: Rule[] = [
  {
    match: /脸|长相|不像|变样|崩了|换脸|五官/,
    fix: '面部特征与角色参考图严格一致,固定五官比例,禁止面部漂移',
    note: '加强角色面部一致性约束',
  },
  {
    match: /发型|头发|发色/,
    fix: '发型发色与角色设定保持一致',
    note: '锁定发型发色',
  },
  {
    match: /服装|衣服|穿搭|造型/,
    fix: '服装与角色设定图完全一致,不得更换',
    note: '锁定服装造型',
  },
  {
    match: /暗|黑|看不清|光线差|阴沉/,
    fix: '画面整体提亮,补充柔和主光源,提高暗部细节',
    note: '提高画面亮度',
  },
  {
    match: /过曝|太亮|刺眼|发白/,
    fix: '降低曝光,压暗高光,保留细节',
    note: '降低曝光',
  },
  {
    match: /动作|僵硬|机械|不自然|抽搐|变形/,
    fix: '动作幅度放缓,运动自然流畅,肢体结构正确,无变形',
    note: '约束动作幅度与肢体结构',
  },
  {
    match: /模糊|不清晰|画质|噪点|低清/,
    fix: '高清画质,细节锐利,主体对焦准确',
    note: '提升画质与对焦',
  },
  {
    match: /镜头|运镜|晃动|抖/,
    fix: '镜头稳定,运镜缓慢平滑',
    note: '稳定运镜',
  },
  {
    match: /场景|背景|环境|地点不对/,
    fix: '场景环境与剧本描述严格一致',
    note: '校正场景环境',
  },
  {
    match: /表情|情绪|哭|笑|愤怒|悲伤/,
    fix: '面部表情生动,情绪表达贴合台词',
    note: '强化表情与情绪',
  },
  {
    match: /年龄|太老|太小|显老|显小/,
    fix: '人物年龄感符合角色设定',
    note: '校正年龄感',
  },
]

/**
 * 根据用户反馈修订提示词。
 * @param basePrompt 当前版本提示词
 * @param feedback 用户自然语言反馈
 * @param autoFixEnabled 是否启用规则自动修正(关闭则只追加原文)
 */
export function revisePrompt(
  basePrompt: string,
  feedback: string,
  autoFixEnabled: boolean,
): ReviseResult {
  const fixes: string[] = []
  const additions: string[] = []

  if (autoFixEnabled) {
    for (const rule of RULES) {
      if (rule.match.test(feedback) && !basePrompt.includes(rule.fix)) {
        additions.push(rule.fix)
        fixes.push(rule.note)
      }
    }
  }

  // 用户原话始终作为附加约束注入,保证"预留可变动空间"
  additions.push(`导演备注:${feedback}`)

  const newPrompt = [basePrompt.replace(/,导演备注:.*$/g, ''), ...additions].join(',')
  return { newPrompt, fixes }
}

/** 用种子生成稳定的伪随机数(演示模式画面由 seed 决定) */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

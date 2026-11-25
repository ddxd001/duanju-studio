// ============ ComfyUI 本地 MiniMax H3 工作流生成器 ============
// 适配本机 ComfyUI-H3 部署(RTX 5080 16GB LowVRAM + SLA 稀疏注意力 + 4步采样):
// - 无角色参考图时: 使用 MiniMaxH3ImageToVideo (T2VA, 视频+原生音频)
// - 有角色参考图时: 自动切换为 MiniMaxH3ReferenceToVideo (Ref2VA),
//   通过 LoadImage 节点注入角色设定图, 并在提示词中自动绑定 <Picture 1>/<Picture 2>... 标签。

export interface H3ModelConfig {
  unet: string
  clip: string
  videoVae: string
  audioVae: string
  steps: number
  refImageSize: 'match' | 'max'
}

export const DEFAULT_H3_MODELS: H3ModelConfig = {
  unet: 'minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_int8_convrot.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  steps: 4,
  refImageSize: 'match',
}

/** 按 MiniMax H3 的 17k+5 帧网格向上对齐(24fps) */
export function alignH3Frames(seconds: number): number {
  const clamped = Math.min(15, Math.max(2, seconds))
  let frames = Math.max(5, Math.round(clamped * 24))
  const rem = frames % 17
  if (rem !== 5) frames += (5 - rem + 17) % 17
  return frames
}

/** 分辨率按 32 像素对齐(H3 VAE 要求) */
export function alignH3Dim(px: number): number {
  return Math.max(64, Math.round(px / 32) * 32)
}

export interface H3ReferenceInput {
  characterName: string
  comfyImageName: string // 已通过 /upload/image 上传到 ComfyUI 的文件名
}

/** 为 Ref2VA 提示词注入 <Picture i> 角色形象绑定说明 */
export function injectPictureTags(prompt: string, refs: H3ReferenceInput[]): string {
  if (refs.length === 0) return prompt
  const mapping = refs
    .map((r, i) => `<Picture ${i + 1}>为角色「${r.characterName}」的外貌与服装参考`)
    .join('，')
  return `角色视觉锁定(${mapping}，严格保持对应人物五官、发型与服饰一致，禁止换脸)。${prompt}`
}

/**
 * 构建可直接提交给 ComfyUI /prompt 的 MiniMax H3 API 工作流对象。
 * 返回值直接作为 `{ prompt: workflow }` 的 `prompt` 字段。
 */
export function buildMiniMaxH3Workflow(opts: {
  prompt: string
  seed: number
  seconds: number
  width: number
  height: number
  models: H3ModelConfig
  refs?: H3ReferenceInput[]
  filenamePrefix?: string
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const refs = (opts.refs ?? []).slice(0, 9)
  const width = alignH3Dim(opts.width)
  const height = alignH3Dim(opts.height)
  const length = alignH3Frames(opts.seconds)
  const steps = Math.max(1, Math.min(50, Math.round(opts.models.steps || 4)))
  const finalPrompt = injectPictureTags(opts.prompt, refs)

  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': {
      class_type: 'PrimitiveStringMultiline',
      inputs: { value: finalPrompt },
    },
    '119': {
      class_type: 'VAELoader',
      inputs: { vae_name: opts.models.videoVae || DEFAULT_H3_MODELS.videoVae },
    },
    '120': {
      class_type: 'VAELoader',
      inputs: { vae_name: opts.models.audioVae || DEFAULT_H3_MODELS.audioVae },
    },
    '127': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: opts.models.unet || DEFAULT_H3_MODELS.unet,
        weight_dtype: 'default',
      },
    },
    '128': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: opts.models.clip || DEFAULT_H3_MODELS.clip,
        type: 'minimax',
        device: 'default',
      },
    },
    '901': {
      class_type: 'MiniMaxChunkFeedForward',
      inputs: {
        model: ['127', 0],
        chunks: 4,
        seq_threshold: 4096,
      },
    },
    '900': {
      class_type: 'H3SLAAttention',
      inputs: {
        model: ['901', 0],
        sparsity_ratio: 0.9,
        block_size: '64',
        min_seq_len: 8192,
        dense_last_steps: 0,
        protect_audio: true,
        enabled: true,
      },
    },
    '142': {
      class_type: 'MiniMaxH3SigmaShift',
      inputs: {
        model: ['900', 0],
        shift_video: 12.0,
        shift_audio: 3.0,
      },
    },
    '129': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: Math.max(0, Math.floor(opts.seed)) },
    },
    '135': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: 'res_multistep' },
    },
    '124': {
      class_type: 'BasicScheduler',
      inputs: {
        model: ['142', 0],
        scheduler: 'simple',
        steps,
        denoise: 1.0,
      },
    },
    '126': {
      class_type: 'BasicGuider',
      inputs: {
        model: ['142', 0],
        conditioning: ['131', 0],
      },
    },
    '125': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['129', 0],
        guider: ['126', 0],
        sampler: ['135', 0],
        sigmas: ['124', 0],
        latent_image: ['131', 1],
      },
    },
    '122': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['125', 0],
        vae: ['119', 0],
      },
    },
    '121': {
      class_type: 'VAEDecodeAudio',
      inputs: {
        samples: ['125', 0],
        vae: ['120', 0],
      },
    },
    '130': {
      class_type: 'CreateVideo',
      inputs: {
        images: ['122', 0],
        audio: ['121', 0],
        fps: 24,
        bit_depth: 8,
      },
    },
    '92': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['130', 0],
        format: 'auto',
        codec: 'auto',
        filename_prefix: opts.filenamePrefix ?? (refs.length > 0 ? 'video/duanju_h3_ref2va' : 'video/duanju_h3_t2va'),
      },
    },
  }

  if (refs.length > 0) {
    const condInputs: Record<string, unknown> = {
      clip: ['128', 0],
      vae: ['119', 0],
      audio_vae: ['120', 0],
      prompt: ['1', 0],
      width,
      height,
      length,
      ref_image_size: opts.models.refImageSize || 'match',
    }
    refs.forEach((ref, idx) => {
      const nodeId = String(910 + idx)
      graph[nodeId] = {
        class_type: 'LoadImage',
        inputs: { image: ref.comfyImageName },
      }
      condInputs[`ref_images.ref_image_${idx}`] = [nodeId, 0]
    })
    graph['131'] = {
      class_type: 'MiniMaxH3ReferenceToVideo',
      inputs: condInputs,
    }
  } else {
    graph['131'] = {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['128', 0],
        vae: ['119', 0],
        prompt: ['1', 0],
        width,
        height,
        length,
      },
    }
  }

  return graph
}

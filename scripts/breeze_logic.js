// scripts/breeze_logic.js
// Breeze TTS 2（本地模型）Provider 核心逻辑：角色配置解析（无旁白兜底）、
// 官方 breeze_infer.api 请求（multipart → 流式 PCM）、PCM 加 WAV 头、
// 缓存身份、本机参考音频资产管理。本文件不得直接操作 DOM。
import {
  stripInlineMarkdown,
  stripWrappingPunctuation,
} from "./utils.js";
import { getBreezeRefAsset } from "./db.js";

export const BREEZE_PROVIDER_ID = "breeze";
export const BREEZE_DEFAULT_API_BASE = "http://127.0.0.1:7860";
export const BREEZE_DEFAULT_CFG_SCALE = 4; // 官方建议值，增强指令遵循
export const BREEZE_DEFAULT_SEED = 42; // 官方端点默认种子，保证同配置输出稳定
export const BREEZE_DEFAULT_TIMEOUT_MS = 180000; // 本地长文本推理较慢，超时放宽
export const BREEZE_REF_MAX_BYTES = 20 * 1024 * 1024; // 本机资产防呆上限

/** 相同 Cache Key 的进行中请求去重（服务端单并发锁，连点会得到 409） */
const pendingBreezeRequests = new Map();

/** 参考音频：允许的 MIME 及其规范化映射 */
const BREEZE_REF_MIME_NORMALIZE = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
};

function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getBreezeApiBase(customBase) {
  return String(customBase || BREEZE_DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Breeze 请求正文派生：仅做最小 Markdown 清理。
 * 🌟 Breeze 原生支持稿内 (叹气)/(sigh)、[轻笑] 等标签（官方 README 示例即如此使用），
 * 不得剥离；与 MiMo 同组清洗语义。
 */
export function buildBreezeApiPayloadText(speakObj) {
  return stripWrappingPunctuation(
    stripInlineMarkdown(String(speakObj?.text ?? "")),
  ).trim();
}

/**
 * 解析当前角色的 Breeze 音色配置。
 * 数据来源：角色卡 extensions.siren_voice_breeze.voices（角色名大小写不敏感）。
 * 🌟 无旁白兜底：未配置（含「旁白」、enabled=false、ref_asset_id 为空）一律返回 null。
 * 配置为克隆时读取本机 IndexedDB 资产，缺失抛出可理解的错误。
 */
export async function getBreezeCharacterConfig(speakChar) {
  const context = SillyTavern.getContext();
  const charId = context?.characterId;
  const voices =
    context?.characters?.[charId]?.data?.extensions?.siren_voice_breeze
      ?.voices || {};

  const wanted = String(speakChar || "").trim();
  const matchedKey = Object.keys(voices).find(
    (k) => k.toLowerCase() === wanted.toLowerCase(),
  );
  const voiceConfig = matchedKey ? voices[matchedKey] : null;

  if (!voiceConfig || voiceConfig.enabled === false) return null;
  const refAssetId = String(voiceConfig.ref_asset_id || "").trim();
  if (!refAssetId) return null;

  const asset = await getBreezeRefAsset(refAssetId);
  if (!asset || !asset.dataUrl) {
    throw new Error("此角色使用的参考音频尚未导入本设备。");
  }
  const revision = String(asset.revision || asset.updatedAt || "0");

  return {
    refAssetId,
    refText: String(voiceConfig.ref_text || ""),
    instruction: String(voiceConfig.instruction || ""),
    dataUrl: asset.dataUrl,
    refFileName: String(asset.name || "ref.wav"),
    voiceKey: `asset:${refAssetId}:${revision}`,
  };
}

/**
 * 合并导演指令（照 MiMo stylePrompt 模式）：
 * 角色指令为基底，单句 mood/detail 附加。朗读正文绝不拼进来。
 */
export function buildBreezeInstruction(speakObj, resolvedVoice) {
  const base = String(resolvedVoice?.instruction ?? "").trim();
  const mood = String(speakObj?.mood || "").trim();
  const detail = String(speakObj?.detail || "").trim();

  return [
    base,
    mood ? `当前情绪：${mood}` : "",
    detail ? `本句演绎要求：${detail}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Breeze 缓存身份：provider + 音色资产 voiceKey（含 revision）
 * + 实际发送文本 + 合并后指令 + cfg_scale/seed（影响输出参数）。
 * 参考音频数据与配置绝不进入 Cache Key。
 */
export async function buildBreezeCacheKey(cacheIdentity) {
  const {
    speakObj,
    resolvedVoice,
    apiPayloadText,
    instruction,
    cfgScale,
    seed,
  } = cacheIdentity || {};
  return JSON.stringify({
    provider: BREEZE_PROVIDER_ID,
    voiceKey: String(resolvedVoice?.voiceKey || ""),
    text: String(apiPayloadText ?? speakObj?.text ?? ""),
    instruction: String(instruction || ""),
    cfgScale: Number(cfgScale ?? BREEZE_DEFAULT_CFG_SCALE),
    seed: Number(seed ?? BREEZE_DEFAULT_SEED),
  });
}

/**
 * 供 tts_logic / events / ambience 共用的"一步式"缓存身份解析。
 * 解析失败（缺映射 / 缺资产）返回 null —— 调用方视为"本次不应命中任何缓存"。
 */
export async function getBreezeCacheKeyForSpeak(speakObj, ttsSettings = {}) {
  try {
    const resolvedVoice = await getBreezeCharacterConfig(speakObj?.char);
    if (!resolvedVoice) return null;
    const apiPayloadText = buildBreezeApiPayloadText(speakObj);
    if (!apiPayloadText) return null;
    const instruction = buildBreezeInstruction(speakObj, resolvedVoice);
    return await buildBreezeCacheKey({
      speakObj,
      resolvedVoice,
      apiPayloadText,
      instruction,
      cfgScale: ttsSettings?.cfg_scale,
      seed: ttsSettings?.seed,
    });
  } catch (err) {
    console.warn(
      "[Siren Voice][Breeze] 缓存身份解析失败，按未缓存处理:",
      err?.message,
    );
    return null;
  }
}

/** 校验并把 MP3/WAV 参考音频转换为未落库的 Breeze 资产对象。 */
export async function fileToBreezeRefAsset(file) {
  if (!file) throw new Error("未选择参考音频文件");

  // 🌟 安卓 WebView 常把 WAV 报成 audio/x-wav / audio/vnd.wave 或留空，
  // 优先信任扩展名（同 Fish/MiMo 经验）。
  const name = String(file?.name || "").toLowerCase();
  let mimeType = null;
  if (name.endsWith(".wav")) mimeType = "audio/wav";
  else if (name.endsWith(".mp3")) mimeType = "audio/mpeg";
  else {
    const mime = String(file?.type || "").toLowerCase().trim();
    mimeType = BREEZE_REF_MIME_NORMALIZE[mime] || null;
  }
  if (!mimeType) throw new Error("仅支持 MP3 或 WAV 参考音频");

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const dataUrl = `data:${mimeType};base64,${base64}`;
  if (dataUrl.length > BREEZE_REF_MAX_BYTES) {
    throw new Error("参考音频超过本机资产允许的 20 MB 限制。");
  }

  const now = Date.now();
  return {
    id: `breeze_${randomId()}`,
    name: String(file.name || "未命名参考音频"),
    mimeType,
    dataUrl,
    byteLength: file.size,
    createdAt: now,
    updatedAt: now,
    revision: `rev_${randomId()}`,
  };
}

/** dataURL → Blob（参考音频注入 multipart 用） */
function dataUrlToBlob(dataUrl) {
  const [meta, base64] = String(dataUrl).split(",");
  const mimeType = (meta.match(/data:([^;]+)/) || [])[1] || "audio/wav";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * 裸 PCM（16bit 小端）封装为 WAV Blob。
 * 采样率来自官方响应头 X-Sample-Rate（缺省 24kHz），声道固定 mono。
 */
export function pcmToWavBlob(pcmBuffer, sampleRate = 24000, channels = 1) {
  const pcm = pcmBuffer instanceof Uint8Array ? pcmBuffer : new Uint8Array(pcmBuffer);
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM 格式
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);

  return new Blob([header, pcm], { type: "audio/wav" });
}

/**
 * 唯一的生产请求入口（测试区域与实际聊天链路共用）。
 * 官方合同：POST /v1/audio/speech（multipart），响应为流式 16bit PCM。
 * 相同 Cache Key 的请求正在生成时直接复用同一 Promise（服务端单并发锁，防 409）。
 */
export async function generateBreezeAudioBlob(
  speakObj,
  resolvedVoice,
  ttsSettings = {},
) {
  if (!resolvedVoice?.dataUrl) {
    throw new Error("此角色使用的参考音频尚未导入本设备。");
  }

  const apiPayloadText = buildBreezeApiPayloadText(speakObj);
  if (!apiPayloadText) throw new Error("Breeze TTS 合成文本为空");

  const instruction = buildBreezeInstruction(speakObj, resolvedVoice);
  const cfgScale = Number(ttsSettings?.cfg_scale ?? BREEZE_DEFAULT_CFG_SCALE);
  const rawSeed = ttsSettings?.seed;
  const seed =
    rawSeed === undefined || rawSeed === null || String(rawSeed).trim() === ""
      ? BREEZE_DEFAULT_SEED
      : Number(rawSeed);

  const cacheKey = await buildBreezeCacheKey({
    speakObj,
    resolvedVoice,
    apiPayloadText,
    instruction,
    cfgScale,
    seed,
  });

  if (pendingBreezeRequests.has(cacheKey)) {
    console.log("[Siren Voice][Breeze] 复用进行中的相同请求，避免重复合成");
    return pendingBreezeRequests.get(cacheKey);
  }

  const requestPromise = performBreezeRequest({
    apiBase: ttsSettings?.api_base,
    timeoutMs: ttsSettings?.request_timeout_ms,
    apiPayloadText,
    instruction,
    cfgScale,
    seed,
    resolvedVoice,
  }).finally(() => {
    pendingBreezeRequests.delete(cacheKey);
  });

  pendingBreezeRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function performBreezeRequest({
  apiBase,
  timeoutMs,
  apiPayloadText,
  instruction,
  cfgScale,
  seed,
  resolvedVoice,
}) {
  const endpoint = `${getBreezeApiBase(apiBase)}/v1/audio/speech`;

  const formData = new FormData();
  formData.append("text", apiPayloadText);
  formData.append("ref_text", String(resolvedVoice.refText || ""));
  if (instruction) formData.append("instruction", instruction);
  formData.append("cfg_scale", String(cfgScale));
  formData.append("seed", String(seed));
  const refBlob = dataUrlToBlob(resolvedVoice.dataUrl);
  formData.append(
    "ref_audio",
    refBlob,
    resolvedVoice.refFileName || "ref.wav",
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Number(timeoutMs) > 0 ? Number(timeoutMs) : BREEZE_DEFAULT_TIMEOUT_MS,
  );

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Breeze TTS 合成超时，请缩短文本或稍后重试");
    }
    throw new Error("无法连接 Breeze TTS 服务，请确认服务已启动（含 CORS 启动器）");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {}
    console.error(
      `[Siren Voice][Breeze] 合成失败: status=${response.status} textLen=${apiPayloadText.length} detail=${detail}`,
    );
    if (response.status === 409) {
      throw new Error("Breeze 服务正在合成中，请稍候再试");
    }
    if (response.status >= 500) {
      throw new Error("Breeze TTS 服务异常，请查看服务端日志");
    }
    throw new Error(`Breeze TTS 请求失败 (HTTP ${response.status})`);
  }

  const pcmBuffer = await response.arrayBuffer();
  const sampleRate = Number(response.headers?.get?.("X-Sample-Rate")) || 24000;
  const blob = pcmToWavBlob(pcmBuffer, sampleRate, 1);
  if (blob.size <= 44) {
    throw new Error("Breeze TTS 返回了空音频");
  }

  console.log(
    `[Siren Voice][Breeze] 合成成功: textLen=${apiPayloadText.length} bytes=${blob.size} sampleRate=${sampleRate}`,
  );
  return blob;
}

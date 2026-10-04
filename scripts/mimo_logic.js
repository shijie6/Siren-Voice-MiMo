// scripts/mimo_logic.js
// MiMo TTS Provider 核心逻辑：固定音色目录、角色配置解析、Style Prompt 组装、
// MiMo Chat Completions 请求、Base64 转 Blob、Clone 文件转 Data URL、缓存身份生成。
// 本文件不得直接操作 DOM。
import {
  stripInlineMarkdown,
  stripWrappingPunctuation,
} from "./utils.js";
import { getMimoCloneAsset } from "./db.js";

export const MIMO_PROVIDER_ID = "mimo";
export const MIMO_MODEL_TTS = "mimo-v2.5-tts";
export const MIMO_MODEL_VOICECLONE = "mimo-v2.5-tts-voiceclone";
export const MIMO_DEFAULT_API_BASE = "https://api.xiaomimimo.com/v1";
export const MIMO_AUDIO_FORMAT = "wav"; // 第一版固定非流式 WAV
export const MIMO_DEFAULT_TIMEOUT_MS = 60000;
export const MIMO_NARRATOR_KEY = "旁白";

/** 官方固定预置音色（本地常量，不调用 API 动态同步） */
export const MIMO_BUILTIN_VOICES = Object.freeze([
  { id: "mimo_default", name: "MiMo 默认", language: "auto", gender: "unknown" },
  { id: "冰糖", name: "冰糖", language: "zh", gender: "female" },
  { id: "茉莉", name: "茉莉", language: "zh", gender: "female" },
  { id: "苏打", name: "苏打", language: "zh", gender: "male" },
  { id: "白桦", name: "白桦", language: "zh", gender: "male" },
  { id: "Mia", name: "Mia", language: "en", gender: "female" },
  { id: "Chloe", name: "Chloe", language: "en", gender: "female" },
  { id: "Milo", name: "Milo", language: "en", gender: "male" },
  { id: "Dean", name: "Dean", language: "en", gender: "male" },
]);

/** 相同 Cache Key 的进行中请求去重（防止快速连点导致重复合成） */
const pendingMimoRequests = new Map();

/** Clone 参考音频：允许的 MIME 及其规范化映射 */
const MIMO_CLONE_MIME_NORMALIZE = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
};

/** 官方限制：编码后的 Base64 Data URL 总长度不能超过 10 MB */
const MIMO_CLONE_MAX_DATA_URL_LENGTH = 10 * 1024 * 1024;

function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isNarratorName(name) {
  return String(name || "").trim().toLowerCase() === MIMO_NARRATOR_KEY;
}

/**
 * MiMo 请求正文派生规则（与 tts_logic.js 的通用清洗保持一致）：
 * 仅做最小 Markdown 清理 + 首尾成对包裹符号剥离；
 * 保留 MiMo 的 () / [] 音频标签，绝不调用 stripParentheticalAsides()。
 */
export function buildMimoApiPayloadText(speakObj) {
  return stripWrappingPunctuation(
    stripInlineMarkdown(String(speakObj?.text ?? "")),
  ).trim();
}

/**
 * 解析当前角色的 MiMo 音色配置。
 * 数据来源：角色卡 extensions.siren_voice_tts_mimo.voices（角色名大小写不敏感）。
 *
 * 返回统一结构：
 * { type, voiceId, cloneId, cloneRevision, dataUrl, stylePrompt, voiceKey, isNarratorFallback }
 *
 * - 未配置该角色：返回 null（旁白除外——旁白未配置时回退全局默认旁白音色和风格）；
 * - 配置为 clone 但本机 IndexedDB 缺资产：抛出可理解的错误；
 * - enabled === false 视为未配置。
 */
export async function getMimoCharacterConfig(speakChar, ttsSettings = {}) {
  const context = SillyTavern.getContext();
  const charId = context?.characterId;
  const voices =
    context?.characters?.[charId]?.data?.extensions?.siren_voice_tts_mimo
      ?.voices || {};

  const wanted = String(speakChar || "").trim();
  const matchedKey = Object.keys(voices).find(
    (k) => k.toLowerCase() === wanted.toLowerCase(),
  );
  const voiceConfig = matchedKey ? voices[matchedKey] : null;

  if (!voiceConfig || voiceConfig.enabled === false) {
    // 旁白是唯一允许使用全局默认音色兜底的特殊名称
    if (isNarratorName(wanted)) {
      const narratorVoiceId =
        String(ttsSettings?.default_narrator_voice_id || "").trim() || "冰糖";
      return {
        type: "builtin",
        voiceId: narratorVoiceId,
        cloneId: null,
        cloneRevision: null,
        dataUrl: null,
        stylePrompt: String(ttsSettings?.default_narrator_style_prompt || ""),
        voiceKey: `builtin:${narratorVoiceId}`,
        isNarratorFallback: true,
      };
    }
    return null;
  }

  if (voiceConfig.type === "clone") {
    const cloneId = String(voiceConfig.clone_id || "").trim();
    if (!cloneId) return null;
    const asset = await getMimoCloneAsset(cloneId);
    if (!asset || !asset.dataUrl) {
      throw new Error("此角色使用的克隆音色尚未导入本设备。");
    }
    const revision = String(asset.revision || asset.updatedAt || "0");
    return {
      type: "clone",
      voiceId: null,
      cloneId,
      cloneRevision: revision,
      dataUrl: asset.dataUrl,
      stylePrompt: String(voiceConfig.style_prompt || ""),
      voiceKey: `clone:${cloneId}:${revision}`,
      isNarratorFallback: false,
    };
  }

  const voiceId = String(voiceConfig.voice_id || "").trim() || "mimo_default";
  return {
    type: "builtin",
    voiceId,
    cloneId: null,
    cloneRevision: null,
    dataUrl: null,
    stylePrompt: String(voiceConfig.style_prompt || ""),
    voiceKey: `builtin:${voiceId}`,
    isNarratorFallback: false,
  };
}

/**
 * 组装 messages[0].content（user 风格提示词）：
 * 角色默认风格 + 单句 mood + 单句 detail。
 * 空字符串不产生多余片段；朗读正文绝不拼进来。
 */
export function buildMimoStylePrompt(
  speakObj,
  voiceConfig,
  fallbackNarratorPrompt = "",
) {
  let basePrompt = String(
    voiceConfig?.style_prompt ?? voiceConfig?.stylePrompt ?? "",
  ).trim();
  if (!basePrompt && isNarratorName(speakObj?.char)) {
    basePrompt = String(fallbackNarratorPrompt || "").trim();
  }

  const mood = String(speakObj?.mood || "").trim();
  const detail = String(speakObj?.detail || "").trim();

  return [
    basePrompt ? `角色/声音设定：\n${basePrompt}` : "",
    mood ? `当前情绪：${mood}` : "",
    detail ? `本句演绎要求：${detail}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * MiMo 缓存身份生成：Provider + model + voiceKey（含 Clone revision）
 * + 实际发送文本 + 合并后的 stylePrompt。
 * 不依赖 DOM、不修改公共 speakObj；API Key 和 Clone Data URL绝不进入 Cache Key。
 */
export async function buildMimoCacheKey(cacheIdentity) {
  const { speakObj, resolvedVoice, model, stylePrompt, apiPayloadText } =
    cacheIdentity || {};
  return JSON.stringify({
    provider: MIMO_PROVIDER_ID,
    model: String(model || ""),
    voiceKey: String(resolvedVoice?.voiceKey || ""),
    text: String(apiPayloadText ?? speakObj?.text ?? ""),
    stylePrompt: String(stylePrompt || ""),
  });
}

/**
 * 供 tts_logic / events / ambience 共用的"一步式"缓存身份解析：
 * 内部完成角色解析 + 正文派生 + 风格组装 + key 生成。
 * 解析失败（缺映射 / 缺 Clone 资产 / 环境异常）时返回 null —— 调用方应视为"本次不应命中任何缓存"，
 * 不得回退到旧的文本匹配语义（避免 Clone 缺失时误报 ready）。
 */
export async function getMimoCacheKeyForSpeak(speakObj, ttsSettings = {}) {
  try {
    const resolvedVoice = await getMimoCharacterConfig(
      speakObj?.char,
      ttsSettings,
    );
    if (!resolvedVoice) return null;

    const model =
      resolvedVoice.type === "clone"
        ? MIMO_MODEL_VOICECLONE
        : MIMO_MODEL_TTS;
    const stylePrompt = buildMimoStylePrompt(
      speakObj,
      resolvedVoice,
      ttsSettings?.default_narrator_style_prompt,
    );
    const apiPayloadText = buildMimoApiPayloadText(speakObj);
    if (!apiPayloadText) return null;

    return await buildMimoCacheKey({
      speakObj,
      resolvedVoice,
      model,
      stylePrompt,
      apiPayloadText,
    });
  } catch (err) {
    console.warn(
      "[Siren Voice][MiMo] 缓存身份解析失败，按未缓存处理:",
      err?.message,
    );
    return null;
  }
}

/**
 * ArrayBuffer 转 Base64（分块，避免大文件调用栈溢出）
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize),
    );
  }
  return btoa(binary);
}

function normalizeMimoCloneMime(file) {
  // 🌟 安卓 WebView/SillyDroid 的文件选择器常把 WAV 报告成 audio/x-wav、
  // audio/vnd.wave 等变体，甚至留空 MIME，因此优先信任扩展名，其次再按 MIME 匹配。
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  const mime = String(file?.type || "")
    .toLowerCase()
    .trim();
  if (MIMO_CLONE_MIME_NORMALIZE[mime]) return MIMO_CLONE_MIME_NORMALIZE[mime];
  return null;
}

/**
 * 校验并把 MP3/WAV 参考音频文件转换为未落库的 Clone 资产对象。
 * 1. 校验 MP3/WAV 类型；2. 读取 ArrayBuffer；3. 转 Base64；4. 规范 MIME；
 * 5. 检查完整 Data URL 长度 <= 10 MB；6. 生成 clone_<uuid>；7. 返回资产对象。
 * 调用方再明确调用 saveMimoCloneAsset() 落库。
 */
export async function fileToMimoCloneAsset(file) {
  if (!file) throw new Error("未选择参考音频文件");

  const mimeType = normalizeMimoCloneMime(file);
  if (!mimeType) throw new Error("仅支持 MP3 或 WAV 参考音频");

  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const dataUrl = `data:${mimeType};base64,${base64}`;
  if (dataUrl.length > MIMO_CLONE_MAX_DATA_URL_LENGTH) {
    throw new Error("参考音频编码后超过 MiMo 允许的 10 MB 限制。");
  }

  const now = Date.now();
  return {
    id: `clone_${randomId()}`,
    name: String(file.name || "未命名参考音频"),
    mimeType,
    dataUrl,
    byteLength: file.size,
    createdAt: now,
    updatedAt: now,
    revision: `rev_${randomId()}`,
  };
}

/**
 * 实际发起 MiMo Chat Completions 请求并解析为 audio/wav Blob。
 * 日志只记录 model / HTTP status / 文本长度 / Blob 字节数；
 * API Key、Authorization、完整请求体、Clone Data URL、音频 Base64 绝不写日志。
 */
async function performMimoRequest({
  apiKey,
  apiBase,
  timeoutMs,
  model,
  stylePrompt,
  apiPayloadText,
  resolvedVoice,
}) {
  const endpoint = `${String(apiBase || MIMO_DEFAULT_API_BASE).replace(/\/+$/, "")}/chat/completions`;

  let voice;
  if (resolvedVoice?.type === "clone") {
    voice = resolvedVoice.dataUrl;
    if (!voice) throw new Error("此角色使用的克隆音色尚未导入本设备。");
  } else {
    voice = resolvedVoice?.voiceId;
    if (!voice) throw new Error("MiMo 音色配置缺失，请重新保存角色映射");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "user",
        content: stylePrompt || "",
      },
      {
        role: "assistant",
        content: apiPayloadText,
      },
    ],
    audio: {
      format: MIMO_AUDIO_FORMAT,
      voice,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Number(timeoutMs) > 0 ? Number(timeoutMs) : MIMO_DEFAULT_TIMEOUT_MS,
  );

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("MiMo 合成超时，请缩短文本或稍后重试");
    }
    throw new Error("无法连接 MiMo 服务，请检查网络或 CORS");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    console.error(
      `[Siren Voice][MiMo] 合成失败: model=${model} status=${response.status} textLen=${apiPayloadText.length}`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error("MiMo 鉴权失败，请检查 API Key 或账号权限");
    }
    if (response.status === 429) {
      throw new Error("MiMo 请求过于频繁，请稍后再试");
    }
    if (response.status >= 500) {
      throw new Error("MiMo 服务暂不可用，请稍后重试");
    }
    throw new Error(`MiMo 请求失败 (HTTP ${response.status})，请检查模型或参数`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("MiMo 未返回有效音频");
  }

  const audioBase64 = result?.choices?.[0]?.message?.audio?.data;
  if (!audioBase64) {
    console.error(
      `[Siren Voice][MiMo] 响应缺少音频: model=${model} status=${response.status}`,
    );
    throw new Error("MiMo 返回中缺少音频数据");
  }

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  if (blob.size === 0) {
    throw new Error("MiMo 返回了空音频");
  }

  console.log(
    `[Siren Voice][MiMo] 合成成功: model=${model} textLen=${apiPayloadText.length} bytes=${blob.size}`,
  );
  return blob;
}

/**
 * 唯一的生产请求入口（测试区域与实际聊天链路共用，不得另写第二套请求）。
 * 相同 Cache Key 的请求正在生成时直接复用同一 Promise，结束后从 Map 移除。
 */
export async function generateMimoAudioBlob(
  speakObj,
  resolvedVoice,
  ttsSettings = {},
) {
  const apiKey = String(ttsSettings?.api_key || "").trim();
  if (!apiKey) throw new Error("请先填写 MiMo API Key 并保存");

  const model =
    resolvedVoice?.type === "clone" ? MIMO_MODEL_VOICECLONE : MIMO_MODEL_TTS;
  const stylePrompt = buildMimoStylePrompt(
    speakObj,
    resolvedVoice,
    ttsSettings?.default_narrator_style_prompt,
  );
  // 防御性再清洗一次（幂等）：保证测试区直接传原始文本时与生产链路派生规则一致
  const apiPayloadText = buildMimoApiPayloadText(speakObj);
  if (!apiPayloadText) throw new Error("MiMo 合成文本为空");

  const cacheKey = await buildMimoCacheKey({
    speakObj,
    resolvedVoice,
    model,
    stylePrompt,
    apiPayloadText,
  });

  if (pendingMimoRequests.has(cacheKey)) {
    console.log("[Siren Voice][MiMo] 复用进行中的相同请求，避免重复合成");
    return pendingMimoRequests.get(cacheKey);
  }

  const requestPromise = performMimoRequest({
    apiKey,
    apiBase: ttsSettings?.api_base,
    timeoutMs: ttsSettings?.request_timeout_ms,
    model,
    stylePrompt,
    apiPayloadText,
    resolvedVoice,
  }).finally(() => {
    pendingMimoRequests.delete(cacheKey);
  });

  pendingMimoRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

// scripts/indextts25_logic.js
// IndexTTS 2.5 Provider：复用 IndexTTS 2 的工厂逻辑（寻路/情绪策略/请求合同），
// 差异点：独立角色卡键与设置键、lang 多语言参数、情绪预设与 2.0 共用、缓存身份。
import { createIndexTtsAdapter } from "./indextts_logic.js";

const adapter = createIndexTtsAdapter({
  providerId: "indextts25",
  characterTtsKey: "siren_voice_tts_v25",
  settingsKey: "indextts25",
  defaultApiBase: "http://127.0.0.1:7880",
  logTag: "IndexTTS2.5",
});

export const fetchIndexTts25Voices = adapter.fetchIndexTtsVoices;
export const resolveIndexTts25VoiceRef = adapter.resolveVoiceRefBySpeakChar;
export const buildIndexTts25Payload = adapter.buildIndexTtsPayload;
export const requestIndexTts25 = adapter.requestIndexTTS;
export const getCharacterTts25Config = adapter.getCharacterTtsConfig;
export const saveCurrentCharacterTts25Config =
  adapter.saveCurrentCharacterTtsConfig;

/**
 * 情绪预设库与 IndexTTS 2 共用（settings.tts.indextts.emotion_presets）：
 * 2.5 的设置里不放预设，请求时合并进来，用户只需在 2.0 面板管理一次。
 */
function getMergedSettings(settings) {
  const context = SillyTavern.getContext();
  const global = context?.extensionSettings?.siren_voice_settings;
  const presets = global?.tts?.indextts?.emotion_presets || [];
  return { ...(settings || {}), emotion_presets: presets };
}

/** lang 为空（auto）时返回 null —— 不发送 lang 字段，兼容旧服务端。
 *  settings 未传时回退全局 tts.indextts25（与工厂 getTtsSettings 行为一致）。 */
function resolveLang(settings) {
  const s = settings || adapter.getTtsSettings();
  const lang = String(s?.lang || "").trim();
  return lang ? lang : null;
}

/** 2.5 请求 payload：工厂基础合同 + lang 多语言参数 */
export function buildIndexTts25RequestPayload(speakObj, voiceRef, settings) {
  const payload = adapter.buildIndexTtsPayload(
    speakObj,
    voiceRef,
    getMergedSettings(settings),
  );
  const lang = resolveLang(settings);
  if (lang) payload.lang = lang;
  return payload;
}

/**
 * 唯一的生产生成入口（与 2.0 的 requestIndexTtsGeneration 同构）。
 */
export async function requestIndexTts25Generation(speakObj, settings) {
  const resolvedVoice = resolveIndexTts25VoiceRef(speakObj.char);
  if (!resolvedVoice.voice_ref)
    throw new Error(`未找到角色 ${speakObj.char} 的音色参考`);

  const payload = buildIndexTts25RequestPayload(
    speakObj,
    resolvedVoice.voice_ref,
    settings,
  );

  console.log(
    `🌊 [Siren Voice][IndexTTS2.5] 🚀 准备发送请求，Payload:`,
    JSON.parse(JSON.stringify(payload)),
  );

  return await adapter.requestIndexTTS(payload);
}

/**
 * 缓存身份：provider + 音色引用 + 原始文本 + mood/detail + lang。
 * 🌟 2.5 必须用 cacheKey 隔离——历史表里 2.0 与 2.5 的记录若靠旧的
 * char/text/mood/detail 匹配会互相命中（音色来自不同服务）。
 * 音色解析失败（连兜底都没有）返回 null，按未命中处理。
 */
export async function getIndexTts25CacheKeyForSpeak(speakObj, settings) {
  try {
    const resolvedVoice = resolveIndexTts25VoiceRef(speakObj?.char);
    if (!resolvedVoice.voice_ref) return null;
    const text = String(speakObj?.text || "");
    if (!text.trim()) return null;
    return JSON.stringify({
      provider: "indextts25",
      voice: resolvedVoice.voice_ref,
      text,
      mood: String(speakObj?.mood || ""),
      detail: String(speakObj?.detail || ""),
      lang: resolveLang(settings) || "",
    });
  } catch (err) {
    console.warn(
      "[Siren Voice][IndexTTS2.5] 缓存身份解析失败，按未缓存处理:",
      err?.message,
    );
    return null;
  }
}

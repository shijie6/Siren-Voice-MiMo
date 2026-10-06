// scripts/fish_logic.js
// Fish Audio Provider 核心逻辑：角色配置解析（无旁白兜底）、文本派生、
// Fish Audio TTS 请求（二进制响应）、缓存身份、模型列表/公开库搜索、克隆上传。
// 本文件不得直接操作 DOM。
import {
  stripInlineMarkdown,
  stripParentheticalAsides,
  stripWrappingPunctuation,
} from "./utils.js";

export const FISH_PROVIDER_ID = "fish";
export const FISH_DEFAULT_API_BASE = "https://api.fish.audio";
export const FISH_TTS_FORMAT = "mp3"; // 第一版固定官方默认 mp3
export const FISH_DEFAULT_TIMEOUT_MS = 60000;

/**
 * 解析 API Base URL：留空使用官方地址，末尾斜杠规范去除。
 * 🌟 Fish Audio 服务端不开放浏览器 CORS（预检 404 / 无 ACAO 头），
 * 直连被浏览器拦截时，可将 base 指向用户自建的反向代理（转发至 api.fish.audio）。
 */
export function getFishApiBase(customBase) {
  return String(customBase || FISH_DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, "");
}

/** 相同 Cache Key 的进行中请求去重（防止快速连点导致重复合成） */
const pendingFishRequests = new Map();

/**
 * Fish 请求正文派生：与 indextts/doubao/gptsovits 同组清洗，并额外剥离圆括号。
 * Fish 没有 MiMo 的 () / [] 音频标签机制，任何括号标签都会被当文字朗读，
 * 因此 [] 【】 由 stripParentheticalAsides 剥离后，() （） 也在本函数内剥除。
 */
export function buildFishApiPayloadText(speakObj) {
  return stripParentheticalAsides(
    stripWrappingPunctuation(stripInlineMarkdown(String(speakObj?.text ?? ""))),
  )
    .replace(/（[^（）]*）/g, "")
    .replace(/\([^()]*\)/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * 解析当前角色的 Fish 音色配置。
 * 数据来源：角色卡 extensions.siren_voice_tts_fish.voices（角色名大小写不敏感）。
 * 🌟 Fish 没有 MiMo 的旁白兜底：未配置（含「旁白」、enabled=false、reference_id 为空）
 * 一律返回 null，由调用方给出「未配置」提示。
 */
export async function getFishCharacterConfig(speakChar) {
  const context = SillyTavern.getContext();
  const charId = context?.characterId;
  const voices =
    context?.characters?.[charId]?.data?.extensions?.siren_voice_tts_fish
      ?.voices || {};

  const wanted = String(speakChar || "").trim();
  const matchedKey = Object.keys(voices).find(
    (k) => k.toLowerCase() === wanted.toLowerCase(),
  );
  const voiceConfig = matchedKey ? voices[matchedKey] : null;

  if (!voiceConfig || voiceConfig.enabled === false) return null;
  const referenceId = String(voiceConfig.reference_id || "").trim();
  if (!referenceId) return null;

  return {
    referenceId,
    title: String(voiceConfig.title || ""),
    voiceKey: `ref:${referenceId}`,
  };
}

/**
 * Fish 缓存身份：provider + referenceId + 实际发送文本。
 * Fish 请求无 model 参数、无 style 概念（mood/detail 不进请求），
 * 缓存身份因此比 MiMo 简单；API Key 绝不进入 Cache Key。
 */
export async function buildFishCacheKey(cacheIdentity) {
  const { resolvedVoice, apiPayloadText } = cacheIdentity || {};
  return JSON.stringify({
    provider: FISH_PROVIDER_ID,
    referenceId: String(resolvedVoice?.referenceId || ""),
    text: String(apiPayloadText ?? ""),
  });
}

/**
 * 供 tts_logic / events / ambience 共用的"一步式"缓存身份解析。
 * 解析失败（缺映射）返回 null —— 调用方应视为"本次不应命中任何缓存"。
 */
export async function getFishCacheKeyForSpeak(speakObj) {
  try {
    const resolvedVoice = await getFishCharacterConfig(speakObj?.char);
    if (!resolvedVoice) return null;
    const apiPayloadText = buildFishApiPayloadText(speakObj);
    if (!apiPayloadText) return null;
    return await buildFishCacheKey({ speakObj, resolvedVoice, apiPayloadText });
  } catch (err) {
    console.warn(
      "[Siren Voice][Fish] 缓存身份解析失败，按未缓存处理:",
      err?.message,
    );
    return null;
  }
}

function fishAuthHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * 拉取音色模型列表。self=true 同步当前账号私有模型；否则按关键词搜索公开音色库。
 * 官方确认参数：GET /model?page_size&page_number&title&self（其余不使用）。
 * 返回 { items: [{id, title, author}], hasMore }
 */
export async function fetchFishModels({
  apiKey,
  self = false,
  title = "",
  pageSize = 20,
  pageNumber = 1,
  apiBase = "",
}) {
  if (!apiKey) throw new Error("请先填写 Fish Audio API Key 并保存");

  // 🌟 字符串拼接而非 new URL()：base 支持相对路径（如 SillyTavern 官方
  // CORS 代理 "/proxy/https://api.fish.audio"），fetch 会相对当前站点解析，
  // 手机/电脑访问地址不同也无需修改配置。
  const params = new URLSearchParams();
  params.set("page_size", String(Math.min(Math.max(pageSize, 1), 100)));
  params.set("page_number", String(Math.max(pageNumber, 1)));
  if (self) params.set("self", "true");
  if (title) params.set("title", title);

  const url = `${getFishApiBase(apiBase)}/model?${params.toString()}`;

  // 🌟 SillyTavern 官方 /proxy CORS 代理转发时不回拼 query（req.params.url 只含
  // 路径部分，实测 self/title/page_size 会全部丢失）。当 base 指向 /proxy/ 时，
  // 把目标 query 的 ? 编码为 %3F，使整条 URL 进入代理路径，由 Express 解码还原；
  // 直连或自建透传代理不受影响，保持字面 ?。
  const requestUrl = url.includes("/proxy/") ? url.replace("?", "%3F") : url;

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: fishAuthHeaders(apiKey),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Fish Audio 鉴权失败，请检查 API Key 或账号权限");
    }
    if (response.status === 429) {
      throw new Error("Fish Audio 请求过于频繁，请稍后再试");
    }
    throw new Error(`Fish Audio 模型列表获取失败 (HTTP ${response.status})`);
  }

  const result = await response.json();
  const items = (result?.items || []).map((m) => ({
    id: String(m?._id || ""),
    title: String(m?.title || ""),
    author: String(m?.author?.nickname || m?.author?.id || ""),
  }));
  return { items, hasMore: !!result?.has_more };
}

/**
 * 上传参考音频创建克隆模型（官方 POST /model，multipart，fast 模式即时可用）。
 * 默认 private 可见性。成功返回 { id }（服务端持久 reference_id）。
 */
export async function uploadFishVoiceModel({ apiKey, title, files, apiBase = "" }) {
  if (!apiKey) throw new Error("请先填写 Fish Audio API Key 并保存");
  if (!String(title || "").trim()) throw new Error("请填写克隆音色名称");
  if (!files || files.length === 0) throw new Error("请选择参考音频文件");

  const formData = new FormData();
  formData.append("type", "tts");
  formData.append("train_mode", "fast");
  formData.append("visibility", "private");
  formData.append("title", title.trim());
  for (const file of files) {
    formData.append("voices", file, file.name || "voice.wav");
  }

  const response = await fetch(`${getFishApiBase(apiBase)}/model`, {
    method: "POST",
    headers: fishAuthHeaders(apiKey), // Content-Type 交给浏览器携带 multipart boundary
    body: formData,
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {}
    console.error(
      `[Siren Voice][Fish] 克隆上传失败: status=${response.status} detail=${detail}`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error("Fish Audio 鉴权失败，请检查 API Key 或账号权限");
    }
    if (response.status === 429) {
      throw new Error("Fish Audio 请求过于频繁，请稍后再试");
    }
    if (response.status >= 500) {
      throw new Error("Fish Audio 服务暂不可用，请稍后重试");
    }
    throw new Error(`克隆上传失败 (HTTP ${response.status})，请检查参考音频`);
  }

  const result = await response.json();
  const id = String(result?._id || "");
  if (!id) throw new Error("Fish Audio 未返回模型 ID");
  console.log(`[Siren Voice][Fish] 克隆模型创建成功: files=${files.length}`);
  return { id };
}

/**
 * 实际发起 Fish Audio TTS 请求并返回音频 Blob。
 * 官方合同：POST /v1/tts（JSON + Bearer），200 返回二进制音频流。
 * 日志只记录 status / 文本长度 / Blob 字节数；API Key 绝不写日志。
 */
async function performFishRequest({ apiKey, text, referenceId, timeoutMs, apiBase = "", ttsModel = "" }) {
  const endpoint = `${getFishApiBase(apiBase)}/v1/tts`;

  // 🌟 model 为官方定义的 HTTP header 参数（可选值：s1/s2-pro/s2.1-pro/
  // s2.1-pro-free/drama-3-preview）；不发送时服务端默认 s2.1-pro（付费档）。
  const headers = {
    "Content-Type": "application/json",
    ...fishAuthHeaders(apiKey),
  };
  if (String(ttsModel || "").trim()) {
    headers.model = String(ttsModel).trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Number(timeoutMs) > 0 ? Number(timeoutMs) : FISH_DEFAULT_TIMEOUT_MS,
  );

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: FISH_TTS_FORMAT,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Fish Audio 合成超时，请缩短文本或稍后重试");
    }
    throw new Error("无法连接 Fish Audio 服务，请检查网络或 CORS");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {}
    console.error(
      `[Siren Voice][Fish] 合成失败: status=${response.status} textLen=${text.length} detail=${detail}`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error("Fish Audio 鉴权失败，请检查 API Key 或账号权限");
    }
    if (response.status === 429) {
      throw new Error("Fish Audio 请求过于频繁，请稍后再试");
    }
    if (response.status >= 500) {
      throw new Error("Fish Audio 服务暂不可用，请稍后重试");
    }
    throw new Error(`Fish Audio 请求失败 (HTTP ${response.status})，请检查音色 ID`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("Fish Audio 返回了空音频");
  }

  console.log(
    `[Siren Voice][Fish] 合成成功: textLen=${text.length} bytes=${blob.size}`,
  );
  return blob;
}

/**
 * 唯一的生产请求入口（测试区域与实际聊天链路共用）。
 * 相同 Cache Key 的请求正在生成时直接复用同一 Promise，结束后从 Map 移除。
 */
export async function generateFishAudioBlob(
  speakObj,
  resolvedVoice,
  ttsSettings = {},
) {
  const apiKey = String(ttsSettings?.api_key || "").trim();
  if (!apiKey) throw new Error("请先填写 Fish Audio API Key 并保存");

  const referenceId = String(resolvedVoice?.referenceId || "").trim();
  if (!referenceId) throw new Error("未配置「角色」的 Fish 音色。");

  const apiPayloadText = buildFishApiPayloadText(speakObj);
  if (!apiPayloadText) throw new Error("Fish Audio 合成文本为空");

  const cacheKey = await buildFishCacheKey({
    speakObj,
    resolvedVoice,
    apiPayloadText,
  });

  if (pendingFishRequests.has(cacheKey)) {
    console.log("[Siren Voice][Fish] 复用进行中的相同请求，避免重复合成");
    return pendingFishRequests.get(cacheKey);
  }

  const requestPromise = performFishRequest({
    apiKey,
    text: apiPayloadText,
    referenceId,
    timeoutMs: ttsSettings?.request_timeout_ms,
    apiBase: ttsSettings?.api_base,
    ttsModel: ttsSettings?.tts_model,
  }).finally(() => {
    pendingFishRequests.delete(cacheKey);
  });

  pendingFishRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

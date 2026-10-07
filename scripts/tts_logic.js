import { requestIndexTtsGeneration } from "./indextts_logic.js";
import {
  getIndexTts25CacheKeyForSpeak,
  requestIndexTts25Generation,
} from "./indextts25_logic.js";
import { generateMinimaxAudioBlob } from "./minimax_logic.js";
import { generateElevenLabsAudioBlob } from "./elevenlabs_logic.js";
import { generateDoubaoProductionAudioBlob } from "./doubao_logic.js";
import { generateGptSovitsAudio } from "./gptsovits_logic.js";
import { generateVoxCpmAudioBlob } from "./voxcpm_logic.js";
import {
  getMimoCharacterConfig,
  getMimoCacheKeyForSpeak,
  buildMimoStylePrompt,
  buildMimoCacheKey,
  generateMimoAudioBlob,
  MIMO_MODEL_TTS,
  MIMO_MODEL_VOICECLONE,
} from "./mimo_logic.js";
import {
  getFishCharacterConfig,
  getFishCacheKeyForSpeak,
  buildFishApiPayloadText,
  buildFishCacheKey,
  generateFishAudioBlob,
} from "./fish_logic.js";
import {
  getBreezeCharacterConfig,
  getBreezeCacheKeyForSpeak,
  buildBreezeInstruction,
  buildBreezeCacheKey,
  generateBreezeAudioBlob,
} from "./breeze_logic.js";
import {
  parseSpeakTags,
  stripParentheticalAsides,
  checkReplyIntegrity,
  getRealVolume,
  stripInlineMarkdown,
  stripWrappingPunctuation,
} from "./utils.js";
import { addTtsRecord } from "./db.js";
import {
  setBusVolume,
  routeAudioToMixer,
  initAudioEngine,
  teardownAudioRoute,
} from "./audio_engine.js";

document.addEventListener("sirenVolumeChanged", (e) => {
  const { channel } = e.detail;
  const volumeValue = getRealVolume(channel);
  setBusVolume(channel, volumeValue);
});
/**
 * 助手函数：从角色卡提取 MiniMax 的专属设置并组合最终请求参数
 */
function getMinimaxCharConfig(charName, ttsSettings) {
  const context = SillyTavern.getContext();
  const charId = context.characterId;
  // 去扩展字段拿当前角色的音色映射表
  const charData =
    context.characters[charId]?.data?.extensions?.siren_voice_tts_minimax
      ?.voices || {};
  const charConfig = charData[charName];

  if (!charConfig || !charConfig.voice_id) {
    if (window.toastr)
      window.toastr.warning(`未配置 [${charName}] 的 MiniMax 音色映射！`);
    return null;
  }

  // 将全局的 API Key、模型，和角色独有的音色参数合并
  return {
    region: ttsSettings.region || "cn", // 👈 关键修复：把 region 透传给底层逻辑！
    api_key: ttsSettings.api_key,
    model: ttsSettings.model,
    text_norm: ttsSettings.text_norm,
    ...charConfig,
  };
}

function getElevenLabsCharConfig(charName, ttsSettings) {
  const context = SillyTavern.getContext();
  const charId = context.characterId;
  const charData =
    context.characters[charId]?.data?.extensions?.siren_voice_tts_elevenlabs
      ?.voices || {};
  const charConfig = charData[charName];

  if (!charConfig || !charConfig.voice_id) {
    if (window.toastr)
      window.toastr.warning(`未配置 [${charName}] 的 ElevenLabs 音色映射！`);
    return null;
  }

  return {
    region: ttsSettings.region || "global",
    api_key: ttsSettings.api_key,
    model: ttsSettings.model,
    text_norm: ttsSettings.text_norm,
    ...charConfig,
  };
}

function getDoubaoCharConfig(charName, ttsSettings) {
  const context = SillyTavern.getContext();
  const charId = context.characterId;
  // 去扩展字段拿当前角色的音色映射表
  const charData =
    context.characters[charId]?.data?.extensions?.siren_voice_tts_doubao
      ?.voices || {};
  const charConfig = charData[charName];

  // 🌟 修复 1：检查的字段从 voice_id 改为 speaker
  if (!charConfig || !charConfig.speaker) {
    if (window.toastr)
      window.toastr.warning(`未配置 [${charName}] 的豆包音色映射！`);
    return null;
  }

  return {
    app_id: ttsSettings.appId || ttsSettings.app_id,
    access_key: ttsSettings.accessKey || ttsSettings.access_key,
    // 🌟 修复 2：优先使用角色卡里保存的专属模型（支持合成与复刻混用）
    model: charConfig.model || ttsSettings.model,
    // 🌟 修复 3：将 speaker 赋值给 voice_id 供底层请求使用
    voice_id: charConfig.speaker,
  };
}

/**
 * 统一的 TTS 路由分发器 (用于单个语音条的点击/重生成)
 */
export async function dispatchTtsGeneration(
  speakObj,
  floorId,
  provider,
  ttsSettings,
  forceRegen = false,
) {
  try {
    // 🌟 核心修改：把 forceRegen 直接传给底层的 fetchTtsBlobProvider
    // 底层函数自带了 if (!forceRegen && currentChatId) 的判断，会自动绕过缓存！
    const blob = await fetchTtsBlobProvider(
      speakObj,
      floorId,
      provider,
      ttsSettings,
      forceRegen,
    );

    if (blob) {
      // 生成成功后，推入播放队列
      enqueueTTSBlob(blob, speakObj);
    }
  } catch (error) {
    console.error(`[Siren Voice][Router] ❌ ${provider} 分发失败:`, error);
  }
}

let currentTtsAudio = null;
let currentTtsObjectUrl = null;
let audioQueue = []; // 播放队列
let isPlaying = false; // 播放状态锁

/**
 * 1. 将新的音频 Blob 加入队列（新增 speakObj 参数以传递 dir）
 */
export async function enqueueTTSBlob(blob, speakObj = null) {
  // 队列里现在存的是对象：{ blob, speakObj }
  audioQueue.push({ blob, speakObj });
  if (!isPlaying) {
    playNextInQueue();
  }
}

/**
 * 2. 播放队列中的下一个音频
 */
async function playNextInQueue() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  // 取出结构化的数据
  const item = audioQueue.shift();
  await playSingleBlob(item.blob, item.speakObj);
}

/**
 * 3. 播放单个音频的核心逻辑（接入空间混音版）
 */
async function playSingleBlob(blob, speakObj = null) {
  cleanupCurrentTTS();

  currentTtsObjectUrl = URL.createObjectURL(blob);
  currentTtsAudio = new Audio(currentTtsObjectUrl);
  currentTtsAudio.volume = 1.0;
  currentTtsAudio.preload = "auto";

  // 🌟 提取标签类型
  const tagType = speakObj?.tag || "speak";

  // 🌟 物理规律覆盖：心声和电话永远贴脸居中，不受标签属性干扰
  const dir =
    tagType === "inner" || tagType === "phone"
      ? "center"
      : speakObj?.dir || speakObj?.attrs?.dir || "center";

  try {
    initAudioEngine();
    // 🌟 新增第四个参数 tagType 传给混音器
    routeAudioToMixer(currentTtsAudio, "tts", dir, tagType);
    console.log(
      `[Siren Voice] TTS 物理路由成功: 通道=tts, 方位=${dir}, 特效=${tagType}`,
    );
  } catch (e) {
    console.warn("[Siren Voice] TTS 空间/特效路由失败，尝试回退原生控制", e);
    currentTtsAudio.volume = getRealVolume("tts") / 100;
  }

  // 稍微给浏览器一点缓冲时间
  await new Promise((resolve) => setTimeout(resolve, 100));

  currentTtsAudio.onended = () => {
    cleanupCurrentTTS();
    playNextInQueue();
  };

  currentTtsAudio.onerror = () => {
    console.error("[Siren Voice][TTS] 单段音频播放失败");
    cleanupCurrentTTS();
    playNextInQueue();
  };

  try {
    await currentTtsAudio.play();
  } catch (err) {
    console.error("[Siren Voice][TTS] 播放异常:", err);
    cleanupCurrentTTS();
    playNextInQueue();
  }
}

/**
 * 立即打断并清空当前所有的 TTS 播放
 */
export function stopCurrentTTS() {
  audioQueue = [];
  isPlaying = false;

  if (currentTtsAudio) {
    try {
      currentTtsAudio.pause();
      currentTtsAudio.currentTime = 0;
    } catch {}
  }
  cleanupCurrentTTS();
}

/**
 * 清理内存泄漏
 */
function cleanupCurrentTTS() {
  if (currentTtsAudio) {
    // 🌟 [修复] 卸载混音台节点链，释放 FX 节点占用的内存
    teardownAudioRoute(currentTtsAudio);
    currentTtsAudio.onended = null;
    currentTtsAudio.onerror = null;
    currentTtsAudio = null;
  }

  if (currentTtsObjectUrl) {
    URL.revokeObjectURL(currentTtsObjectUrl);
    currentTtsObjectUrl = null;
  }
}

/**
 * 专门用于场景预加载/并发拉取的 TTS 后台通道
 */
export async function fetchTtsBlobProvider(
  speakObj,
  floor,
  provider,
  ttsSettings,
  forceRegen = false,
) {
  try {
    const context = SillyTavern.getContext();
    const currentChatId = context?.chatId;
    const { findExactTtsRecord } = await import("./db.js");

    // 1. 查找缓存时，必须使用带有语气词和Markdown的原始 speakObj.text，保证 Cache Hit
    if (!forceRegen && currentChatId) {
      if (
        provider === "mimo" ||
        provider === "fish" ||
        provider === "breeze" ||
        provider === "indextts25"
      ) {
        // 🌟 [MiMo/Fish/Breeze/IdxTTS2.5] 缓存身份必须区分 Provider/音色/实际发送文本，
        // 不能走旧的 char/text/mood/detail 文本匹配（会串音）。
        // 身份解析失败（缺映射等）时 key 为 null，视为未命中，
        // 转入生成路径给出明确的用户提示。
        let providerKey = null;
        if (provider === "mimo") {
          providerKey = await getMimoCacheKeyForSpeak(speakObj, ttsSettings);
        } else if (provider === "fish") {
          providerKey = await getFishCacheKeyForSpeak(speakObj);
        } else if (provider === "breeze") {
          providerKey = await getBreezeCacheKeyForSpeak(speakObj, ttsSettings);
        } else {
          providerKey = await getIndexTts25CacheKeyForSpeak(
            speakObj,
            ttsSettings,
          );
        }
        if (providerKey) {
          const cachedRecord = await findExactTtsRecord(
            currentChatId,
            floor,
            speakObj.char,
            speakObj.text,
            speakObj.mood || "",
            speakObj.detail || "",
            providerKey,
          );
          if (cachedRecord && cachedRecord.audioBlob) {
            return cachedRecord.audioBlob;
          }
        }
      } else {
        const cachedRecord = await findExactTtsRecord(
          currentChatId,
          floor,
          speakObj.char,
          speakObj.text,
          speakObj.mood || "",
          speakObj.detail || "",
        );
        if (cachedRecord && cachedRecord.audioBlob) {
          return cachedRecord.audioBlob;
        }
      }
    }

    // ==========================================
    // 💡 核心清洗区 开始
    // ==========================================
    let apiPayloadText = speakObj.text;

    // 第一步：全局剔除 Markdown 符号（覆盖所有四个引擎）
    apiPayloadText = stripInlineMarkdown(apiPayloadText);
    apiPayloadText = stripWrappingPunctuation(apiPayloadText);

    // 第二步：剔除中英文方括号语气词（仅限不支持的三个引擎）
    if (
      provider === "indextts" ||
      provider === "indextts25" ||
      provider === "doubao" ||
      provider === "gptsovits"
    ) {
      apiPayloadText = stripParentheticalAsides(apiPayloadText);
    }
    // ==========================================
    // 💡 核心清洗区 结束
    // ==========================================

    // 3. 👉 🚨 核心防崩溃补丁：如果去完括号和Markdown什么都不剩了，直接跳过！
    if (!apiPayloadText.trim()) {
      console.log(
        `[Siren Voice][预加载] ⚠️ 文本清洗后为空，跳过 TTS。原文本: ${speakObj.text}`,
      );
      return null;
    }

    let blob = null;
    let providerCacheKey = null; // 🌟 [MiMo/Fish] 缓存身份，写入历史时必须与查询使用同一个 key
    switch (provider) {
      case "indextts":
        // ✅ 此时传入的 apiPayloadText：无 Markdown，无 语气词
        blob = await requestIndexTtsGeneration(
          { ...speakObj, text: apiPayloadText },
          ttsSettings,
        );
        break;

      case "indextts25": {
        // 🌟 [IdxTTS2.5] 与 2.0 同款 API 合同（速度快），走 cacheKey 隔离
        // （历史表里 2.0/2.5 记录靠旧匹配会互相命中）。
        providerCacheKey = await getIndexTts25CacheKeyForSpeak(
          speakObj,
          ttsSettings,
        );
        try {
          blob = await requestIndexTts25Generation(
            { ...speakObj, text: apiPayloadText },
            ttsSettings,
          );
        } catch (err) {
          console.error(`[Siren Voice][IndexTTS2.5] 合成失败:`, err);
          if (window.toastr)
            window.toastr.warning(err?.message || "IndexTTS 2.5 合成失败");
          return null;
        }
        break;
      }

      case "minimax":
        const preloadMmConfig = getMinimaxCharConfig(
          speakObj.char,
          ttsSettings,
        );
        if (!preloadMmConfig) return null;

        // ✅ 此时传入的 apiPayloadText：无 Markdown，【保留】语气词。
        // 将中英文方括号替换为 Minimax 支持的小括号
        const preloadMmText = apiPayloadText
          .replace(/\[([^\]]+)\]/g, "($1)")
          .replace(/【([^】]+)】/g, "($1)");

        blob = await generateMinimaxAudioBlob(
          preloadMmText,
          speakObj.mood,
          preloadMmConfig,
        );
        break;

      case "elevenlabs":
        const preloadElConfig = getElevenLabsCharConfig(
          speakObj.char,
          ttsSettings,
        );
        if (!preloadElConfig) return null;

        const preloadElText = apiPayloadText
          .replace(/\[([^\]]+)\]/g, "($1)")
          .replace(/ã€([^ã€‘]+)ã€‘/g, "($1)");

        blob = await generateElevenLabsAudioBlob(
          preloadElText,
          speakObj.mood,
          preloadElConfig,
        );
        break;

      case "doubao":
        const dbConfig = getDoubaoCharConfig(speakObj.char, ttsSettings);
        if (!dbConfig) return null;
        // ✅ 此时传入的 apiPayloadText：无 Markdown，无 语气词
        blob = await generateDoubaoProductionAudioBlob(
          { ...speakObj, text: apiPayloadText },
          dbConfig,
        );
        break;

      case "gptsovits":
        // ✅ 此时传入的 apiPayloadText：无 Markdown，无 语气词
        blob = await generateGptSovitsAudio(
          apiPayloadText,
          speakObj.char,
          speakObj.mood,
        );
        break;

      case "voxcpm":
        const voxSettings = ttsSettings?.voxcpm || ttsSettings;
        const preloadVoxText = apiPayloadText.replace(/【([^】]+)】/g, "[$1]");

        blob = await generateVoxCpmAudioBlob(
          { ...speakObj, text: preloadVoxText }, // 传入转换括号后的文本
          voxSettings,
        );
        break;

      case "mimo": {
        // 🌟 [MiMo] 请求正文使用 speakObj.text 派生后的 apiPayloadText：
        // 保留 () / [] 音频标签，仅做最小 Markdown 清理，不得调用 stripParentheticalAsides()。
        let resolvedVoice = null;
        try {
          resolvedVoice = await getMimoCharacterConfig(
            speakObj.char,
            ttsSettings,
          );
        } catch (err) {
          if (window.toastr)
            window.toastr.warning(err?.message || "MiMo 音色解析失败");
          return null;
        }
        if (!resolvedVoice) {
          if (window.toastr)
            window.toastr.warning(`未配置“${speakObj.char}”的 MiMo 音色。`);
          return null;
        }

        const mimoModel =
          resolvedVoice.type === "clone"
            ? MIMO_MODEL_VOICECLONE
            : MIMO_MODEL_TTS;
        const mimoStylePrompt = buildMimoStylePrompt(
          speakObj,
          resolvedVoice,
          ttsSettings?.default_narrator_style_prompt,
        );
        providerCacheKey = await buildMimoCacheKey({
          speakObj,
          resolvedVoice,
          model: mimoModel,
          stylePrompt: mimoStylePrompt,
          apiPayloadText,
        });

        try {
          blob = await generateMimoAudioBlob(
            { ...speakObj, text: apiPayloadText },
            resolvedVoice,
            ttsSettings,
          );
        } catch (err) {
          console.error(`[Siren Voice][MiMo] 合成失败:`, err);
          if (window.toastr)
            window.toastr.warning(err?.message || "MiMo 合成失败");
          return null;
        }
        break;
      }

      case "fish": {
        // 🌟 [Fish] 无旁白兜底：未配置一律明确提示。
        // 正文派生完全自包含（buildFishApiPayloadText 会剥离所有括号标签，
        // 语义与公共清洗区不同），缓存身份与实际发送文本必须同源。
        const resolvedFishVoice = await getFishCharacterConfig(speakObj.char);
        if (!resolvedFishVoice) {
          if (window.toastr)
            window.toastr.warning(`未配置“${speakObj.char}”的 Fish 音色。`);
          return null;
        }
        const fishPayloadText = buildFishApiPayloadText(speakObj);
        if (!fishPayloadText) {
          console.log(
            `[Siren Voice][预加载] ⚠️ Fish 文本清洗后为空，跳过。原文本: ${speakObj.text}`,
          );
          return null;
        }
        providerCacheKey = await buildFishCacheKey({
          speakObj,
          resolvedVoice: resolvedFishVoice,
          apiPayloadText: fishPayloadText,
        });
        try {
          blob = await generateFishAudioBlob(
            { ...speakObj, text: fishPayloadText },
            resolvedFishVoice,
            ttsSettings,
          );
        } catch (err) {
          console.error(`[Siren Voice][Fish] 合成失败:`, err);
          if (window.toastr)
            window.toastr.warning(err?.message || "Fish Audio 合成失败");
          return null;
        }
        break;
      }

      case "breeze": {
        // 🌟 [Breeze] 本地模型（breeze_infer.api）。无旁白兜底，未配置一律明确提示。
        // 正文保留 ()/[] 稿内标签（官方特性，与公共清洗区前两步一致）；
        // mood/detail 合并进 instruction（导演指令），不进入朗读正文。
        let resolvedBreezeVoice = null;
        try {
          resolvedBreezeVoice = await getBreezeCharacterConfig(speakObj.char);
        } catch (err) {
          if (window.toastr)
            window.toastr.warning(err?.message || "Breeze 音色解析失败");
          return null;
        }
        if (!resolvedBreezeVoice) {
          if (window.toastr)
            window.toastr.warning(`未配置“${speakObj.char}”的 Breeze 音色。`);
          return null;
        }
        const breezeInstruction = buildBreezeInstruction(
          speakObj,
          resolvedBreezeVoice,
        );
        providerCacheKey = await buildBreezeCacheKey({
          speakObj,
          resolvedVoice: resolvedBreezeVoice,
          apiPayloadText,
          instruction: breezeInstruction,
          cfgScale: ttsSettings?.cfg_scale,
          seed: ttsSettings?.seed,
        });
        try {
          blob = await generateBreezeAudioBlob(
            { ...speakObj, text: apiPayloadText },
            resolvedBreezeVoice,
            ttsSettings,
          );
        } catch (err) {
          console.error(`[Siren Voice][Breeze] 合成失败:`, err);
          if (window.toastr)
            window.toastr.warning(err?.message || "Breeze TTS 合成失败");
          return null;
        }
        break;
      }

      default:
        console.warn(`[Siren Voice][预加载] 暂不支持该引擎: ${provider}`);
        return null;
    }

    // 4. 将成功生成的音频存入数据库
    if (blob && currentChatId) {
      addTtsRecord({
        provider,
        char: speakObj.char,
        text: speakObj.text, // 数据库仍保存带有**和[]的完整原文
        mood: speakObj.mood || "",
        detail: speakObj.detail || "",
        floor,
        chatId: currentChatId,
        audioBlob: blob,
        // 🌟 [MiMo/Fish] 缓存身份随记录落库，供 events/ambience 用同一个 key 回读
        ...(providerCacheKey ? { cacheKey: providerCacheKey } : {}),
      });
      console.log(
        `[Siren Voice][预加载] 💾 成功生成音频并写入缓存库，可供语音条复用 (Floor: ${floor})`,
      );
    }

    return blob;
  } catch (err) {
    console.error(`[Siren Voice][预加载] ❌ ${provider} 请求失败:`, err);
    return null;
  }
}

/**
 * 时间轴批量预加载路由
 */
export async function preloadTtsForTimeline(
  timeline,
  floorId,
  provider,
  ttsSettings,
  forceRegen = false,
) {
  // 🌟 修复 2：在函数最开头获取一次 chatId
  const context = SillyTavern.getContext();
  const chatId = context?.chatId;
  try {
    switch (provider) {
      case "indextts":
      case "indextts25":
      case "doubao":
      case "gptsovits":
      case "voxcpm":
        // 串行生成 (按时间轴顺序，一句话生成完，再请求下一句)
        for (let i = 0; i < timeline.length; i++) {
          const node = timeline[i];
          if (node.type === "tts") {
            node.blob = await fetchTtsBlobProvider(
              node.speakObj,
              floorId,
              provider,
              ttsSettings,
              forceRegen,
            );
          }
        }
        break;

      case "minimax":
      case "elevenlabs":
      case "mimo":
      case "fish":
      case "breeze":
        // 🌟 内存优化：串行生成，逐条请求并立即释放，避免多段大体积音频同时驻留内存触发手机 OOM。
        // [MiMo/Fish/Breeze] 进入场景时间轴时继续复用本函数与现有串行生成策略，不另建预加载器。
        for (let i = 0; i < timeline.length; i++) {
          const node = timeline[i];
          if (node.type === "tts") {
            node.blob = await fetchTtsBlobProvider(
              node.speakObj,
              floorId,
              provider,
              ttsSettings,
              forceRegen,
            );
          }
        }
        break;

      default:
        // 兜底逻辑保持串行
        for (let i = 0; i < timeline.length; i++) {
          const node = timeline[i];
          if (node.type === "tts") {
            node.blob = await fetchTtsBlobProvider(
              node.speakObj,
              floorId,
              provider,
              ttsSettings,
              forceRegen,
            );
          }
        }
        break;
    }
  } catch (err) {
    console.error(`[Siren Voice][预加载] 批量处理时间轴时崩溃:`, err);
  }
}

/**
 * 助手函数：从当前角色卡获取 VoxCPM 的专属音色映射
 */
function getVoxCpmCharConfig(charName) {
  const context = SillyTavern.getContext();
  const charId = context.characterId;
  // 从角色卡扩展数据中拿取音色列表
  const charData =
    context.characters[charId]?.data?.extensions?.siren_voice_tts_voxcpm
      ?.voices || {};

  return charData[charName] || null;
}

/**
 * 获取后端已上传的参考音频列表
 */
export async function fetchVoxCpmAudioList(ttsSettings) {
  const apiBase =
    ttsSettings.api_base?.replace(/\/$/, "") || "http://127.0.0.1:8000";
  const apiKey = ttsSettings.api_key || "";

  const headers = {};
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  try {
    const response = await fetch(`${apiBase}/v1/audio/list`, {
      method: "GET",
      headers: headers,
    });

    if (response.ok) {
      const data = await response.json();
      return data.files || []; // 返回有效后缀的文件名数组
    }
    return [];
  } catch (error) {
    console.error("[Siren Voice] 获取 VoxCPM 音频列表失败:", error);
    return [];
  }
}

/**
 * 上传参考音频文件到后端
 */
export async function uploadVoxCpmAudio(file, ttsSettings) {
  const apiBase =
    ttsSettings.api_base?.replace(/\/$/, "") || "http://127.0.0.1:8000";
  const apiKey = ttsSettings.api_key || "";

  // Note: FormData 模式下不要手动设置 Content-Type，浏览器会自动设置并带上 boundary
  const headers = {};
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${apiBase}/v1/audio/upload`, {
      method: "POST",
      headers: headers,
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      return data;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("[Siren Voice] 上传 VoxCPM 音频失败:", error);
    return null;
  }
}

/**
 * 核心请求函数：生成 VoxCPM 语音 Blob
 */
export async function generateVoxCpmAudioBlob(speakObj, ttsSettings) {
  // 1. 获取全局的基础 URL 和 Auth
  const apiBase =
    ttsSettings.api_base?.replace(/\/$/, "") || "http://127.0.0.1:8000";
  const apiKey = ttsSettings.api_key || "";

  // 2. 提取待处理的内容
  const charName = speakObj.char || "";
  const detail = speakObj.detail || "";
  const originalText = speakObj.text || "";

  // 查找是否有匹配的本地/角色专属配置
  const charConfig = getVoxCpmCharConfig(charName);

  let endpoint = "";

  // 初始化带有高级参数的 Payload
  // 映射自 voxcpm.js 中的设置项及 VoxCPM接口.md 文档
  let payload = {
    split_method: ttsSettings.split_method || "punctuation",
    chunk_min_len: ttsSettings.chunk_min_len ?? 15,
    chunk_max_len: ttsSettings.chunk_max_len ?? 60,
    // 原有的其他参数保持不变
    cfg_value: ttsSettings.cfg_value ?? 2.5,
    inference_timesteps: ttsSettings.inference_timesteps ?? 10,
    min_len: ttsSettings.min_len ?? 2,
    max_len: ttsSettings.max_len ?? 4096,
    normalize: ttsSettings.norm_text ?? true,
    denoise: ttsSettings.denoise ?? false,
    retry_badcase: ttsSettings.retry_badcase ?? true,
    retry_badcase_max_times: ttsSettings.retry_badcase_max_times ?? 3,
    retry_badcase_ratio_threshold:
      ttsSettings.retry_badcase_ratio_threshold ?? 6.0,
  };

  let instructionText = "";

  // 3. 核心路由处理逻辑：指令控制拼接
  if (charConfig) {
    // 场景 A & B：匹配到角色列表
    if (charConfig.mode === "clone") {
      // 普通克隆模式：使用参考音频
      endpoint = "/v1/audio/clone";
      payload.reference_wav_path = charConfig.data;

      const tags = [];
      if (charConfig.extra) tags.push(charConfig.extra); // 加入 UI 设置的额外指令
      if (detail) tags.push(detail); // 加入 LLM 输出的 detail 情感

      if (tags.length > 0) {
        instructionText = `(${tags.join(", ")}) `; // 合并输出为: (额外指令, 情感)
      }
    } else {
      // 音色设计模式：使用自然文本设计音色
      endpoint = "/v1/audio/design";

      const tags = [];
      if (charConfig.data) tags.push(charConfig.data); // 自然文本描述 (如: 年轻女性)
      if (detail) tags.push(detail); // 情绪描述

      if (tags.length > 0) {
        instructionText = `(${tags.join(", ")}) `;
      }
    }
  } else {
    // 场景 C：没有预设匹配（自由输出的 NPC），作为设计模式处理
    endpoint = "/v1/audio/design";

    const tags = [];
    if (charName) tags.push(charName); // 拼接 char 作为音色
    if (detail) tags.push(detail); // 拼接 detail 作为情绪

    if (tags.length > 0) {
      instructionText = `(${tags.join(", ")}) `;
    }
  }

  // 4. 组装最终文本送给模型：(指令) 具体语音内容
  payload.text = instructionText + originalText;

  // 5. 构建 Header 并发起请求
  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  console.groupCollapsed(
    `[Siren Voice][VoxCPM] 发起 TTS 请求 -> ${charName || "自定义"}`,
  );
  console.log(`Endpoint: ${apiBase}${endpoint}`);
  console.log(`Headers:`, headers);
  console.log(`Payload (完整参数):`, JSON.parse(JSON.stringify(payload)));
  console.log(`原始文本:`, originalText);
  console.log(`最终发给模型的组合文本:`, payload.text);
  console.groupEnd();

  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VoxCPM HTTP ${response.status}: ${errorText}`);
    }

    // 假设后端直接返回音频流
    const blob = await response.blob();
    return blob;
  } catch (error) {
    console.error(`[Siren Voice][VoxCPM] 请求失败:`, error);
    if (window.toastr) {
      window.toastr.error(`VoxCPM 生成失败，请检查控制台`);
    }
    return null;
  }
}

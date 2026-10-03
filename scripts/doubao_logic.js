// scripts/doubao_logic.js

/**
 * 1. 底层核心请求函数 (Fetch 直连 + 流式 JSON 解析版)
 * 仅负责发送网络请求、解析 Chunked 流，并返回纯净的 MP3 Blob。
 */
async function requestDoubaoTTSBlob(
  appId,
  accessKey,
  model,
  speaker,
  text,
  additionsObj,
) {
  const url = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

  const headers = {
    "Content-Type": "application/json",
    "X-Api-App-Key": appId,
    "X-Api-Access-Key": accessKey,
    "X-Api-Resource-Id": model,
  };

  const uniqueId =
    Date.now().toString() + "_" + Math.random().toString(36).substring(2, 8);

  const payload = {
    user: { uid: "siren_" + uniqueId },
    req_params: {
      text: text,
      speaker: speaker,
      audio_params: {
        format: "mp3",
        sample_rate: 24000,
      },
      additions: JSON.stringify(additionsObj),
    },
  };

  if (model.includes("seed-icl-2.0")) {
    payload.req_params.model = "seed-tts-2.0-expressive";
  } else if (model.includes("seed-icl-1.0")) {
    // 顺手兼容一下 1.0 的高音质版本
    payload.req_params.model = "seed-tts-1.1";
  }

  console.log(
    "%c🌊 [Siren Voice] 发起豆包 TTS 请求",
    "color: #3b82f6; font-weight: bold; font-size: 13px;",
    payload,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let base64AudioData = "";
    let buffer = "";

    // ✨ 核心修复区：完善流处理逻辑 ✨
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      // 如果流结束了，确保 buffer 里最后剩下的内容也能被当作一行处理
      if (done && buffer.trim()) {
        buffer += "\n";
      }

      let lines = buffer.split("\n");
      buffer = lines.pop(); // 只有不完整的最后一行才会被留在 buffer 里

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 兼容某些标准的 SSE 格式 (如果豆包 API 抽风加上了 data: 前缀)
        if (line.startsWith("data:")) {
          line = line.replace(/^data:\s*/, "");
        }

        try {
          const jsonObj = JSON.parse(line);
          if (jsonObj.data) {
            base64AudioData += jsonObj.data;
          }
          if (jsonObj.code && jsonObj.code !== 0 && jsonObj.code !== 20000000) {
            throw new Error(
              `火山引擎返回异常 [${jsonObj.code}]: ${jsonObj.message}`,
            );
          }
        } catch (e) {
          if (e.message.startsWith("火山引擎返回异常")) throw e;
          // 不要静默吞噬错误，在控制台打印出来以便排查
          console.warn(
            "[Siren Voice] 警告：无法解析此行流数据 ->",
            line,
            e.message,
          );
        }
      }

      if (done) break;
    }

    if (!base64AudioData) {
      // 增加更详细的错误提示
      throw new Error(
        `请求成功，但未能从流中提取到任何音频数据！请检查文本是否过短或仅含标点（当前文本：${text.substring(0, 10)}...）`,
      );
    }

    const binaryString = atob(base64AudioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log(
      "%c✅ [Siren Voice] 豆包音频解析成功！",
      "color: #10b981; font-weight: bold;",
    );
    return new Blob([bytes.buffer], { type: "audio/mp3" });
  } catch (error) {
    console.error("❌ [Siren Voice] 豆包 TTS 请求失败:", error);
    throw error;
  }
}

/**
 * 辅助函数：根据模型版本，格式化文本与情绪参数
 */
function buildDoubaoPayloadParams(model, rawText, emotionPrompt) {
  let finalText = rawText;
  const additionsObj = {};

  if (model.includes("seed-tts") && emotionPrompt) {
    // 合成模型逻辑（使用 context_texts）
    additionsObj.context_texts = [emotionPrompt];
  } else if (model.includes("seed-icl-2.0")) {
    // 复刻 2.0 逻辑
    additionsObj.use_tag_parser = true;
    if (emotionPrompt) {
      finalText = `<cot text=${emotionPrompt}>${rawText}</cot>`;
    }
  } else if (model.includes("seed-icl-1.0")) {
    // 复刻 1.0 逻辑：直接无视 emotionPrompt，什么标签都不加，直接返回原始 finalText
    console.log("[Siren Voice] 当前使用复刻1.0模型，已自动丢弃情绪标签");
  }

  return { finalText, additionsObj };
}

/**
 * 2. 测试区域请求参数捕获函数 (供前端设置面板使用)
 * 支持格式: "[更温柔地说话] 实际语音内容"
 * 返回 ObjectURL 供页面上的 Audio 标签直接播放
 */
export async function generateDoubaoTestAudio(params) {
  const { appId, accessKey, model, speaker, text } = params;

  let emotionPrompt = "";
  let cleanText = text;

  // 解析测试区域的自定义情绪前缀，例如: [深吸一口气，语气颤抖]
  const match = text.match(/^\[(.*?)\]\s*(.*)$/);
  if (match) {
    emotionPrompt = match[1].trim();
    cleanText = match[2].trim();
  }

  const { finalText, additionsObj } = buildDoubaoPayloadParams(
    model,
    cleanText,
    emotionPrompt,
  );
  const blob = await requestDoubaoTTSBlob(
    appId,
    accessKey,
    model,
    speaker,
    finalText,
    additionsObj,
  );

  return URL.createObjectURL(blob);
}

/**
 * 3. 实际生产环境请求参数捕获函数 (供 tts_logic.js 调度器使用)
 * 接收标准的 speakObj，自动捕获 detail 作为情绪控制参数，返回 Blob
 */
export async function generateDoubaoProductionAudioBlob(speakObj, config) {
  // 假设 config 中已经包含了全局配置和该角色对应的豆包参数
  const { app_id, access_key, model, voice_id } = config;

  // 直接捕获 ST 正则解析出的 detail 标签
  const emotionPrompt = speakObj.detail || "";
  const rawText = speakObj.text || "";

  const { finalText, additionsObj } = buildDoubaoPayloadParams(
    model,
    rawText,
    emotionPrompt,
  );

  // 直接返回 Blob 供底层的 audioQueue 播放或写入 IndexedDB
  return await requestDoubaoTTSBlob(
    app_id,
    access_key,
    model,
    voice_id,
    finalText,
    additionsObj,
  );
}

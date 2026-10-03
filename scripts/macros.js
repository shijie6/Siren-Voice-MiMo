import { getSirenSettings } from "./settings.js";

// 用来存储 registerMacroLike 返回的对象，便于随时调用 unregister
let macroRefs = {
  voice: null,
  mood: null,
  ambience: null,
  sfx: null,
};

const getBaseName = (name) => {
  if (!name || typeof name !== "string") return "";
  return name.replace(/-\d+$/, "").trim();
};

// 🌟 核心新增：专门用于动态重载 Voice 和 Mood 宏的函数
export function updateTtsListMacros(voiceStr, moodStr) {
  if (
    !window.TavernHelper ||
    typeof window.TavernHelper.registerMacroLike !== "function"
  )
    return;

  // 1. 取消旧的注册 (严格按照 .d.ts 规范)
  if (macroRefs.voice) {
    macroRefs.voice.unregister();
    macroRefs.voice = null;
  }
  if (macroRefs.mood) {
    macroRefs.mood.unregister();
    macroRefs.mood = null;
  }

  // 2. 注入新参数重新注册
  macroRefs.voice = window.TavernHelper.registerMacroLike(
    /\{\{VOICE_LIST\}\}/gi,
    () => (voiceStr ? `[${voiceStr}]` : "[]"),
  );

  macroRefs.mood = window.TavernHelper.registerMacroLike(
    /\{\{MOOD_LIST\}\}/gi,
    () => (moodStr ? `[${moodStr}]` : "[]"),
  );

  console.log(
    `[Siren Voice] 🔄 TTS 宏已重载 -> 音色: [${voiceStr}], 情绪: [${moodStr}]`,
  );
}

// 依然保留初始化入口，处理不随 TTS 渠道变化的 Ambience 和 SFX
export function registerSirenMacros() {
  if (
    !window.TavernHelper ||
    typeof window.TavernHelper.registerMacroLike !== "function"
  ) {
    console.warn("[Siren Voice] ⚠️ TavernHelper 未就绪，跳过宏注册。");
    return;
  }

  // 防御性取消（处理开发者模式热重载的场景）
  if (macroRefs.ambience) macroRefs.ambience.unregister();
  if (macroRefs.sfx) macroRefs.sfx.unregister();

  macroRefs.ambience = window.TavernHelper.registerMacroLike(
    /\{\{AMBIENCE_LIST\}\}/gi,
    () => {
      try {
        const settings = getSirenSettings() || {};
        const ambienceState = settings.ambience || {};
        const ambienceLib =
          ambienceState.libraries && ambienceState.current_list
            ? ambienceState.libraries[ambienceState.current_list]
            : [];

        const uniqueNames = [
          ...new Set(
            (ambienceLib || [])
              .map((item) => getBaseName(item?.name))
              .filter(Boolean),
          ),
        ];
        return uniqueNames.length > 0 ? `[${uniqueNames.join(", ")}]` : "[]";
      } catch (e) {
        return "[]";
      }
    },
  );

  macroRefs.sfx = window.TavernHelper.registerMacroLike(
    /\{\{SFX_LIST\}\}/gi,
    () => {
      try {
        const settings = getSirenSettings() || {};
        const ambienceState = settings.ambience || {};
        const sfxLib =
          ambienceState.sfx_libraries && ambienceState.sfx_current_list
            ? ambienceState.sfx_libraries[ambienceState.sfx_current_list]
            : [];

        const uniqueNames = [
          ...new Set(
            (sfxLib || [])
              .map((item) => getBaseName(item?.name))
              .filter(Boolean),
          ),
        ];
        return uniqueNames.length > 0 ? `[${uniqueNames.join(", ")}]` : "[]";
      } catch (e) {
        return "[]";
      }
    },
  );

  console.log("[Siren Voice] ✅ Ambience 与 SFX 宏初始化完成。");
}

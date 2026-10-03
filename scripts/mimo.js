// scripts/mimo.js
// MiMo TTS Provider 设置界面：API 配置、旁白默认值、角色音色映射、
// Clone 资产管理（本机 IndexedDB）和发音测试。
import {
  getSirenSettings,
  saveSirenSettings,
  saveToCharacterCard,
} from "./settings.js";
import {
  MIMO_BUILTIN_VOICES,
  MIMO_DEFAULT_API_BASE,
  fileToMimoCloneAsset,
  generateMimoAudioBlob,
} from "./mimo_logic.js";
import {
  saveMimoCloneAsset,
  getMimoCloneAsset,
  listMimoCloneAssets,
  deleteMimoCloneAsset,
} from "./db.js";
import { syncTtsWorldbookEntries } from "./utils.js";

// 本机 Clone 资产缓存（进入设置页时加载，保存后刷新）
let mimoCloneAssets = [];
// 测试区当前试听的 Object URL（替换或销毁前必须 revoke）
let mimoTestObjectUrl = null;

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function getMimoHtml() {
  return `
    <div id="siren-mimo-wrapper">
        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <h4 style="color: #06b6d4; font-size: 1.1em; margin: 0;">
                <i class="fa-solid fa-server" style="margin-right: 5px;"></i> MiMo API 配置
            </h4>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">MiMo API Key</div>
                <input type="password" id="siren-mimo-apikey" class="siren-ext-input" style="flex: 1; min-width: 200px;" placeholder="输入 MiMo API Key">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">API Base URL</div>
                <input type="text" id="siren-mimo-apibase" class="siren-ext-input" style="flex: 1; min-width: 200px;" placeholder="${esc(MIMO_DEFAULT_API_BASE)}">
            </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #334155; border-radius: 6px; padding: 15px; margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
            <h4 style="color: #f472b6; font-size: 1.05em; margin: 0;">
                <i class="fa-solid fa-book-open" style="margin-right: 5px;"></i> 默认旁白
            </h4>
            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">默认旁白音色</div>
                <select id="siren-mimo-narrator-voice" class="siren-ext-select" style="flex: 1; min-width: 200px;"></select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color:#cbd5e1; font-size: 0.95em;">默认旁白风格 (style prompt)</label>
                <textarea id="siren-mimo-narrator-style" class="siren-ext-textarea" rows="2" placeholder="例如：温柔、自然、清晰，像有声小说旁白。"></textarea>
                <small style="color:#64748b; font-size: 0.8em;">未单独映射「旁白」角色时，&lt;speak char="旁白"&gt; 将自动使用以上默认音色和风格。</small>
            </div>
        </div>

        <h4 style="color: #a78bfa; font-size: 1.1em; margin-bottom: 10px; margin-top: 20px; border-bottom: 1px solid rgba(168, 85, 247, 0.3); padding-bottom: 5px;">
            <span><i class="fa-solid fa-users-viewfinder" style="margin-right: 5px;"></i> 角色音色映射</span>
        </h4>
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid #334155;">
            <div id="siren-mimo-char-list" style="display: flex; flex-direction: column; gap: 6px;">
            </div>
            <div style="margin-top: 10px; text-align: center;">
                <button id="siren-mimo-char-add" class="siren-ext-btn siren-ext-btn-secondary" style="width: 100%; border: 1px dashed #64748b; color: #94a3b8; background: transparent;">
                    <i class="fa-solid fa-plus"></i> 新增角色音色映射
                </button>
            </div>
            <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 8px; text-align: center;">
                角色名可填写「旁白」；音色类型支持官方预置音色或本机克隆音色。
            </small>
        </div>

        <h4 style="color: #f59e0b; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;">
            <i class="fa-solid fa-microphone-lines" style="margin-right: 5px;"></i> 克隆音色管理（本机）
        </h4>
        <div style="background: rgba(0,0,0,0.2); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <div style="color: #f59e0b; font-size: 0.8em;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                克隆参考音频仅保存在本机 IndexedDB 中；请只上传自己拥有授权的声音样本。
            </div>

            <div id="siren-mimo-clone-list" style="display: flex; flex-direction: column; gap: 8px;"></div>

            <div style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 12px;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="color:#cbd5e1; font-size:0.9em;">新增克隆音色</label>
                    <input type="text" id="siren-mimo-clone-name" class="siren-ext-input" placeholder="克隆音色名称（如：我的女声）">
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <input type="file" id="siren-mimo-clone-file" accept=".mp3,.wav,audio/mpeg,audio/wav" style="display: none;">
                        <button id="siren-mimo-clone-choose" class="siren-ext-btn siren-ext-btn-secondary" style="flex: 1; min-width: 110px;"><i class="fa-solid fa-folder-open"></i> 选择 MP3/WAV</button>
                        <button id="siren-mimo-clone-save" class="siren-ext-btn siren-ext-btn-primary" style="flex: 1; min-width: 110px; background: #f59e0b; border-color: #d97706; color: #fff;"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
                    </div>
                    <div id="siren-mimo-clone-filename" style="font-size: 0.8em; color: #64748b; margin-top: 2px;">未选择文件</div>
                </div>
            </div>
        </div>

        <h4 style="color: #10b981; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;"><i class="fa-solid fa-vial" style="margin-right: 5px;"></i> MiMo 发音测试</h4>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            <select id="siren-mimo-test-voice" class="siren-ext-select" style="width: 100%;"></select>
            <textarea id="siren-mimo-test-text" class="siren-ext-textarea" rows="2" placeholder="输入一句台词测试效果，支持 (温柔) [轻笑] 等音频标签。"></textarea>
            <textarea id="siren-mimo-test-style" class="siren-ext-textarea" rows="2" placeholder="本句 style prompt（可留空），例如：温柔、缓慢，带一点疲惫感。"></textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                <button id="siren-mimo-test-generate" class="siren-ext-btn siren-ext-btn-primary" style="background: #10b981; border-color: #059669; color: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); font-weight: bold;">
                    <i class="fa-solid fa-bolt"></i> 生成测试
                </button>
                <div style="flex: 1; margin-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <audio id="siren-mimo-test-audio" controls style="height: 32px; flex: 1; display: none;"></audio>
                    <a id="siren-mimo-test-download" class="siren-ext-btn siren-ext-btn-secondary" style="display: none; padding: 4px 10px; text-decoration: none; color: #cbd5e1;" download="mimo_test.wav" title="下载音频">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    <span id="siren-mimo-test-status" style="color: #64748b; font-size: 0.85em; white-space: nowrap;">等待生成...</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 20px;">
            <button id="siren-mimo-save-all" class="siren-ext-btn siren-ext-btn-primary" style="width: 100%; padding: 12px 0; justify-content: center; font-size: 1.05em; background: #0284c7; border-color: #0284c7; color: #fff;">
                <i class="fa-solid fa-floppy-disk"></i> 保存全部设置
            </button>
        </div>

        <input type="file" id="siren-mimo-clone-replace-file" accept=".mp3,.wav,audio/mpeg,audio/wav" style="display: none;">
    </div>
    `;
}

// ==========================================
// 角色映射表
// ==========================================

function buildBuiltinVoiceOptions(selectedId) {
  return MIMO_BUILTIN_VOICES.map(
    (v) =>
      `<option value="${esc(v.id)}" ${v.id === selectedId ? "selected" : ""}>${esc(v.name)}</option>`,
  ).join("");
}

function buildCloneVoiceOptions(selectedId) {
  let html = `<option value="">(选择本机克隆音色)</option>`;
  let hasSelected = false;
  mimoCloneAssets.forEach((a) => {
    const selected = a.id === selectedId ? "selected" : "";
    if (selected) hasSelected = true;
    html += `<option value="${esc(a.id)}" ${selected}>${esc(a.name || a.id)}</option>`;
  });
  // 角色卡中存在但本机缺失的 clone_id：保留显示，绝不自动替换
  if (selectedId && !hasSelected) {
    html += `<option value="${esc(selectedId)}" selected>${esc(selectedId)} (本机缺失)</option>`;
  }
  return html;
}

function createMimoCharRow(charName = "", type = "builtin", voiceId = "", cloneId = "", stylePrompt = "") {
  const safeType = type === "clone" ? "clone" : "builtin";
  return `
        <div class="siren-ext-setting-row siren-mimo-char-item" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
            <input type="text" class="siren-ext-input mimo-char-name" placeholder="角色名（可填：旁白）" value="${esc(charName)}" style="flex: 1 1 55%; width: 100%; box-sizing: border-box; height: 32px;">
            <select class="siren-ext-select mimo-char-type" style="flex: 1 1 40%; min-width: 90px; height: 32px;">
                <option value="builtin" ${safeType === "builtin" ? "selected" : ""}>预置音色</option>
                <option value="clone" ${safeType === "clone" ? "selected" : ""}>本机克隆音色</option>
            </select>
            <select class="siren-ext-select mimo-voice-select" style="width: 100%; height: 32px; ${safeType === "clone" ? "display:none;" : ""}">${buildBuiltinVoiceOptions(voiceId)}</select>
            <select class="siren-ext-select mimo-clone-select" style="width: 100%; height: 32px; ${safeType === "clone" ? "" : "display:none;"}">${buildCloneVoiceOptions(cloneId)}</select>
            <input type="text" class="siren-ext-input mimo-style-prompt" placeholder="style_prompt：自然语言声音设定（可留空）" value="${esc(stylePrompt)}" style="flex: 1 1 100%; width: 100%; box-sizing: border-box; height: 32px;">
            <button class="siren-ext-btn mimo-btn-del" style="background: none; border: none; color: #ef4444; width: 30px; height: 32px; padding: 0 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-left: auto;" title="删除"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;
}

function bindMimoRowEvents() {
  $("#siren-mimo-char-list .siren-mimo-char-item .mimo-char-type")
    .off("change")
    .on("change", function () {
      const $row = $(this).closest(".siren-mimo-char-item");
      const type = $(this).val();
      $row.find(".mimo-voice-select").toggle(type === "builtin");
      $row.find(".mimo-clone-select").toggle(type === "clone");
    });

  $("#siren-mimo-char-list .mimo-btn-del")
    .off("click")
    .on("click", function () {
      $(this).closest(".siren-mimo-char-item").remove();
    });
}

function collectMimoCharMapData() {
  const mapData = {};
  $("#siren-mimo-char-list .siren-mimo-char-item").each(function () {
    const charName = $(this).find(".mimo-char-name").val().trim();
    if (!charName) return;
    const stylePrompt = $(this).find(".mimo-style-prompt").val().trim();
    if ($(this).find(".mimo-char-type").val() === "clone") {
      const cloneId = $(this).find(".mimo-clone-select").val();
      if (!cloneId) return;
      mapData[charName] = {
        type: "clone",
        clone_id: cloneId,
        style_prompt: stylePrompt,
        enabled: true,
      };
    } else {
      const voiceId = $(this).find(".mimo-voice-select").val();
      if (!voiceId) return;
      mapData[charName] = {
        type: "builtin",
        voice_id: voiceId,
        style_prompt: stylePrompt,
        enabled: true,
      };
    }
  });
  return mapData;
}

async function loadMimoCharDataFromCard() {
  const context = SillyTavern.getContext();
  const characterId = context.characterId;
  const $list = $("#siren-mimo-char-list");
  $list.empty();

  if (characterId === undefined || characterId === null) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">当前未选中角色，无法加载映射配置。</div>`,
    );
    return;
  }

  const voices =
    context.characters?.[characterId]?.data?.extensions?.siren_voice_tts_mimo
      ?.voices || {};

  const entries = Object.entries(voices);
  if (entries.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">暂无角色映射。点击下方按钮新增，角色名可填写「旁白」。</div>`,
    );
  } else {
    for (const [cName, config] of entries) {
      $list.append(
        createMimoCharRow(
          cName,
          config?.type === "clone" ? "clone" : "builtin",
          config?.voice_id || "",
          config?.clone_id || "",
          config?.style_prompt || "",
        ),
      );
    }
  }

  bindMimoRowEvents();
}

// ==========================================
// Clone 资产管理
// ==========================================

function refreshMimoCharCloneSelects() {
  // 刷新映射表中所有克隆音色下拉框（保留当前选中值）
  $("#siren-mimo-char-list .siren-mimo-char-item").each(function () {
    const $select = $(this).find(".mimo-clone-select");
    const current = $select.val() || $select.data("selected") || "";
    $select.html(buildCloneVoiceOptions(current));
  });
}

function refreshMimoTestVoiceSelect() {
  const $select = $("#siren-mimo-test-voice");
  const current = $select.val();
  let html = `<optgroup label="预置音色">`;
  MIMO_BUILTIN_VOICES.forEach((v) => {
    html += `<option value="builtin:${esc(v.id)}">${esc(v.name)}</option>`;
  });
  html += `</optgroup>`;
  if (mimoCloneAssets.length > 0) {
    html += `<optgroup label="本机克隆音色">`;
    mimoCloneAssets.forEach((a) => {
      html += `<option value="clone:${esc(a.id)}">${esc(a.name || a.id)}</option>`;
    });
    html += `</optgroup>`;
  }
  $select.html(html);
  if (current) $select.val(current);
}

function refreshMimoCloneAssetList() {
  const $list = $("#siren-mimo-clone-list");
  $list.empty();

  if (mimoCloneAssets.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center; font-size: 0.9em;">暂无克隆音色，请在下方新增。</div>`,
    );
    return;
  }

  mimoCloneAssets.forEach((asset) => {
    const $el = $(
      `<div class="siren-mimo-clone-item" data-id="${esc(asset.id)}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="color: #e2e8f0; font-weight: 600; flex: 1; min-width: 120px; word-break: break-all;">${esc(asset.name || asset.id)}</span>
                <span style="color: #64748b; font-size: 0.8em;">${esc(asset.mimeType?.replace("audio/", "").toUpperCase() || "?")} · ${formatBytes(asset.byteLength)}</span>
                <button class="siren-ext-btn siren-ext-btn-secondary mimo-clone-preview" style="padding: 3px 10px; font-size: 0.85em;"><i class="fa-solid fa-play"></i> 试听</button>
                <button class="siren-ext-btn siren-ext-btn-secondary mimo-clone-replace" style="padding: 3px 10px; font-size: 0.85em;"><i class="fa-solid fa-file-audio"></i> 替换音频</button>
                <button class="siren-ext-btn siren-ext-btn-secondary mimo-clone-delete" style="padding: 3px 10px; font-size: 0.85em; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1);"><i class="fa-solid fa-trash"></i> 删除</button>
            </div>
            <audio class="mimo-clone-audio" controls style="height: 32px; width: 100%; display: none;"></audio>
        </div>`,
    );

    $el.find(".mimo-clone-preview").on("click", function () {
      const $audio = $el.find(".mimo-clone-audio");
      if (!$audio.attr("src")) $audio.attr("src", asset.dataUrl);
      $audio.show();
      $audio[0].play().catch((e) =>
        console.warn("[Siren Voice][MiMo] 参考音频播放被拦截", e),
      );
    });

    $el.find(".mimo-clone-replace").on("click", function () {
      $("#siren-mimo-clone-replace-file").data("replace-id", asset.id).click();
    });

    $el.find(".mimo-clone-delete").on("click", async function () {
      if (!confirm(`确定删除克隆音色「${asset.name || asset.id}」吗？`)) return;
      await deleteMimoCloneAsset(asset.id);
      if (window.toastr) window.toastr.success("克隆音色已删除");
      await refreshMimoCloneAssets();
    });

    $list.append($el);
  });
}

async function refreshMimoCloneAssets() {
  mimoCloneAssets = await listMimoCloneAssets();
  refreshMimoCloneAssetList();
  refreshMimoCharCloneSelects();
  refreshMimoTestVoiceSelect();
}

// ==========================================
// 保存
// ==========================================

function collectMimoGlobalSettingsFromUi() {
  const settings = getSirenSettings();
  if (!settings.tts.mimo) settings.tts.mimo = {};
  settings.tts.mimo.api_key = $("#siren-mimo-apikey").val().trim();
  settings.tts.mimo.api_base =
    $("#siren-mimo-apibase").val().trim() || MIMO_DEFAULT_API_BASE;
  settings.tts.mimo.format = "wav"; // 第一版固定非流式 WAV
  settings.tts.mimo.default_narrator_voice_id =
    $("#siren-mimo-narrator-voice").val() || "冰糖";
  settings.tts.mimo.default_narrator_style_prompt = $(
    "#siren-mimo-narrator-style",
  ).val();
  return settings.tts.mimo;
}

/**
 * 统一保存入口：同时保存全局 MiMo 设置和当前角色卡的 siren_voice_tts_mimo 映射。
 */
async function saveMimoSettings(isSilent = false) {
  // === 阶段一：保存全局 API 配置 ===
  collectMimoGlobalSettingsFromUi();
  saveSirenSettings(true);

  // === 阶段二：保存当前角色卡映射 ===
  const mapData = collectMimoCharMapData();
  const isSaved = await saveToCharacterCard(
    "siren_voice_tts_mimo",
    { voices: mapData, updated_at: Date.now() },
    true,
  );

  if (!isSilent && window.toastr) {
    window.toastr.success("MiMo: 设置与角色音色映射已保存！");
  }
  return isSaved;
}

// ==========================================
// 事件绑定
// ==========================================

export function bindMimoEvents() {
  const settings = getSirenSettings();
  if (!settings.tts.mimo) {
    settings.tts.mimo = {
      api_key: "",
      api_base: MIMO_DEFAULT_API_BASE,
      format: "wav",
      default_narrator_voice_id: "冰糖",
      default_narrator_style_prompt: "温柔、自然、清晰，像有声小说旁白。",
      request_timeout_ms: 60000,
    };
  }
  const mimoConfig = settings.tts.mimo;

  // 1. 初始化全局参数 UI
  $("#siren-mimo-apikey").val(mimoConfig.api_key || "");
  $("#siren-mimo-apibase").val(mimoConfig.api_base || MIMO_DEFAULT_API_BASE);
  $("#siren-mimo-narrator-style").val(
    mimoConfig.default_narrator_style_prompt || "",
  );
  const $narratorSelect = $("#siren-mimo-narrator-voice");
  $narratorSelect.html(
    buildBuiltinVoiceOptions(mimoConfig.default_narrator_voice_id || "冰糖"),
  );

  // 2. 加载角色映射与本机 Clone 资产
  loadMimoCharDataFromCard();
  refreshMimoCloneAssets();

  // 3. 新增角色映射行
  $("#siren-mimo-char-add")
    .off("click")
    .on("click", function () {
      $("#siren-mimo-char-list").append(createMimoCharRow());
      bindMimoRowEvents();
    });

  // 4. 保存全部设置（tts.js 全局保存会以 [true] 静默触发）
  $("#siren-mimo-save-all")
    .off("click")
    .on("click", async function (e, isSilent = false) {
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        await saveMimoSettings(isSilent);

        // 与 MiniMax 一致：保存后自动切换为当前 Provider 并同步世界书
        const currentSettings = getSirenSettings();
        currentSettings.tts.provider = "mimo";
        currentSettings.tts.enabled = true;
        saveSirenSettings(true);
        $("#siren-tts-provider").val("mimo");
        $("#siren-tts-enable").prop("checked", true);
        $("#siren-tts-main-wrapper").show();
        await syncTtsWorldbookEntries("mimo", true);

        if (!isSilent && window.toastr) {
          window.toastr.success(
            "MiMo: 配置已保存，已自动切换并同步世界书！",
          );
        }
      } catch (err) {
        console.error("[Siren Voice][MiMo] 保存失败:", err);
        if (!isSilent && window.toastr)
          window.toastr.error("MiMo 保存失败，请检查控制台报错！");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 5. 新增 Clone 资产
  let pendingCloneFile = null;
  $("#siren-mimo-clone-choose")
    .off("click")
    .on("click", () => $("#siren-mimo-clone-file").click());

  $("#siren-mimo-clone-file")
    .off("change")
    .on("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      pendingCloneFile = file;
      $("#siren-mimo-clone-filename")
        .text(`${file.name} (${formatBytes(file.size)})`)
        .css("color", "#0ea5e9");
    });

  $("#siren-mimo-clone-save")
    .off("click")
    .on("click", async function () {
      if (!pendingCloneFile) {
        if (window.toastr)
          window.toastr.warning("请先选择 MP3/WAV 参考音频！");
        return;
      }
      const name = $("#siren-mimo-clone-name").val().trim();
      if (!name) {
        if (window.toastr)
          window.toastr.warning("请填写克隆音色名称！");
        return;
      }
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        const asset = await fileToMimoCloneAsset(pendingCloneFile);
        asset.name = name;
        await saveMimoCloneAsset(asset);

        pendingCloneFile = null;
        $("#siren-mimo-clone-name").val("");
        $("#siren-mimo-clone-file").val("");
        $("#siren-mimo-clone-filename")
          .text("未选择文件")
          .css("color", "#64748b");
        if (window.toastr)
          window.toastr.success(`克隆音色「${name}」已保存到本机！`);
        await refreshMimoCloneAssets();
      } catch (err) {
        console.error("[Siren Voice][MiMo] 保存克隆音色失败:", err);
        if (window.toastr) window.toastr.error(err?.message || "保存失败");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 6. 替换 Clone 音频（保留 id，刷新 revision 以便缓存失效）
  $("#siren-mimo-clone-replace-file")
    .off("change")
    .on("change", async function (e) {
      const file = e.target.files?.[0];
      const replaceId = $(this).data("replace-id");
      $(this).val("");
      if (!file || !replaceId) return;

      const oldAsset = await getMimoCloneAsset(replaceId);
      if (!oldAsset) {
        if (window.toastr) window.toastr.error("未找到要替换的克隆音色！");
        return;
      }

      try {
        const newAsset = await fileToMimoCloneAsset(file);
        await saveMimoCloneAsset({
          ...oldAsset,
          mimeType: newAsset.mimeType,
          dataUrl: newAsset.dataUrl,
          byteLength: newAsset.byteLength,
          updatedAt: Date.now(),
          revision: newAsset.revision,
        });
        if (window.toastr) window.toastr.success("参考音频已替换！");
        await refreshMimoCloneAssets();
      } catch (err) {
        console.error("[Siren Voice][MiMo] 替换参考音频失败:", err);
        if (window.toastr)
          window.toastr.error(err?.message || "替换参考音频失败");
      }
    });

  // 7. 发音测试
  $("#siren-mimo-test-generate")
    .off("click")
    .on("click", async function () {
      const selection = $("#siren-mimo-test-voice").val();
      const text = $("#siren-mimo-test-text").val().trim();
      const stylePrompt = $("#siren-mimo-test-style").val().trim();

      if (!selection) {
        if (window.toastr) window.toastr.warning("请先选择测试音色！");
        return;
      }
      if (!text) {
        if (window.toastr) window.toastr.warning("请输入测试台词！");
        return;
      }

      const $btn = $(this);
      const $status = $("#siren-mimo-test-status");
      const $audio = $("#siren-mimo-test-audio");
      const $download = $("#siren-mimo-test-download");

      $btn.prop("disabled", true);
      $status
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在合成中...')
        .css("color", "#f59e0b");
      $audio.hide();
      $download.hide();

      try {
        // 临时 speakObj + resolvedVoice 走唯一的生产请求入口
        const speakObj = {
          text,
          char: "测试",
          mood: "",
          detail: "",
          tag: "speak",
        };
        let resolvedVoice;
        if (selection.startsWith("clone:")) {
          const asset = await getMimoCloneAsset(selection.slice("clone:".length));
          if (!asset) throw new Error("此角色使用的克隆音色尚未导入本设备。");
          resolvedVoice = {
            type: "clone",
            voiceId: null,
            cloneId: asset.id,
            cloneRevision: asset.revision || String(asset.updatedAt || "0"),
            dataUrl: asset.dataUrl,
            stylePrompt,
            voiceKey: `clone:${asset.id}:${asset.revision || asset.updatedAt || 0}`,
          };
        } else {
          const voiceId = selection.slice("builtin:".length);
          resolvedVoice = {
            type: "builtin",
            voiceId,
            cloneId: null,
            cloneRevision: null,
            dataUrl: null,
            stylePrompt,
            voiceKey: `builtin:${voiceId}`,
          };
        }

        const mimoSettings = collectMimoGlobalSettingsFromUi();
        const blob = await generateMimoAudioBlob(
          speakObj,
          resolvedVoice,
          mimoSettings,
        );

        // 替换或销毁前一个 Object URL，避免泄漏
        if (mimoTestObjectUrl) {
          URL.revokeObjectURL(mimoTestObjectUrl);
          mimoTestObjectUrl = null;
        }
        mimoTestObjectUrl = URL.createObjectURL(blob);
        $audio.attr("src", mimoTestObjectUrl).show();
        $download.attr("href", mimoTestObjectUrl).show();
        $status.html('<span style="color: #10b981;">生成成功！</span>');
        $audio[0].play().catch((e) =>
          console.warn("自动播放被浏览器拦截", e),
        );
      } catch (err) {
        console.error("[Siren Voice][MiMo] 发音测试失败:", err);
        $status
          .html(`<span style="color: #ef4444;" title="${esc(err?.message)}">失败: ${esc(err?.message)}</span>`);
      } finally {
        $btn.prop("disabled", false);
      }
    });

  // 8. 切换角色/聊天时刷新映射
  window.addEventListener("siren:character_changed", () => {
    if ($("#siren-mimo-char-list").length > 0) {
      console.log("[Siren Voice] 🔄 检测到聊天切换，正在刷新 MiMo 音色映射...");
      loadMimoCharDataFromCard();
      refreshMimoCharCloneSelects();
    }
  });
}

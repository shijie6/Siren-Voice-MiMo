// scripts/indextts25.js
// IndexTTS 2.5（本地模型，与 2.0 同款 API 合同、推理更快）设置界面。
// 精简自 IndexTTS 2：服务配置 + 语言 + 角色音色映射 + 发音测试。
// 🌟 情绪预设与 IndexTTS 2 共用（在 2.0 面板管理）；无旁白兜底由逻辑层处理。
import {
  getSirenSettings,
  saveSirenSettings,
  saveToCharacterCard,
} from "./settings.js";
import {
  fetchIndexTts25Voices,
  getCharacterTts25Config,
  requestIndexTts25Generation,
  saveCurrentCharacterTts25Config,
} from "./indextts25_logic.js";
import { syncTtsWorldbookEntries } from "./utils.js";

export function getIndexTts25Html() {
  return `
    <style>
        .siren-idx25-search-item { padding: 8px 12px; cursor: pointer; color: #e2e8f0; font-size: 0.9em; border-bottom: 1px solid #1e293b; transition: all 0.2s; }
        .siren-idx25-search-item:hover { background: rgba(6, 182, 212, 0.2); color: #06b6d4 !important; }
        .siren-idx25-search-results::-webkit-scrollbar { width: 4px; }
        .siren-idx25-search-results::-webkit-scrollbar-thumb { background: #06b6d4; border-radius: 2px; }
        .siren-idx25-align-fix { margin: 0 !important; height: 34px !important; box-sizing: border-box !important; }
    </style>
    <div id="siren-idx25-wrapper" style="display: flex; flex-direction: column; gap: 12px;">
        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <h4 style="color: #06b6d4; font-size: 1.1em; margin: 0;">
                <i class="fa-solid fa-server" style="margin-right: 5px;"></i> IndexTTS 2.5 服务配置
            </h4>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">服务地址 (API Base URL)</div>
                <input type="text" id="siren-idx25-api" class="siren-ext-input siren-idx25-align-fix" style="flex: 1; min-width: 200px;" placeholder="http://127.0.0.1:7880">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">API Key（可选）</div>
                <input type="password" id="siren-idx25-apikey" class="siren-ext-input siren-idx25-align-fix" style="flex: 1; min-width: 200px;" placeholder="服务未启用鉴权时留空">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label">
                    <label style="color:#cbd5e1; font-size: 0.95em;">合成语言 (lang)</label>
                    <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 2px;">2.5 支持中/英/日/西/阿跨语种；「自动」不发送该字段（兼容旧服务端）</small>
                </div>
                <select id="siren-idx25-lang" class="siren-ext-select" style="flex: 1; min-width: 160px;">
                    <option value="">自动（不发送）</option>
                    <option value="ZH">中文 (ZH)</option>
                    <option value="EN">英文 (EN)</option>
                    <option value="JA">日文 (JA)</option>
                    <option value="ES">西班牙语 (ES)</option>
                    <option value="AR">阿拉伯语 (AR)</option>
                </select>
            </div>

            <div style="color: #94a3b8; font-size: 0.82em; background: rgba(6, 182, 212, 0.08); border: 1px dashed rgba(6, 182, 212, 0.3); padding: 8px 10px; border-radius: 6px;">
                <i class="fa-solid fa-circle-info" style="color:#06b6d4;"></i>
                情绪预设与 Index TTS 2 <b>共用同一套</b>（在 Index TTS 2 面板中管理即可），2.5 请求时自动应用；
                高级采样参数沿用 2.0 的默认值。2.0 质量优先、2.5 速度优先，可用不同端口分别部署。
            </div>
        </div>

        <h4 style="color: #a78bfa; font-size: 1.1em; margin: 5px 0 10px 0; border-bottom: 1px solid rgba(168, 85, 247, 0.3); padding-bottom: 5px;">
            <i class="fa-solid fa-users-viewfinder" style="margin-right: 5px;"></i> 角色音色映射
        </h4>
        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px;">
            <div style="text-align: right; margin-bottom: 8px;">
                <button id="siren-idx25-char-add" class="siren-ext-btn siren-ext-btn-secondary" style="padding: 2px 8px; font-size: 0.85em;"><i class="fa-solid fa-plus"></i> 添加</button>
            </div>
            <div id="siren-idx25-char-list" style="display: flex; flex-direction: column; gap: 6px; min-height: 50px;"></div>
            <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 8px;">
                在输入框中输入或点击可搜索服务端的参考音频列表；未映射的角色按 IndexTTS 2 同款规则兜底。
            </small>
        </div>

        <h4 style="color: #10b981; margin-bottom: 10px; font-size: 1.1em; margin-top: 10px;"><i class="fa-solid fa-vial" style="margin-right: 5px;"></i> IndexTTS 2.5 发音测试</h4>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 10px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
                <select id="siren-idx25-test-char" class="siren-ext-select" style="flex: 1; min-width: 160px;">
                    <option value="">(点击选择已映射的角色)</option>
                </select>
            </div>
            <textarea id="siren-idx25-test-text" class="siren-ext-textarea" rows="2" placeholder="输入一句台词测试效果。"></textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                <button id="siren-idx25-test-generate" class="siren-ext-btn siren-ext-btn-primary" style="background: #10b981; border-color: #059669; color: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); font-weight: bold;">
                    <i class="fa-solid fa-bolt"></i> 生成测试
                </button>
                <div style="flex: 1; margin-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <audio id="siren-idx25-test-audio" controls style="height: 32px; flex: 1; display: none;"></audio>
                    <a id="siren-idx25-test-download" class="siren-ext-btn siren-ext-btn-secondary" style="display: none; padding: 4px 10px; text-decoration: none; color: #cbd5e1;" download="idx25_test.wav" title="下载音频">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    <span id="siren-idx25-test-status" style="color: #64748b; font-size: 0.85em; white-space: nowrap;">等待生成...</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 10px;">
            <button id="siren-idx25-save-all" class="siren-ext-btn siren-ext-btn-primary" style="width: 100%; padding: 12px 0; justify-content: center; font-size: 1.05em; background: #0284c7; border-color: #0284c7; color: #fff;">
                <i class="fa-solid fa-floppy-disk"></i> 保存全部设置
            </button>
        </div>
    </div>
    `;
}

function createIdx25CharRow(charName = "", voiceRef = "") {
  return `
        <div class="siren-ext-setting-row siren-idx25-char-item" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; position: relative;">
            <input type="text" class="siren-ext-input idx25-char-name" placeholder="角色名" value="${esc(charName)}" style="flex: 1 1 30%; min-width: 90px; box-sizing: border-box; height: 34px;">
            <div style="flex: 1 1 60%; min-width: 160px; position: relative;">
                <input type="text" class="siren-ext-input idx25-audio-input" placeholder="参考音频（输入或点击搜索）" value="${esc(voiceRef)}" style="width: 100%; box-sizing: border-box; height: 34px;">
                <div class="siren-idx25-search-results" style="display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 30; background: #0f172a; border: 1px solid #06b6d4; border-radius: 6px; margin-top: 2px; max-height: 240px; overflow-y: auto; box-shadow: 0 8px 20px rgba(0,0,0,0.6);"></div>
            </div>
            <button class="siren-ext-btn idx25-btn-del" style="background: none; border: none; color: #ef4444; width: 30px; height: 34px; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="删除"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadIdx25CharData() {
  const context = SillyTavern.getContext();
  const characterId = context.characterId;
  const $list = $("#siren-idx25-char-list");
  $list.empty();

  if (characterId === undefined || characterId === null) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">当前未选中角色，无法加载映射配置。</div>`,
    );
    return;
  }

  const cfg = getCharacterTts25Config(characterId);
  const voices = cfg?.voices || {};
  const entries = Object.entries(voices);
  if (entries.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center; padding: 8px;">暂无角色映射，点击「添加」新增。</div>`,
    );
  } else {
    for (const [cName, voicePath] of entries) {
      $list.append(createIdx25CharRow(cName, voicePath));
    }
  }
}

function collectIdx25CharMapData() {
  const mapData = {};
  $("#siren-idx25-char-list .siren-idx25-char-item").each(function () {
    const charName = $(this).find(".idx25-char-name").val().trim();
    const voiceRef = $(this).find(".idx25-audio-input").val().trim();
    if (charName && voiceRef) mapData[charName] = voiceRef;
  });
  return mapData;
}

export function bindIndexTts25Events() {
  const settings = getSirenSettings();
  if (!settings.tts.indextts25) settings.tts.indextts25 = {};
  const cfg = settings.tts.indextts25;

  // 1. 初始化 UI
  $("#siren-idx25-api").val(cfg.api_base || "http://127.0.0.1:7880");
  $("#siren-idx25-apikey").val(cfg.api_key || "");
  $("#siren-idx25-lang").val(cfg.lang || "");
  loadIdx25CharData();

  // 2. 参考音频搜索（防抖，与 2.0 交互一致）
  let searchTimeout = null;
  $("#siren-tts-provider-settings")
    .off("input.idx25", ".idx25-audio-input")
    .on("input.idx25", ".idx25-audio-input", function () {
      const $input = $(this);
      const keyword = $input.val().trim();
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        executeIdx25VoiceSearch($input, keyword);
      }, 400);
    })
    .off("focus.idx25", ".idx25-audio-input")
    .on("focus.idx25", ".idx25-audio-input", function () {
      executeIdx25VoiceSearch($(this), $(this).val().trim());
    })
    .off("click.idx25", ".siren-idx25-search-item")
    .on("click.idx25", ".siren-idx25-search-item", function () {
      $(this)
        .closest(".siren-idx25-char-item")
        .find(".idx25-audio-input")
        .val($(this).text());
      $(this).parent().slideUp(200);
    });

  $(document)
    .off("click.idx25Hide")
    .on("click.idx25Hide", function (e) {
      if (!$(e.target).closest(".idx25-audio-input, .siren-idx25-search-results").length) {
        $(".siren-idx25-search-results").slideUp(200);
      }
    });

  async function executeIdx25VoiceSearch($input, keyword) {
    const $results = $input.parent().find(".siren-idx25-search-results");
    const apiBase = $("#siren-idx25-api").val().replace(/\/+$/, "");
    const apiKey = $("#siren-idx25-apikey").val().trim();
    const headers = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    try {
      const res = await fetch(`${apiBase}/api/v1/voices`, { headers });
      if (!res.ok) throw new Error("API 请求失败");
      const data = await res.json();
      const voices = data.voices || [];
      const filtered = keyword
        ? voices.filter((v) => v.toLowerCase().includes(keyword.toLowerCase()))
        : voices;
      $results.empty();
      if (filtered.length === 0) {
        $results.append(
          '<div style="padding: 10px; color: #94a3b8; font-size: 0.85em; text-align: center;">未找到匹配的音频</div>',
        );
      } else {
        filtered.forEach((voice) => {
          $results.append(
            `<div class="siren-idx25-search-item">${esc(voice)}</div>`,
          );
        });
      }
      $(".siren-idx25-search-results").not($results).slideUp(200);
      $results.slideDown(200);
    } catch (err) {
      console.error("[Siren Voice][IndexTTS2.5] 获取音频列表失败", err);
      $results
        .empty()
        .append(
          '<div style="padding: 10px; color: #ef4444; font-size: 0.85em; text-align: center;">获取失败，请检查服务</div>',
        );
      $results.slideDown(200);
    }
  }

  // 3. 新增/删除映射行
  $("#siren-idx25-char-add")
    .off("click")
    .on("click", function () {
      $("#siren-idx25-char-list").append(createIdx25CharRow());
    });

  $("#siren-tts-provider-settings")
    .off("click.idx25Del", ".idx25-btn-del")
    .on("click.idx25Del", ".idx25-btn-del", function () {
      $(this).closest(".siren-idx25-char-item").remove();
    });

  // 4. 保存全部设置
  $("#siren-idx25-save-all")
    .off("click")
    .on("click", async function (e, isSilent = false) {
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        const currentSettings = getSirenSettings();
        if (!currentSettings.tts.indextts25) currentSettings.tts.indextts25 = {};
        currentSettings.tts.indextts25.api_base =
          $("#siren-idx25-api").val().trim() || "http://127.0.0.1:7880";
        currentSettings.tts.indextts25.api_key =
          $("#siren-idx25-apikey").val().trim();
        currentSettings.tts.indextts25.lang = $("#siren-idx25-lang").val();
        saveSirenSettings(true);

        const mapData = collectIdx25CharMapData();
        await saveToCharacterCard(
          "siren_voice_tts_v25",
          { voices: mapData, updated_at: Date.now() },
          true,
        );

        // 与其他 Provider 一致：保存后自动切换并同步世界书
        currentSettings.tts.provider = "indextts25";
        currentSettings.tts.enabled = true;
        saveSirenSettings(true);
        $("#siren-tts-provider").val("indextts25");
        $("#siren-tts-enable").prop("checked", true);
        $("#siren-tts-main-wrapper").show();
        await syncTtsWorldbookEntries("indextts25", true);

        if (!isSilent && window.toastr) {
          window.toastr.success(
            "IndexTTS 2.5: 配置已保存，已自动切换并同步世界书！",
          );
        }
      } catch (err) {
        console.error("[Siren Voice][IndexTTS2.5] 保存失败:", err);
        if (!isSilent && window.toastr)
          window.toastr.error("IndexTTS 2.5 保存失败，请检查控制台报错！");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 5. 发音测试
  $("#siren-idx25-test-char")
    .off("focus")
    .on("focus", function () {
      const $select = $(this);
      const currentVal = $select.val();
      $select
        .empty()
        .append('<option value="">(点击选择已映射的角色)</option>');
      $("#siren-idx25-char-list .siren-idx25-char-item").each(function () {
        const charName = $(this).find(".idx25-char-name").val().trim();
        if (charName) {
          $select.append(`<option value="${esc(charName)}">${esc(charName)}</option>`);
        }
      });
      if ($select.find(`option[value="${currentVal}"]`).length > 0) {
        $select.val(currentVal);
      }
    });

  $("#siren-idx25-test-generate")
    .off("click")
    .on("click", async function () {
      const charName = $("#siren-idx25-test-char").val();
      const text = $("#siren-idx25-test-text").val().trim();
      if (!charName) {
        if (window.toastr) window.toastr.warning("请先选择已映射的角色！");
        return;
      }
      if (!text) {
        if (window.toastr) window.toastr.warning("请输入测试台词！");
        return;
      }

      const $btn = $(this);
      const $status = $("#siren-idx25-test-status");
      const $audio = $("#siren-idx25-test-audio");
      const $download = $("#siren-idx25-test-download");

      $btn.prop("disabled", true);
      $status
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在合成中...')
        .css("color", "#f59e0b");

      try {
        const idx25Settings = getSirenSettings().tts.indextts25 || {};
        const blob = await requestIndexTts25Generation(
          { text, char: charName, mood: "", detail: "", tag: "speak" },
          idx25Settings,
        );

        const url = URL.createObjectURL(blob);
        $audio.attr("src", url).show();
        $download.attr("href", url).show();
        $status.html('<span style="color: #10b981;">生成成功！</span>');
        $audio[0].play().catch((e) =>
          console.warn("自动播放被浏览器拦截", e),
        );
      } catch (err) {
        console.error("[Siren Voice][IndexTTS2.5] 发音测试失败:", err);
        $status.html(
          `<span style="color: #ef4444;" title="${esc(err?.message)}">失败: ${esc(err?.message)}</span>`,
        );
      } finally {
        $btn.prop("disabled", false);
      }
    });

  // 6. 切换角色/聊天时刷新映射
  window.addEventListener("siren:character_changed", () => {
    if ($("#siren-idx25-char-list").length > 0) {
      console.log("[Siren Voice] 🔄 检测到聊天切换，正在刷新 IndexTTS 2.5 音色映射...");
      loadIdx25CharData();
    }
  });
}

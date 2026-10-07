// scripts/breeze.js
// Breeze TTS 2（本地模型）设置界面：服务地址、推理参数（cfg_scale/seed）、
// 参考音频资产管理（本机 IndexedDB）、角色音色映射（克隆/导演模式）和发音测试。
// 🌟 无旁白兜底、无 API Key（本地服务无鉴权）；情绪经 instruction 导演指令生效。
import {
  getSirenSettings,
  saveSirenSettings,
  saveToCharacterCard,
} from "./settings.js";
import {
  BREEZE_DEFAULT_API_BASE,
  fileToBreezeRefAsset,
  generateBreezeAudioBlob,
} from "./breeze_logic.js";
import {
  saveBreezeRefAsset,
  getBreezeRefAsset,
  listBreezeRefAssets,
  deleteBreezeRefAsset,
} from "./db.js";
import { syncTtsWorldbookEntries } from "./utils.js";

// 本机参考音频资产缓存
let breezeRefAssets = [];
// 测试区当前试听的 Object URL（替换或销毁前必须 revoke）
let breezeTestObjectUrl = null;

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

export function getBreezeHtml() {
  return `
    <div id="siren-breeze-wrapper">
        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <h4 style="color: #06b6d4; font-size: 1.1em; margin: 0;">
                <i class="fa-solid fa-server" style="margin-right: 5px;"></i> Breeze TTS 2 服务配置
            </h4>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">服务地址 (API Base URL)</div>
                <input type="text" id="siren-breeze-apibase" class="siren-ext-input" style="flex: 1; min-width: 200px;" placeholder="${esc(BREEZE_DEFAULT_API_BASE)}">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label">
                    <label style="color:#cbd5e1; font-size: 0.95em;">指令遵循强度 (cfg_scale)</label>
                    <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 2px;">官方建议 4；越高越严格服从导演指令</small>
                </div>
                <input type="number" id="siren-breeze-cfg" class="siren-ext-input" style="width: 80px; text-align: center;" min="0" max="10" step="0.5">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label">
                    <label style="color:#cbd5e1; font-size: 0.95em;">随机种子 (seed)</label>
                    <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 2px;">留空使用官方默认 42；固定种子输出更稳定</small>
                </div>
                <input type="number" id="siren-breeze-seed" class="siren-ext-input" style="width: 110px; text-align: center;" placeholder="默认 42">
            </div>

            <small style="color:#64748b; font-size: 0.8em;">
                <i class="fa-solid fa-circle-info"></i>
                Breeze TTS 2 为本地开源模型，需在 GPU 电脑上启动官方服务。手机/其他设备跨机访问时，请用扩展附带的
                <b>breeze-cors-start.py</b> 启动（官方服务默认无 CORS 头，浏览器会被拦截）。
            </small>
        </div>

        <h4 style="color: #a78bfa; font-size: 1.1em; margin-bottom: 10px; margin-top: 20px; border-bottom: 1px solid rgba(168, 85, 247, 0.3); padding-bottom: 5px;">
            <span><i class="fa-solid fa-users-viewfinder" style="margin-right: 5px;"></i> 角色音色映射</span>
        </h4>
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid #334155;">
            <div id="siren-breeze-char-list" style="display: flex; flex-direction: column; gap: 6px;">
            </div>
            <div style="margin-top: 10px; text-align: center;">
                <button id="siren-breeze-char-add" class="siren-ext-btn siren-ext-btn-secondary" style="width: 100%; border: 1px dashed #64748b; color: #94a3b8; background: transparent;">
                    <i class="fa-solid fa-plus"></i> 新增角色音色映射
                </button>
            </div>
            <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 8px; text-align: center;">
                每个角色绑定一段本机参考音频；「文字稿」必须是参考音频中说的话（克隆质量关键）；「导演指令」可选，如：语速缓慢，声音低沉。
            </small>
        </div>

        <h4 style="color: #f59e0b; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;">
            <i class="fa-solid fa-microphone-lines" style="margin-right: 5px;"></i> 参考音频管理（本机）
        </h4>
        <div style="background: rgba(0,0,0,0.2); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <div style="color: #f59e0b; font-size: 0.8em;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                参考音频仅保存在本机 IndexedDB 中；请只使用自己拥有授权的声音样本。
            </div>

            <div id="siren-breeze-asset-list" style="display: flex; flex-direction: column; gap: 8px;"></div>

            <div style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 12px;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="color:#cbd5e1; font-size:0.9em;">新增参考音频</label>
                    <input type="text" id="siren-breeze-asset-name" class="siren-ext-input" placeholder="参考音频名称（如：我的女声）">
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <input type="file" id="siren-breeze-asset-file" accept="audio/*" style="display: none;">
                        <button id="siren-breeze-asset-choose" class="siren-ext-btn siren-ext-btn-secondary" style="flex: 1; min-width: 110px;"><i class="fa-solid fa-folder-open"></i> 选择 MP3/WAV</button>
                        <button id="siren-breeze-asset-save" class="siren-ext-btn siren-ext-btn-primary" style="flex: 1; min-width: 110px; background: #f59e0b; border-color: #d97706; color: #fff;"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
                    </div>
                    <div id="siren-breeze-asset-filename" style="font-size: 0.8em; color: #64748b;">未选择文件</div>
                </div>
            </div>
        </div>

        <h4 style="color: #10b981; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;"><i class="fa-solid fa-vial" style="margin-right: 5px;"></i> Breeze 发音测试</h4>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            <select id="siren-breeze-test-voice" class="siren-ext-select" style="width: 100%;"></select>
            <textarea id="siren-breeze-test-text" class="siren-ext-textarea" rows="2" placeholder="输入一句台词测试效果，支持 (叹气) [轻笑] 等稿内标签。"></textarea>
            <textarea id="siren-breeze-test-instruction" class="siren-ext-textarea" rows="2" placeholder="本句导演指令（可留空），如：温柔、缓慢，带一点疲惫感。"></textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                <button id="siren-breeze-test-generate" class="siren-ext-btn siren-ext-btn-primary" style="background: #10b981; border-color: #059669; color: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); font-weight: bold;">
                    <i class="fa-solid fa-bolt"></i> 生成测试
                </button>
                <div style="flex: 1; margin-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <audio id="siren-breeze-test-audio" controls style="height: 32px; flex: 1; display: none;"></audio>
                    <a id="siren-breeze-test-download" class="siren-ext-btn siren-ext-btn-secondary" style="display: none; padding: 4px 10px; text-decoration: none; color: #cbd5e1;" download="breeze_test.wav" title="下载音频">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    <span id="siren-breeze-test-status" style="color: #64748b; font-size: 0.85em; white-space: nowrap;">等待生成...</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 20px;">
            <button id="siren-breeze-save-all" class="siren-ext-btn siren-ext-btn-primary" style="width: 100%; padding: 12px 0; justify-content: center; font-size: 1.05em; background: #0284c7; border-color: #0284c7; color: #fff;">
                <i class="fa-solid fa-floppy-disk"></i> 保存全部设置
            </button>
        </div>

        <input type="file" id="siren-breeze-asset-replace-file" accept="audio/*" style="display: none;">
    </div>
    `;
}

// ==========================================
// 角色映射表
// ==========================================

function buildRefAssetOptions(selectedId) {
  let html = `<option value="">(选择本机参考音频)</option>`;
  let hasSelected = false;
  breezeRefAssets.forEach((a) => {
    const selected = a.id === selectedId ? "selected" : "";
    if (selected) hasSelected = true;
    html += `<option value="${esc(a.id)}" ${selected}>${esc(a.name || a.id)}</option>`;
  });
  if (selectedId && !hasSelected) {
    html += `<option value="${esc(selectedId)}" selected>${esc(selectedId)} (本机缺失)</option>`;
  }
  return html;
}

function createBreezeCharRow(charName = "", refAssetId = "", refText = "", instruction = "") {
  return `
        <div class="siren-ext-setting-row siren-breeze-char-item" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
            <input type="text" class="siren-ext-input breeze-char-name" placeholder="角色名" value="${esc(charName)}" style="flex: 1 1 30%; min-width: 90px; box-sizing: border-box; height: 32px;">
            <select class="siren-ext-select breeze-ref-select" style="flex: 1 1 35%; min-width: 130px; height: 32px;">${buildRefAssetOptions(refAssetId)}</select>
            <button class="siren-ext-btn breeze-btn-del" style="background: none; border: none; color: #ef4444; width: 30px; height: 32px; padding: 0 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="删除"><i class="fa-solid fa-trash"></i></button>
            <input type="text" class="siren-ext-input breeze-ref-text" placeholder="文字稿：参考音频中说的话（必填）" value="${esc(refText)}" style="flex: 1 1 100%; width: 100%; box-sizing: border-box; height: 32px;">
            <input type="text" class="siren-ext-input breeze-instruction" placeholder="导演指令：角色音色与语气描述（可留空）" value="${esc(instruction)}" style="flex: 1 1 100%; width: 100%; box-sizing: border-box; height: 32px;">
        </div>
    `;
}

function bindBreezeRowEvents() {
  $("#siren-breeze-char-list .breeze-btn-del")
    .off("click")
    .on("click", function () {
      $(this).closest(".siren-breeze-char-item").remove();
    });
}

function collectBreezeCharMapData() {
  const mapData = {};
  $("#siren-breeze-char-list .siren-breeze-char-item").each(function () {
    const charName = $(this).find(".breeze-char-name").val().trim();
    const refAssetId = $(this).find(".breeze-ref-select").val();
    if (!charName || !refAssetId) return;
    mapData[charName] = {
      ref_asset_id: refAssetId,
      ref_text: $(this).find(".breeze-ref-text").val().trim(),
      instruction: $(this).find(".breeze-instruction").val().trim(),
      enabled: true,
    };
  });
  return mapData;
}

async function loadBreezeCharDataFromCard() {
  const context = SillyTavern.getContext();
  const characterId = context.characterId;
  const $list = $("#siren-breeze-char-list");
  $list.empty();

  if (characterId === undefined || characterId === null) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">当前未选中角色，无法加载映射配置。</div>`,
    );
    return;
  }

  const voices =
    context.characters?.[characterId]?.data?.extensions?.siren_voice_breeze
      ?.voices || {};

  const entries = Object.entries(voices);
  if (entries.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">暂无角色映射。点击下方按钮新增。</div>`,
    );
  } else {
    for (const [cName, config] of entries) {
      $list.append(
        createBreezeCharRow(
          cName,
          config?.ref_asset_id || "",
          config?.ref_text || "",
          config?.instruction || "",
        ),
      );
    }
  }

  bindBreezeRowEvents();
}

function refreshBreezeCharSelects() {
  $("#siren-breeze-char-list .siren-breeze-char-item").each(function () {
    const $select = $(this).find(".breeze-ref-select");
    const current = $select.val() || "";
    $select.html(buildRefAssetOptions(current));
  });
}

function refreshBreezeTestVoiceSelect() {
  const $select = $("#siren-breeze-test-voice");
  const current = $select.val();
  let html = `<option value="">(选择本机参考音频)</option>`;
  breezeRefAssets.forEach((a) => {
    html += `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`;
  });
  $select.html(html);
  if (current) $select.val(current);
}

async function refreshBreezeRefAssets() {
  breezeRefAssets = await listBreezeRefAssets();
  refreshBreezeAssetList();
  refreshBreezeCharSelects();
  refreshBreezeTestVoiceSelect();
}

function refreshBreezeAssetList() {
  const $list = $("#siren-breeze-asset-list");
  $list.empty();

  if (breezeRefAssets.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center; font-size: 0.9em;">暂无参考音频，请在下方新增。</div>`,
    );
    return;
  }

  breezeRefAssets.forEach((asset) => {
    const $el = $(
      `<div class="siren-breeze-asset-item" data-id="${esc(asset.id)}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="color: #e2e8f0; font-weight: 600; flex: 1; min-width: 120px; word-break: break-all;">${esc(asset.name || asset.id)}</span>
                <span style="color: #64748b; font-size: 0.8em;">${esc(asset.mimeType?.replace("audio/", "").toUpperCase() || "?")} · ${formatBytes(asset.byteLength)}</span>
                <button class="siren-ext-btn siren-ext-btn-secondary breeze-asset-preview" style="padding: 3px 10px; font-size: 0.85em;"><i class="fa-solid fa-play"></i> 试听</button>
                <button class="siren-ext-btn siren-ext-btn-secondary breeze-asset-replace" style="padding: 3px 10px; font-size: 0.85em;"><i class="fa-solid fa-file-audio"></i> 替换</button>
                <button class="siren-ext-btn siren-ext-btn-secondary breeze-asset-delete" style="padding: 3px 10px; font-size: 0.85em; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1);"><i class="fa-solid fa-trash"></i> 删除</button>
            </div>
            <audio class="breeze-asset-audio" controls style="height: 32px; width: 100%; display: none;"></audio>
        </div>`,
    );

    $el.find(".breeze-asset-preview").on("click", function () {
      const $audio = $el.find(".breeze-asset-audio");
      if (!$audio.attr("src")) $audio.attr("src", asset.dataUrl);
      $audio.show();
      $audio[0].play().catch((e) =>
        console.warn("[Siren Voice][Breeze] 参考音频播放被拦截", e),
      );
    });

    $el.find(".breeze-asset-replace").on("click", function () {
      $("#siren-breeze-asset-replace-file").data("replace-id", asset.id).click();
    });

    $el.find(".breeze-asset-delete").on("click", async function () {
      if (!confirm(`确定删除参考音频「${asset.name || asset.id}」吗？`)) return;
      await deleteBreezeRefAsset(asset.id);
      if (window.toastr) window.toastr.success("参考音频已删除");
      await refreshBreezeRefAssets();
    });

    $list.append($el);
  });
}

// ==========================================
// 保存
// ==========================================

function collectBreezeGlobalSettingsFromUi() {
  const settings = getSirenSettings();
  if (!settings.tts.breeze) settings.tts.breeze = {};
  settings.tts.breeze.api_base =
    $("#siren-breeze-apibase").val().trim() || BREEZE_DEFAULT_API_BASE;
  const cfg = parseFloat($("#siren-breeze-cfg").val());
  settings.tts.breeze.cfg_scale = Number.isFinite(cfg) ? cfg : 4;
  const seedRaw = $("#siren-breeze-seed").val().trim();
  settings.tts.breeze.seed = seedRaw === "" ? "" : Number(seedRaw);
  return settings.tts.breeze;
}

/**
 * 统一保存入口：同时保存全局 Breeze 设置和当前角色卡的 siren_voice_breeze 映射。
 */
async function saveBreezeSettings(isSilent = false) {
  collectBreezeGlobalSettingsFromUi();
  saveSirenSettings(true);

  const mapData = collectBreezeCharMapData();
  const isSaved = await saveToCharacterCard(
    "siren_voice_breeze",
    { voices: mapData, updated_at: Date.now() },
    true,
  );

  if (!isSilent && window.toastr) {
    window.toastr.success("Breeze TTS: 设置与角色音色映射已保存！");
  }
  return isSaved;
}

// ==========================================
// 事件绑定
// ==========================================

export function bindBreezeEvents() {
  const settings = getSirenSettings();
  if (!settings.tts.breeze) {
    settings.tts.breeze = {
      api_base: BREEZE_DEFAULT_API_BASE,
      cfg_scale: 4,
      seed: "",
      request_timeout_ms: 180000,
    };
  }
  const breezeConfig = settings.tts.breeze;

  // 1. 初始化全局参数 UI
  $("#siren-breeze-apibase").val(breezeConfig.api_base || BREEZE_DEFAULT_API_BASE);
  $("#siren-breeze-cfg").val(breezeConfig.cfg_scale ?? 4);
  $("#siren-breeze-seed").val(breezeConfig.seed ?? "");

  // 2. 加载角色映射与本机资产
  loadBreezeCharDataFromCard();
  refreshBreezeRefAssets();

  // 3. 新增角色映射行
  $("#siren-breeze-char-add")
    .off("click")
    .on("click", function () {
      $("#siren-breeze-char-list").append(createBreezeCharRow());
      bindBreezeRowEvents();
    });

  // 4. 新增参考音频
  let pendingAssetFile = null;
  $("#siren-breeze-asset-choose")
    .off("click")
    .on("click", () => $("#siren-breeze-asset-file").click());

  $("#siren-breeze-asset-file")
    .off("change")
    .on("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      pendingAssetFile = file;
      $("#siren-breeze-asset-filename")
        .text(`${file.name} (${formatBytes(file.size)})`)
        .css("color", "#0ea5e9");
    });

  $("#siren-breeze-asset-save")
    .off("click")
    .on("click", async function () {
      if (!pendingAssetFile) {
        if (window.toastr) window.toastr.warning("请先选择 MP3/WAV 参考音频！");
        return;
      }
      const name = $("#siren-breeze-asset-name").val().trim();
      if (!name) {
        if (window.toastr) window.toastr.warning("请填写参考音频名称！");
        return;
      }
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        const asset = await fileToBreezeRefAsset(pendingAssetFile);
        asset.name = name;
        await saveBreezeRefAsset(asset);

        pendingAssetFile = null;
        $("#siren-breeze-asset-name").val("");
        $("#siren-breeze-asset-file").val("");
        $("#siren-breeze-asset-filename").text("未选择文件").css("color", "#64748b");
        if (window.toastr)
          window.toastr.success(`参考音频「${name}」已保存到本机！`);
        await refreshBreezeRefAssets();
      } catch (err) {
        console.error("[Siren Voice][Breeze] 保存参考音频失败:", err);
        if (window.toastr) window.toastr.error(err?.message || "保存失败");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 5. 替换参考音频（保留 id，刷新 revision 以便缓存失效）
  $("#siren-breeze-asset-replace-file")
    .off("change")
    .on("change", async function (e) {
      const file = e.target.files?.[0];
      const replaceId = $(this).data("replace-id");
      $(this).val("");
      if (!file || !replaceId) return;

      const oldAsset = await getBreezeRefAsset(replaceId);
      if (!oldAsset) {
        if (window.toastr) window.toastr.error("未找到要替换的参考音频！");
        return;
      }

      try {
        const newAsset = await fileToBreezeRefAsset(file);
        await saveBreezeRefAsset({
          ...oldAsset,
          mimeType: newAsset.mimeType,
          dataUrl: newAsset.dataUrl,
          byteLength: newAsset.byteLength,
          updatedAt: Date.now(),
          revision: newAsset.revision,
        });
        if (window.toastr) window.toastr.success("参考音频已替换！");
        await refreshBreezeRefAssets();
      } catch (err) {
        console.error("[Siren Voice][Breeze] 替换参考音频失败:", err);
        if (window.toastr)
          window.toastr.error(err?.message || "替换参考音频失败");
      }
    });

  // 6. 保存全部设置（tts.js 全局保存会以 [true] 静默触发）
  $("#siren-breeze-save-all")
    .off("click")
    .on("click", async function (e, isSilent = false) {
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        await saveBreezeSettings(isSilent);

        // 与其他 Provider 一致：保存后自动切换为当前 Provider 并同步世界书
        const currentSettings = getSirenSettings();
        currentSettings.tts.provider = "breeze";
        currentSettings.tts.enabled = true;
        saveSirenSettings(true);
        $("#siren-tts-provider").val("breeze");
        $("#siren-tts-enable").prop("checked", true);
        $("#siren-tts-main-wrapper").show();
        await syncTtsWorldbookEntries("breeze", true);

        if (!isSilent && window.toastr) {
          window.toastr.success(
            "Breeze TTS: 配置已保存，已自动切换并同步世界书！",
          );
        }
      } catch (err) {
        console.error("[Siren Voice][Breeze] 保存失败:", err);
        if (!isSilent && window.toastr)
          window.toastr.error("Breeze TTS 保存失败，请检查控制台报错！");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 7. 发音测试
  $("#siren-breeze-test-generate")
    .off("click")
    .on("click", async function () {
      const assetId = $("#siren-breeze-test-voice").val();
      const text = $("#siren-breeze-test-text").val().trim();
      const instruction = $("#siren-breeze-test-instruction").val().trim();

      if (!assetId) {
        if (window.toastr) window.toastr.warning("请先选择参考音频！");
        return;
      }
      if (!text) {
        if (window.toastr) window.toastr.warning("请输入测试台词！");
        return;
      }

      const $btn = $(this);
      const $status = $("#siren-breeze-test-status");
      const $audio = $("#siren-breeze-test-audio");
      const $download = $("#siren-breeze-test-download");

      $btn.prop("disabled", true);
      $status
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在合成中...')
        .css("color", "#f59e0b");
      $audio.hide();
      $download.hide();

      try {
        const asset = await getBreezeRefAsset(assetId);
        if (!asset) throw new Error("此参考音频尚未导入本设备。");

        // 临时 speakObj + resolvedVoice 走唯一的生产请求入口
        const speakObj = {
          text,
          char: "测试",
          mood: "",
          detail: "",
          tag: "speak",
        };
        const resolvedVoice = {
          refAssetId: asset.id,
          refText: "",
          instruction,
          dataUrl: asset.dataUrl,
          refFileName: asset.name,
          voiceKey: `asset:${asset.id}:${asset.revision || asset.updatedAt || 0}`,
        };

        const breezeSettings = collectBreezeGlobalSettingsFromUi();
        const blob = await generateBreezeAudioBlob(
          speakObj,
          resolvedVoice,
          breezeSettings,
        );

        // 替换或销毁前一个 Object URL，避免泄漏
        if (breezeTestObjectUrl) {
          URL.revokeObjectURL(breezeTestObjectUrl);
          breezeTestObjectUrl = null;
        }
        breezeTestObjectUrl = URL.createObjectURL(blob);
        $audio.attr("src", breezeTestObjectUrl).show();
        $download.attr("href", breezeTestObjectUrl).show();
        $status.html('<span style="color: #10b981;">生成成功！</span>');
        $audio[0].play().catch((e) =>
          console.warn("自动播放被浏览器拦截", e),
        );
      } catch (err) {
        console.error("[Siren Voice][Breeze] 发音测试失败:", err);
        $status
          .html(`<span style="color: #ef4444;" title="${esc(err?.message)}">失败: ${esc(err?.message)}</span>`);
      } finally {
        $btn.prop("disabled", false);
      }
    });

  // 8. 切换角色/聊天时刷新映射
  window.addEventListener("siren:character_changed", () => {
    if ($("#siren-breeze-char-list").length > 0) {
      console.log("[Siren Voice] 🔄 检测到聊天切换，正在刷新 Breeze 音色映射...");
      loadBreezeCharDataFromCard();
      refreshBreezeCharSelects();
    }
  });
}

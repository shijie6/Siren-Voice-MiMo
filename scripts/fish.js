// scripts/fish.js
// Fish Audio Provider 设置界面：API Key、角色音色映射（reference_id）、
// 音色库（我的音色同步 / 公开库搜索）、克隆上传（POST /model）和发音测试。
// 🌟 Fish 无旁白兜底、无 style prompt、无本机 Clone 资产（音色为服务端持久 reference_id）。
import {
  getSirenSettings,
  saveSirenSettings,
  saveToCharacterCard,
} from "./settings.js";
import {
  fetchFishModels,
  uploadFishVoiceModel,
  generateFishAudioBlob,
} from "./fish_logic.js";
import { syncTtsWorldbookEntries } from "./utils.js";

// 模块级音色库缓存：同步我的音色后供 datalist 与行内回填使用
let fishMyModels = [];
// 测试区当前试听的 Object URL（替换或销毁前必须 revoke）
let fishTestObjectUrl = null;

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

export function getFishHtml() {
  return `
    <div id="siren-fish-wrapper">
        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
            <h4 style="color: #06b6d4; font-size: 1.1em; margin: 0;">
                <i class="fa-solid fa-server" style="margin-right: 5px;"></i> Fish Audio API 配置
            </h4>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">Fish Audio API Key</div>
                <input type="password" id="siren-fish-apikey" class="siren-ext-input" style="flex: 1; min-width: 200px;" placeholder="在 fish.audio/app/api-keys 生成">
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">合成模型</div>
                <select id="siren-fish-model" class="siren-ext-select" style="flex: 1; min-width: 200px;">
                    <option value="s2.1-pro-free">s2.1-pro-free（免费开发者档）</option>
                    <option value="s2.1-pro">s2.1-pro（默认付费档）</option>
                    <option value="s2-pro">s2-pro</option>
                    <option value="s1">s1（旧模型）</option>
                    <option value="drama-3-preview">drama-3-preview（预览版，支持多说话人）</option>
                </select>
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;">
                <div class="siren-ext-setting-label" style="white-space: nowrap; font-size: 0.95em; color: #cbd5e1;">API Base URL</div>
                <input type="text" id="siren-fish-apibase" class="siren-ext-input" style="flex: 1; min-width: 200px;" placeholder="留空使用官方 https://api.fish.audio">
            </div>
            <small style="color:#64748b; font-size: 0.8em;">
                <i class="fa-solid fa-circle-info"></i>
                Fish Audio 为按量计费的云端服务；音色为服务端持久 reference_id（官方公开音色库或自己账号的模型）。<br>
                <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i>
                官方 API 不开放浏览器跨域(CORS)，直连会被拦截。推荐填入酒馆自带的 CORS 代理：
                <b>/proxy/https://api.fish.audio</b>（相对路径，需在服务端启用 CORS 代理；手机/电脑访问地址不同也无需修改）。也可填自建反向代理的完整地址。
            </small>
        </div>

        <h4 style="color: #a78bfa; font-size: 1.1em; margin-bottom: 10px; margin-top: 20px; border-bottom: 1px solid rgba(168, 85, 247, 0.3); padding-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
            <span><i class="fa-solid fa-users-viewfinder" style="margin-right: 5px;"></i> 角色音色映射</span>
            <button id="siren-fish-fetch-my-models" class="siren-ext-btn siren-ext-btn-primary" style="padding: 4px 10px; font-size: 0.9em; background: #f59e0b; border-color: #d97706; color: #ffffff; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);">
                <i class="fa-solid fa-cloud-arrow-down"></i> 同步我的音色
            </button>
        </h4>
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid #334155;">
            <div id="siren-fish-char-list" style="display: flex; flex-direction: column; gap: 6px;">
            </div>
            <div style="margin-top: 10px; text-align: center;">
                <button id="siren-fish-char-add" class="siren-ext-btn siren-ext-btn-secondary" style="width: 100%; border: 1px dashed #64748b; color: #94a3b8; background: transparent;">
                    <i class="fa-solid fa-plus"></i> 新增角色音色映射
                </button>
            </div>
            <small style="display:block; color:#64748b; font-size: 0.8em; margin-top: 8px; text-align: center;">
                reference_id 可手填（官方音色页复制）或双击从「我的音色」中选择。未映射的角色不会被配音。
            </small>
        </div>

        <h4 style="color: #f59e0b; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;">
            <i class="fa-solid fa-microphone-lines" style="margin-right: 5px;"></i> 公开音色库搜索
        </h4>
        <div style="background: rgba(0,0,0,0.2); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <input type="text" id="siren-fish-search-keyword" class="siren-ext-input" placeholder="输入关键词搜索官方音色库（如：女声 / 萝莉 / 沉稳男声）" style="flex: 1; min-width: 160px;">
                <button id="siren-fish-search-btn" class="siren-ext-btn siren-ext-btn-primary" style="min-width: 90px;"><i class="fa-solid fa-magnifying-glass"></i> 搜索</button>
            </div>
            <div id="siren-fish-search-status" style="color: #64748b; font-size: 0.85em;">输入关键词开始搜索官方公开音色。</div>
            <div id="siren-fish-search-results" style="display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto;"></div>
        </div>

        <h4 style="color: #f59e0b; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;">
            <i class="fa-solid fa-wand-magic-sparkles" style="margin-right: 5px;"></i> 上传克隆音色
        </h4>
        <div style="background: rgba(0,0,0,0.2); border: 1px solid #334155; border-radius: 6px; padding: 15px; display: flex; flex-direction: column; gap: 10px;">
            <div style="color: #f59e0b; font-size: 0.8em;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                参考音频将上传到 Fish Audio 服务器创建音色模型。请只上传自己拥有授权的声音样本。<br>
                <i class="fa-solid fa-circle-info"></i>
                免费账号仅能创建「公开」音色（社区可见）；「非公开」凭链接可见；「私有」仅自己可见（需付费账号）。公开音色如要求封面图导致上传失败，请到 fish.audio 网站补传或改用网站流程。
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="color:#cbd5e1; font-size:0.9em;">音色可见性</label>
                <select id="siren-fish-clone-visibility" class="siren-ext-select" style="width: 100%;">
                    <option value="public">公开（public，免费账号可用）</option>
                    <option value="unlist">非公开（unlist，凭链接访问）</option>
                    <option value="private">私有（private，仅自己可见）</option>
                </select>
                <input type="text" id="siren-fish-clone-title" class="siren-ext-input" placeholder="克隆音色名称（如：我的女声）">
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <input type="file" id="siren-fish-clone-files" accept="audio/*" multiple style="display: none;">
                    <button id="siren-fish-clone-choose" class="siren-ext-btn siren-ext-btn-secondary" style="flex: 1; min-width: 110px;"><i class="fa-solid fa-folder-open"></i> 选择音频（可多选）</button>
                    <button id="siren-fish-clone-upload" class="siren-ext-btn siren-ext-btn-primary" style="flex: 1; min-width: 110px; background: #f59e0b; border-color: #d97706; color: #fff;"><i class="fa-solid fa-cloud-arrow-up"></i> 上传创建</button>
                </div>
                <div id="siren-fish-clone-filenames" style="font-size: 0.8em; color: #64748b;">未选择文件</div>
            </div>
        </div>

        <h4 style="color: #10b981; margin-bottom: 10px; font-size: 1.1em; margin-top: 25px;"><i class="fa-solid fa-vial" style="margin-right: 5px;"></i> Fish Audio 发音测试</h4>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            <input type="text" id="siren-fish-test-ref" class="siren-ext-input" list="siren-fish-model-datalist" placeholder="reference_id（手填或双击选择我的音色）">
            <textarea id="siren-fish-test-text" class="siren-ext-textarea" rows="2" placeholder="输入一句台词测试效果。"></textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                <button id="siren-fish-test-generate" class="siren-ext-btn siren-ext-btn-primary" style="background: #10b981; border-color: #059669; color: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); font-weight: bold;">
                    <i class="fa-solid fa-bolt"></i> 生成测试
                </button>
                <div style="flex: 1; margin-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <audio id="siren-fish-test-audio" controls style="height: 32px; flex: 1; display: none;"></audio>
                    <a id="siren-fish-test-download" class="siren-ext-btn siren-ext-btn-secondary" style="display: none; padding: 4px 10px; text-decoration: none; color: #cbd5e1;" download="fish_test.mp3" title="下载音频">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    <span id="siren-fish-test-status" style="color: #64748b; font-size: 0.85em; white-space: nowrap;">等待生成...</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 20px;">
            <button id="siren-fish-save-all" class="siren-ext-btn siren-ext-btn-primary" style="width: 100%; padding: 12px 0; justify-content: center; font-size: 1.05em; background: #0284c7; border-color: #0284c7; color: #fff;">
                <i class="fa-solid fa-floppy-disk"></i> 保存全部设置
            </button>
        </div>

        <datalist id="siren-fish-model-datalist"></datalist>
    </div>
    `;
}

// ==========================================
// 角色映射表
// ==========================================

function createFishCharRow(charName = "", referenceId = "", title = "") {
  return `
        <div class="siren-ext-setting-row siren-fish-char-item" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
            <input type="text" class="siren-ext-input fish-char-name" placeholder="角色名" value="${esc(charName)}" style="flex: 1 1 30%; min-width: 90px; box-sizing: border-box; height: 32px;">
            <input type="text" class="siren-ext-input fish-ref-id" list="siren-fish-model-datalist" placeholder="reference_id（手填或双击选择）" value="${esc(referenceId)}" style="flex: 1 1 40%; min-width: 140px; box-sizing: border-box; height: 32px;">
            <input type="text" class="siren-ext-input fish-ref-title" placeholder="备注（模型名，可留空）" value="${esc(title)}" style="flex: 1 1 25%; min-width: 110px; box-sizing: border-box; height: 32px;">
            <button class="siren-ext-btn fish-btn-del" style="background: none; border: none; color: #ef4444; width: 30px; height: 32px; padding: 0 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="删除"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;
}

function bindFishRowEvents() {
  $("#siren-fish-char-list .fish-btn-del")
    .off("click")
    .on("click", function () {
      $(this).closest(".siren-fish-char-item").remove();
    });

  // 从 datalist 选择后自动回填备注（模型名）
  $("#siren-fish-char-list .fish-ref-id")
    .off("change")
    .on("change", function () {
      const id = $(this).val().trim();
      if (!id) return;
      const model = fishMyModels.find((m) => m.id === id);
      if (model && model.title) {
        $(this).closest(".siren-fish-char-item").find(".fish-ref-title").val(model.title);
      }
    });
}

function collectFishCharMapData() {
  const mapData = {};
  $("#siren-fish-char-list .siren-fish-char-item").each(function () {
    const charName = $(this).find(".fish-char-name").val().trim();
    const referenceId = $(this).find(".fish-ref-id").val().trim();
    if (!charName || !referenceId) return;
    mapData[charName] = {
      reference_id: referenceId,
      title: $(this).find(".fish-ref-title").val().trim(),
      enabled: true,
    };
  });
  return mapData;
}

async function loadFishCharDataFromCard() {
  const context = SillyTavern.getContext();
  const characterId = context.characterId;
  const $list = $("#siren-fish-char-list");
  $list.empty();

  if (characterId === undefined || characterId === null) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">当前未选中角色，无法加载映射配置。</div>`,
    );
    return;
  }

  const voices =
    context.characters?.[characterId]?.data?.extensions?.siren_voice_tts_fish
      ?.voices || {};

  const entries = Object.entries(voices);
  if (entries.length === 0) {
    $list.html(
      `<div style="color: #64748b; text-align: center;">暂无角色映射。点击下方按钮新增，或从公开音色库搜索后一键添加。</div>`,
    );
  } else {
    for (const [cName, config] of entries) {
      $list.append(
        createFishCharRow(cName, config?.reference_id || "", config?.title || ""),
      );
    }
  }

  bindFishRowEvents();
}

function refreshFishModelDatalist() {
  const $datalist = $("#siren-fish-model-datalist");
  $datalist.empty();
  fishMyModels.forEach((m) => {
    const label = m.author ? `${m.title} (${m.author})` : m.title;
    $datalist.append(
      `<option value="${esc(m.id)}">${esc(label)}</option>`,
    );
  });
}

async function syncFishMyModels(apiKey, apiBase) {
  const { items } = await fetchFishModels({
    apiKey,
    self: true,
    pageSize: 100,
    apiBase,
  });
  fishMyModels = items;
  refreshFishModelDatalist();
  return items.length;
}

// ==========================================
// 公开音色库搜索
// ==========================================

function renderFishSearchResults(items) {
  const $box = $("#siren-fish-search-results");
  $box.empty();

  if (items.length === 0) {
    $box.html(
      `<div style="color: #64748b; text-align: center; font-size: 0.9em;">没有找到匹配的公开音色。</div>`,
    );
    return;
  }

  items.forEach((m) => {
    const $el = $(
      `<div class="siren-fish-search-item" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 140px;">
                <div style="color: #e2e8f0; font-weight: 600; word-break: break-all;">${esc(m.title || m.id)}</div>
                <div style="color: #64748b; font-size: 0.78em; word-break: break-all;">${m.author ? esc(m.author) + " · " : ""}${esc(m.id)}</div>
            </div>
            <button class="siren-ext-btn siren-ext-btn-secondary fish-search-use" style="padding: 3px 10px; font-size: 0.85em;"><i class="fa-solid fa-plus"></i> 添加为角色</button>
        </div>`,
    );

    $el.find(".fish-search-use").on("click", function () {
      $("#siren-fish-char-list").append(
        createFishCharRow("", m.id, m.title || ""),
      );
      bindFishRowEvents();
      if (window.toastr)
        window.toastr.info(`已添加 ${m.title || m.id}，请填写角色名后保存`);
    });

    $box.append($el);
  });
}

// ==========================================
// 保存
// ==========================================

function collectFishGlobalSettingsFromUi() {
  const settings = getSirenSettings();
  if (!settings.tts.fish) settings.tts.fish = {};
  settings.tts.fish.api_key = $("#siren-fish-apikey").val().trim();
  settings.tts.fish.tts_model = $("#siren-fish-model").val() || "s2.1-pro-free";
  settings.tts.fish.api_base = $("#siren-fish-apibase").val().trim();
  return settings.tts.fish;
}

/**
 * 统一保存入口：同时保存全局 Fish 设置和当前角色卡的 siren_voice_tts_fish 映射。
 */
async function saveFishSettings(isSilent = false) {
  collectFishGlobalSettingsFromUi();
  saveSirenSettings(true);

  const mapData = collectFishCharMapData();
  const isSaved = await saveToCharacterCard(
    "siren_voice_tts_fish",
    { voices: mapData, updated_at: Date.now() },
    true,
  );

  if (!isSilent && window.toastr) {
    window.toastr.success("Fish Audio: 设置与角色音色映射已保存！");
  }
  return isSaved;
}

// ==========================================
// 事件绑定
// ==========================================

export function bindFishEvents() {
  const settings = getSirenSettings();
  if (!settings.tts.fish) {
    settings.tts.fish = { api_key: "", request_timeout_ms: 60000 };
  }

  // 1. 初始化全局参数 UI
  $("#siren-fish-apikey").val(settings.tts.fish.api_key || "");
  $("#siren-fish-model").val(settings.tts.fish.tts_model || "s2.1-pro-free");
  $("#siren-fish-apibase").val(settings.tts.fish.api_base || "");

  // 2. 加载角色映射
  loadFishCharDataFromCard();

  // 3. 新增角色映射行
  $("#siren-fish-char-add")
    .off("click")
    .on("click", function () {
      $("#siren-fish-char-list").append(createFishCharRow());
      bindFishRowEvents();
    });

  // 4. 同步我的音色
  $("#siren-fish-fetch-my-models")
    .off("click")
    .on("click", async function () {
      const apiKey = $("#siren-fish-apikey").val().trim();
      if (!apiKey) {
        if (window.toastr)
          window.toastr.warning("请先填写 Fish Audio API Key！");
        return;
      }
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 同步中...')
          .prop("disabled", true);
        const count = await syncFishMyModels(
          apiKey,
          $("#siren-fish-apibase").val().trim(),
        );
        if (window.toastr)
          window.toastr.success(`已同步 ${count} 个我的音色！`);
      } catch (err) {
        console.error("[Siren Voice][Fish] 同步模型失败:", err);
        if (window.toastr) window.toastr.error(err?.message || "同步失败");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 5. 公开音色库搜索
  $("#siren-fish-search-btn")
    .off("click")
    .on("click", async function () {
      const keyword = $("#siren-fish-search-keyword").val().trim();
      if (!keyword) {
        if (window.toastr) window.toastr.warning("请输入搜索关键词！");
        return;
      }
      const $btn = $(this);
      const $status = $("#siren-fish-search-status");
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 搜索中...')
          .prop("disabled", true);
        $status.text("正在搜索...").css("color", "#f59e0b");

        const apiKey = $("#siren-fish-apikey").val().trim();
        const { items, hasMore } = await fetchFishModels({
          apiKey: apiKey,
          title: keyword,
          pageSize: 20,
          apiBase: $("#siren-fish-apibase").val().trim(),
        });
        renderFishSearchResults(items);
        $status
          .text(
            `找到 ${items.length} 个结果${hasMore ? "（仅显示前 20 条，请使用更精确的关键词）" : ""}`,
          )
          .css("color", "#10b981");
      } catch (err) {
        console.error("[Siren Voice][Fish] 公开库搜索失败:", err);
        $status.text(err?.message || "搜索失败").css("color", "#ef4444");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 6. 上传克隆音色
  let pendingCloneFiles = [];
  $("#siren-fish-clone-choose")
    .off("click")
    .on("click", () => $("#siren-fish-clone-files").click());

  $("#siren-fish-clone-files")
    .off("change")
    .on("change", function (e) {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      pendingCloneFiles = files;
      const summary = files
        .map((f) => `${f.name} (${formatBytes(f.size)})`)
        .join("、");
      $("#siren-fish-clone-filenames")
        .text(summary)
        .css("color", "#0ea5e9");
    });

  $("#siren-fish-clone-upload")
    .off("click")
    .on("click", async function () {
      const apiKey = $("#siren-fish-apikey").val().trim();
      const title = $("#siren-fish-clone-title").val().trim();
      if (!apiKey) {
        if (window.toastr)
          window.toastr.warning("请先填写 Fish Audio API Key！");
        return;
      }
      if (pendingCloneFiles.length === 0) {
        if (window.toastr) window.toastr.warning("请先选择参考音频文件！");
        return;
      }

      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 上传中...')
          .prop("disabled", true);
        const { id } = await uploadFishVoiceModel({
          apiKey,
          title,
          files: pendingCloneFiles,
          apiBase: $("#siren-fish-apibase").val().trim(),
          visibility: $("#siren-fish-clone-visibility").val() || "public",
        });

        $("#siren-fish-clone-title").val("");
        $("#siren-fish-clone-files").val("");
        pendingCloneFiles = [];
        $("#siren-fish-clone-filenames")
          .text("未选择文件")
          .css("color", "#64748b");

        if (window.toastr)
          window.toastr.success(
            `克隆音色创建成功！reference_id: ${id} 已同步到「我的音色」`,
          );

        // 上传成功后自动刷新模型列表，新音色立即可在 datalist 中选择
        try {
          await syncFishMyModels(apiKey, $("#siren-fish-apibase").val().trim());
        } catch {}
      } catch (err) {
        console.error("[Siren Voice][Fish] 克隆上传失败:", err);
        if (window.toastr) window.toastr.error(err?.message || "克隆上传失败");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 7. 保存全部设置（tts.js 全局保存会以 [true] 静默触发）
  $("#siren-fish-save-all")
    .off("click")
    .on("click", async function (e, isSilent = false) {
      const $btn = $(this);
      const originalHtml = $btn.html();
      try {
        $btn
          .html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...')
          .prop("disabled", true);

        await saveFishSettings(isSilent);

        // 与 MiMo 一致：保存后自动切换为当前 Provider 并同步世界书
        const currentSettings = getSirenSettings();
        currentSettings.tts.provider = "fish";
        currentSettings.tts.enabled = true;
        saveSirenSettings(true);
        $("#siren-tts-provider").val("fish");
        $("#siren-tts-enable").prop("checked", true);
        $("#siren-tts-main-wrapper").show();
        await syncTtsWorldbookEntries("fish", true);

        if (!isSilent && window.toastr) {
          window.toastr.success(
            "Fish Audio: 配置已保存，已自动切换并同步世界书！",
          );
        }
      } catch (err) {
        console.error("[Siren Voice][Fish] 保存失败:", err);
        if (!isSilent && window.toastr)
          window.toastr.error("Fish Audio 保存失败，请检查控制台报错！");
      } finally {
        $btn.html(originalHtml).prop("disabled", false);
      }
    });

  // 8. 发音测试
  $("#siren-fish-test-generate")
    .off("click")
    .on("click", async function () {
      const referenceId = $("#siren-fish-test-ref").val().trim();
      const text = $("#siren-fish-test-text").val().trim();

      if (!referenceId) {
        if (window.toastr) window.toastr.warning("请先填写 reference_id！");
        return;
      }
      if (!text) {
        if (window.toastr) window.toastr.warning("请输入测试台词！");
        return;
      }

      const $btn = $(this);
      const $status = $("#siren-fish-test-status");
      const $audio = $("#siren-fish-test-audio");
      const $download = $("#siren-fish-test-download");

      $btn.prop("disabled", true);
      $status
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在合成中...')
        .css("color", "#f59e0b");
      $audio.hide();
      $download.hide();

      try {
        // 临时 speakObj + resolvedVoice 走唯一的生产请求入口
        const speakObj = { text, char: "测试", mood: "", detail: "" };
        const resolvedVoice = {
          referenceId,
          title: "",
          voiceKey: `ref:${referenceId}`,
        };
        const fishSettings = collectFishGlobalSettingsFromUi();
        const blob = await generateFishAudioBlob(
          speakObj,
          resolvedVoice,
          fishSettings,
        );

        // 替换或销毁前一个 Object URL，避免泄漏
        if (fishTestObjectUrl) {
          URL.revokeObjectURL(fishTestObjectUrl);
          fishTestObjectUrl = null;
        }
        fishTestObjectUrl = URL.createObjectURL(blob);
        $audio.attr("src", fishTestObjectUrl).show();
        $download.attr("href", fishTestObjectUrl).show();
        $status.html('<span style="color: #10b981;">生成成功！</span>');
        $audio[0].play().catch((e) =>
          console.warn("自动播放被浏览器拦截", e),
        );
      } catch (err) {
        console.error("[Siren Voice][Fish] 发音测试失败:", err);
        $status
          .html(`<span style="color: #ef4444;" title="${esc(err?.message)}">失败: ${esc(err?.message)}</span>`);
      } finally {
        $btn.prop("disabled", false);
      }
    });

  // 9. 切换角色/聊天时刷新映射
  window.addEventListener("siren:character_changed", () => {
    if ($("#siren-fish-char-list").length > 0) {
      console.log(
        "[Siren Voice] 🔄 检测到聊天切换，正在刷新 Fish Audio 音色映射...",
      );
      loadFishCharDataFromCard();
    }
  });
}

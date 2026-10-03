import {
  getSirenSettings,
  saveSirenSettings,
  saveToCharacterCard,
} from "./settings.js";
import {
  generateVoxCpmAudioBlob,
  fetchVoxCpmAudioList,
  uploadVoxCpmAudio,
} from "./voxcpm_logic.js";
import { updateTtsGlobalMacros } from "./tts.js";

export function getVoxCpmHtml() {
  return `
    <style>
        .siren-vox-search-item:hover { background: rgba(6, 182, 212, 0.2); color: #06b6d4 !important; }
        .siren-vox-search-results::-webkit-scrollbar { width: 4px; }
        .siren-vox-search-results::-webkit-scrollbar-thumb { background: #06b6d4; border-radius: 2px; }
        .siren-vox-align-fix { margin: 0 !important; height: 34px !important; box-sizing: border-box !important; }

        /* 角色卡片容器：增加左侧主题色装饰条 */
        .siren-vox-char-row {
            background: rgba(15, 23, 42, 0.4) !important;
            border: 1px solid rgba(51, 65, 85, 0.6) !important;
            border-left: 4px solid #06b6d4 !important; /* 主题青色侧边栏 */
            padding: 15px !important;
            border-radius: 8px !important;
            margin-bottom: 12px !important;
            transition: all 0.2s ease-in-out;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        /* 悬停效果：卡片亮起 */
        .siren-vox-char-row:hover {
            background: rgba(6, 182, 212, 0.05) !important;
            border-color: rgba(6, 182, 212, 0.3) !important;
            transform: translateX(2px); /* 悬停时轻微右移，增加交互感 */
        }

        /* 标签小标题：统一配色 */
        .siren-vox-row-label {
            font-size: 0.8em;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            display: block;
        }
        
        .siren-vox-param-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            grid-auto-rows: 1fr; /* 🌟 核心修复：强制所有的隐式行保持同样的高度 */
        }
        /* 🌟 增加手机端极小屏幕单列显示，避免标签太挤 */
        @media screen and (max-width: 480px) {
            .siren-vox-param-grid { grid-template-columns: 1fr; }
        }
        @media screen and (min-width: 768px) {
            .siren-vox-param-grid { grid-template-columns: repeat(3, 1fr); }
        }
        @media screen and (min-width: 1024px) {
            .siren-vox-param-grid { grid-template-columns: repeat(4, 1fr); }
        }

        .siren-vox-param-card {
            display: flex;
            flex-direction: row; /* 🌟 统一横向排列 */
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            background: rgba(30, 41, 59, 0.4);
            padding: 10px 12px;
            border-radius: 8px;
            border: 1px solid rgba(51, 65, 85, 0.5);
            transition: all 0.2s;
            height: 100%; /* 🌟 撑满网格单元格 */
            box-sizing: border-box;
        }
        .siren-vox-param-card:hover {
            border-color: rgba(6, 182, 212, 0.4);
            background: rgba(30, 41, 59, 0.6);
        }

        .siren-vox-param-num::-webkit-outer-spin-button,
        .siren-vox-param-num::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .siren-vox-param-num {
            -moz-appearance: textfield;
            width: 55px;
            text-align: center;
            padding: 2px 4px;
            font-family: monospace;
            font-size: 0.9em;
            color: #06b6d4 !important;
            background: rgba(15, 23, 42, 0.6) !important;
            border: 1px solid #334155 !important;
            border-radius: 4px;
        }
    </style>

    <div>
        <div style="margin-bottom: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; align-items: center;">
                <h4 style="margin: 0; color: #cbd5e1; font-size: 1.1em; white-space: nowrap; width: 85px;"><i class="fa-solid fa-link" style="margin-right: 5px;"></i>API Base</h4>
                <div style="display: flex; gap: 5px; flex: 1; min-width: 200px; align-items: center;">
                    <input type="text" id="siren-vox-api" class="siren-ext-input" value="http://127.0.0.1:8000" style="flex: 1; min-width: 0;">
                    <button id="siren-vox-check" style="background:none; border:none; padding:5px; width:30px; flex-shrink:0; cursor:pointer;" title="健康检查">
                        <i class="fa-solid fa-heart-pulse" style="color:#ef4444; font-size:1.1em;"></i>
                    </button>
                    <button id="siren-vox-select-files-btn" style="background:none; border:none; padding:5px; width:30px; flex-shrink:0; cursor:pointer;" title="选择参考音频">
                        <i class="fa-solid fa-cloud-arrow-up" style="color:#38bdf8; font-size:1.1em;"></i>
                    </button>
                    <input type="file" id="siren-vox-file-input" accept=".wav,.mp3,.flac" style="display: none;">
                </div>
            </div>
            
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; align-items: center;">
                <h4 style="margin: 0; color: #cbd5e1; font-size: 1.1em; white-space: nowrap; width: 85px;"><i class="fa-solid fa-key" style="margin-right: 5px;"></i>API Key</h4>
                <div style="display: flex; flex: 1; min-width: 200px;">
                    <input type="password" id="siren-vox-apikey" class="siren-ext-input" placeholder="如果不设置请留空" style="flex: 1; min-width: 0;">
                </div>
            </div>
        </div>

        <hr class="siren-ext-divider" style="border-color: #334155;">

        <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #38bdf8; font-size: 1.1em;"><i class="fa-solid fa-users" style="margin-right: 5px;"></i>角色音色映射列表</h4>
            </div>
            
            <div id="siren-vox-char-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
                </div>
            
            <button id="siren-vox-char-add" class="siren-ext-btn siren-ext-btn-secondary" style="width: 100%; justify-content: center; border: 1px dashed #38bdf8; color: #38bdf8; background: rgba(56, 189, 248, 0.05);">
                <i class="fa-solid fa-plus"></i> 添加角色配置
            </button>
        </div>

        <hr class="siren-ext-divider" style="border-color: #334155;">

        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #94a3b8; font-size: 1.1em;"><i class="fa-solid fa-wrench" style="margin-right: 5px;"></i>高级参数</h4>

            <div class="siren-vox-param-grid">

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #cbd5e1;" title="推荐使用标点切分，不切分整段送入模型易爆显存">文本切分方式</label>
                    <select id="siren-vox-param-split-method" style="background: rgba(15, 23, 42, 0.6); color: #06b6d4; border: 1px solid #334155; border-radius: 4px; padding: 2px 4px; font-size: 0.9em; outline: none; flex-shrink: 0; max-width: 100px;">
                        <option value="punctuation">标点切分</option>
                        <option value="none">不切分</option>
                    </select>
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="仅在标点切分下生效。低于此字数向后合并">切分最小字数</label>
                    <input type="number" id="siren-vox-param-chunk-min" class="siren-vox-param-num" value="15" step="1" min="1">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="仅在标点切分下生效。合并时的最大安全字数限制">切分最大字数</label>
                    <input type="number" id="siren-vox-param-chunk-max" class="siren-vox-param-num" value="60" step="1" min="10">
                </div>
                
                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #cbd5e1;" title="将数字、日期转为文字读音">文本规范化</label>
                    <label class="siren-ext-switch" style="flex-shrink: 0;">
                        <input type="checkbox" id="siren-vox-param-norm">
                        <span class="siren-ext-slider"></span>
                    </label>
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #cbd5e1;" title="预处理去除参考音频底噪">音频预降噪</label>
                    <label class="siren-ext-switch" style="flex-shrink: 0;">
                        <input type="checkbox" id="siren-vox-param-denoise">
                        <span class="siren-ext-slider"></span>
                    </label>
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #cbd5e1;" title="生成异常时自动重试">坏例重试</label>
                    <label class="siren-ext-switch" style="flex-shrink: 0;">
                        <input type="checkbox" id="siren-vox-param-retry" checked>
                        <span class="siren-ext-slider"></span>
                    </label>
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="1.0-3.0">引导强度 (CFG)</label>
                    <input type="number" id="siren-vox-param-cfg" class="siren-vox-param-num" value="2.5" step="0.1" min="1.0" max="5.0">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="4-30">扩散步数 (Steps)</label>
                    <input type="number" id="siren-vox-param-steps" class="siren-vox-param-num" value="10" step="1" min="4" max="50">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="（底层参数）限制模型单次生成的极小语音长度，防止生成出空白音频。一般保持默认 2 即可。">最小生成Token</label>
                    <input type="number" id="siren-vox-param-minlen" class="siren-vox-param-num" value="2" step="1" min="1">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="（底层参数）限制模型单次生成的最大语音长度（防死循环跑飞）。4096 约对应 30 秒以上的音频。若长文本生成总是中断，可适当调大。">最大生成Token</label>
                    <input type="number" id="siren-vox-param-maxlen" class="siren-vox-param-num" value="4096" step="128" min="512">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="坏例重试最大次数">最大重试次数</label>
                    <input type="number" id="siren-vox-param-retrymax" class="siren-vox-param-num" value="3" step="1" min="1" max="10">
                </div>

                <div class="siren-vox-param-card">
                    <label style="font-size: 0.85em; color: #94a3b8;" title="判断为坏例的比例阈值">坏例比例阈值</label>
                    <input type="number" id="siren-vox-param-retrythresh" class="siren-vox-param-num" value="6.0" step="0.5" min="1.0" max="10.0">
                </div>

            </div>
        </div>

        <button id="siren-vox-global-save" class="siren-ext-btn siren-ext-btn-primary" style="width: 100%; padding: 12px 0; justify-content: center; font-size: 1.05em; margin-top: 15px; background: linear-gradient(135deg, #0ea5e9, #10b981); border: none;">
            <i class="fa-solid fa-layer-group"></i> 保存当前配置
        </button>

        <hr class="siren-ext-divider" style="border-color: #334155;">

        <h4 style="color: #10b981; margin-bottom: 10px; font-size: 1.1em;"><i class="fa-solid fa-vial" style="margin-right: 5px;"></i> VoxCPM 发音测试</h4>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 10px;">
            
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
                <select id="siren-vox-test-char" class="siren-ext-select" style="flex: 1; min-width: 160px;">
                    <option value="custom">自定义控制 (不使用预设列表)</option>
                    </select>
            </div>

            <div style="margin-bottom: 10px;">
                <input type="text" id="siren-vox-test-instruction" class="siren-ext-input" style="width: 100%;" placeholder="输入控制指令(如: 悲伤, 愤怒, 语速稍快等)">
                <small style="color: #64748b; margin-top: 4px; display: block;">* 若选择具体角色，此处仅填情绪(如: 激动地)；若自定义，可填音色+情绪(如: 成熟男性, 疑惑地)。</small>
            </div>
            
            <textarea id="siren-vox-test-text" class="siren-ext-textarea" rows="3" placeholder="输入你要让角色说出的具体语音内容..."></textarea>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                <button id="siren-vox-test-generate" class="siren-ext-btn siren-ext-btn-primary" style="background: #10b981; border-color: #10b981;"><i class="fa-solid fa-bolt"></i> 生成</button>
                
                <div id="siren-vox-test-preview" style="flex: 1; margin-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <audio id="siren-vox-test-audio" controls style="height: 32px; flex: 1; display: none;"></audio>
                    
                    <a id="siren-vox-test-download" class="siren-ext-btn siren-ext-btn-secondary" style="display: none; padding: 4px 10px; text-decoration: none; color: #cbd5e1;" download="voxcpm_test.wav" title="下载音频">
                        <i class="fa-solid fa-download"></i>
                    </a>
                    <span id="siren-vox-test-status" style="color: #64748b; font-size: 0.85em; white-space: nowrap;">等待生成...</span>
                </div>
            </div>
        </div>
    </div>
    `;
}

// 角色行模板
const voxCharRowHtml = `
<div class="siren-ext-setting-row siren-vox-char-row">
    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
        <div style="flex: 1;">
            <span class="siren-vox-row-label">角色名称</span>
            <input type="text" class="siren-ext-input siren-vox-align-fix siren-vox-char-name" placeholder="如: Sam" style="width: 100%;">
        </div>
        <div style="flex: 1;">
            <span class="siren-vox-row-label">语音模式</span>
            <select class="siren-ext-select siren-vox-align-fix siren-vox-char-mode" style="width: 100%;">
                <option value="clone">参考音频克隆</option>
                <option value="design">自然文本设计</option>
            </select>
        </div>
        <button class="siren-ext-btn siren-vox-row-del siren-vox-align-fix" style="background:none; border:none; color: #ef4444; margin-top: 18px; width: 30px;" title="删除">
            <i class="fa-solid fa-trash"></i>
        </button>
    </div>

    <div class="siren-vox-audio-ui" style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
        <div>
            <span class="siren-vox-row-label">额外指令 (可选)</span>
            <input type="text" class="siren-ext-input siren-vox-align-fix siren-vox-audio-extra-input" placeholder="例如: 快速地, 粤语" style="width: 100%;">
        </div>
        <div>
            <span class="siren-vox-row-label">参考音频路径</span>
            <div style="position: relative; display: flex; width: 100%;">
                <input type="text" class="siren-ext-input siren-vox-align-fix siren-vox-audio-input" placeholder="搜索或输入文件名..." style="width: 100%;">
                <div class="siren-vox-search-results" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; width: 100%; max-height: 150px; overflow-y: auto; background: #1e293b; border: 1px solid #06b6d4; border-radius: 6px; z-index: 100;"></div>
            </div>
        </div>
    </div>

    <div class="siren-vox-text-ui" style="display: none; width: 100%;">
        <span class="siren-vox-row-label">音色描述文本</span>
        <input type="text" class="siren-ext-input siren-vox-align-fix siren-vox-text-input" placeholder="描述音色，如: 磁性的男低音" style="width: 100%;">
    </div>
</div>
`;

export function loadVoxCpmData() {
  const settings = getSirenSettings();
  // 确保 tts 路径存在
  const ttsSettings = settings?.tts?.voxcpm || {};

  // 1. 全局高级参数回显
  $("#siren-vox-api").val(ttsSettings.api_base || "http://127.0.0.1:8888");
  $("#siren-vox-apikey").val(ttsSettings.api_key || "");
  $("#siren-vox-param-split-method").val(
    ttsSettings.split_method || "punctuation",
  );
  $("#siren-vox-param-chunk-min").val(ttsSettings.chunk_min_len ?? 15);
  $("#siren-vox-param-chunk-max").val(ttsSettings.chunk_max_len ?? 60);
  $("#siren-vox-param-norm").prop("checked", ttsSettings.norm_text || true);
  $("#siren-vox-param-denoise").prop("checked", ttsSettings.denoise || false);
  $("#siren-vox-param-retry").prop(
    "checked",
    ttsSettings.retry_badcase ?? true,
  );

  $("#siren-vox-param-cfg").val(ttsSettings.cfg_value ?? 2.5);
  $("#siren-vox-param-steps").val(ttsSettings.inference_timesteps ?? 10);
  $("#siren-vox-param-minlen").val(ttsSettings.min_len ?? 2);
  $("#siren-vox-param-maxlen").val(ttsSettings.max_len ?? 4096);
  $("#siren-vox-param-retrymax").val(ttsSettings.retry_badcase_max_times ?? 3);
  $("#siren-vox-param-retrythresh").val(
    ttsSettings.retry_badcase_ratio_threshold ?? 6.0,
  );

  // 2. 角色列表回显
  const $charList = $("#siren-vox-char-list");
  $charList.empty();

  const context = SillyTavern.getContext();
  if (context && context.characterId !== undefined) {
    const charExt =
      context.characters?.[context.characterId]?.data?.extensions || {};
    const voices = charExt.siren_voice_tts_voxcpm?.voices || {};

    Object.entries(voices).forEach(([charName, config]) => {
      const $row = $(voxCharRowHtml);
      $row.find(".siren-vox-char-name").val(charName);
      $row.find(".siren-vox-char-mode").val(config.mode);

      // 🌟 修复关键：在回显时手动处理 UI 显示隐藏，不依赖异步事件
      if (config.mode === "clone") {
        $row.find(".siren-vox-audio-input").val(config.data);
        $row.find(".siren-vox-audio-extra-input").val(config.extra || "");
        $row.find(".siren-vox-audio-ui").show();
        $row.find(".siren-vox-text-ui").hide();
      } else {
        $row.find(".siren-vox-text-input").val(config.data);
        $row.find(".siren-vox-audio-ui").hide();
        $row.find(".siren-vox-text-ui").show();
      }
      $charList.append($row);
    });
  }
  updateTestDropdown();
}

// 更新下拉框的辅助函数
function updateTestDropdown() {
  const $select = $("#siren-vox-test-char");
  const currentVal = $select.val();

  $select
    .empty()
    .append('<option value="custom">自定义控制 (不使用预设列表)</option>');

  $("#siren-vox-char-list .siren-vox-char-row").each(function () {
    const name = $(this).find(".siren-vox-char-name").val().trim();
    if (name) {
      $select.append(`<option value="${name}">${name}</option>`);
    }
  });

  if ($select.find(`option[value="${currentVal}"]`).length > 0) {
    $select.val(currentVal);
  }
}

export function bindVoxCpmEvents() {
  $("#siren-vox-char-add")
    .off("click")
    .on("click", function () {
      $("#siren-vox-char-list").append(voxCharRowHtml);
    });

  $("#siren-vox-char-list")
    .off("click", ".siren-vox-row-del")
    .on("click", ".siren-vox-row-del", function () {
      $(this).closest(".siren-vox-char-row").remove();
      updateTestDropdown();
    });

  $("#siren-vox-char-list")
    .off("change", ".siren-vox-char-mode")
    .on("change", ".siren-vox-char-mode", function () {
      const mode = $(this).val();
      const $row = $(this).closest(".siren-vox-char-row");
      if (mode === "clone") {
        $row.find(".siren-vox-audio-ui").show();
        $row.find(".siren-vox-text-ui").hide();
      } else {
        $row.find(".siren-vox-audio-ui").hide();
        $row.find(".siren-vox-text-ui").show();
      }
    });

  $("#siren-vox-char-list").on(
    "input",
    ".siren-vox-char-name",
    updateTestDropdown,
  );

  $("#siren-vox-check")
    .off("click")
    .on("click", async function () {
      const apiBase = $("#siren-vox-api").val().trim().replace(/\/$/, "");

      if (!apiBase) {
        if (window.toastr) window.toastr.warning("请先输入 API Base 地址！");
        return;
      }

      const $btn = $(this);
      const $icon = $btn.find("i");

      // 增加一个简单的加载中动画体验
      $icon.removeClass("fa-heart-pulse").addClass("fa-spinner fa-spin");

      try {
        // 健康检查无需鉴权
        const response = await fetch(`${apiBase}/health`, {
          method: "GET",
        });

        if (response.ok) {
          if (window.toastr) window.toastr.success("VoxCPM 服务连接正常！");
          // 可以让图标闪烁一下绿色表示成功
          $icon.css("color", "#10b981");
          setTimeout(() => $icon.css("color", "#ef4444"), 2000);
        } else {
          if (window.toastr)
            window.toastr.error(`健康检查失败: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("[Siren Voice] VoxCPM 健康检查失败:", error);
        if (window.toastr)
          window.toastr.error(
            "连接 VoxCPM 服务失败，请检查地址是否正确或服务是否启动。",
          );
      } finally {
        // 恢复图标状态
        $icon.removeClass("fa-spinner fa-spin").addClass("fa-heart-pulse");
      }
    });

  $("#siren-vox-test-generate")
    .off("click")
    .on("click", async function () {
      const text = $("#siren-vox-test-text").val().trim();
      const instruction = $("#siren-vox-test-instruction").val().trim();
      const charSelect = $("#siren-vox-test-char").val();

      if (!text) {
        if (window.toastr)
          window.toastr.warning("请输入要测试的具体语音内容！");
        return;
      }

      const $btn = $(this);
      const $status = $("#siren-vox-test-status");
      const $audio = $("#siren-vox-test-audio");
      const $download = $("#siren-vox-test-download");

      // UI 状态切换：加载中
      $btn
        .prop("disabled", true)
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 生成中');
      $status.text("正在合成音频，请稍候...");
      $audio.hide();
      $download.hide();

      try {
        // 构造模拟的 speakObj 喂给逻辑层
        const speakObj = { text: text };

        if (charSelect === "custom") {
          // 自定义模式：名称置空，把所有控制指令塞进 detail
          speakObj.char = "";
          speakObj.detail = instruction;
        } else {
          // 预设角色模式：传递角色名和具体情绪
          speakObj.char = charSelect;
          speakObj.detail = instruction;
        }

        // 获取最新的全局设置
        const settings = getSirenSettings();
        const ttsSettings = settings?.tts?.voxcpm || {};

        // 核心调用：由于这里直接调用 logic 层，控制台会自动打印我们在第 1 步加的日志
        const blob = await generateVoxCpmAudioBlob(speakObj, ttsSettings);

        if (blob) {
          const url = URL.createObjectURL(blob);
          $audio.attr("src", url).show()[0].play();
          $download.attr("href", url).show();
          $status.text("✅ 生成成功");
        } else {
          $status.text("❌ 生成失败，请查看控制台日志");
        }
      } catch (err) {
        console.error("[Siren Voice] 测试模块生成异常:", err);
        $status.text("❌ 请求发生异常");
      } finally {
        // 恢复按钮状态
        $btn
          .prop("disabled", false)
          .html('<i class="fa-solid fa-bolt"></i> 生成');
      }
    });

  // 🌟 统一保存核心逻辑 (增加安全检查)
  $("#siren-vox-global-save")
    .off("click")
    .on("click", async function (event, isGlobal = false) {
      const $btn = $(this);

      // --- 1. 收集角色卡音色数据 ---
      const voiceMap = {};
      $("#siren-vox-char-list .siren-vox-char-row").each(function () {
        const charName = $(this).find(".siren-vox-char-name").val().trim();
        const mode = $(this).find(".siren-vox-char-mode").val();
        let data = "";
        let extra = "";

        if (mode === "clone") {
          data = $(this).find(".siren-vox-audio-input").val().trim();
          extra = $(this).find(".siren-vox-audio-extra-input").val().trim(); // ✨ 获取额外指令
        } else {
          data = $(this).find(".siren-vox-text-input").val().trim();
        }

        if (charName && data) {
          // ✨ 把 extra 一起存入
          voiceMap[charName] = { mode, data, extra };
        }
      });

      let isCharSaved = false;
      const context = SillyTavern.getContext();
      if (
        context &&
        context.characterId !== undefined &&
        context.characterId !== null
      ) {
        await saveToCharacterCard(
          "siren_voice_tts_voxcpm",
          {
            voices: voiceMap,
            updated_at: Date.now(),
          },
          true,
        );
        isCharSaved = true;
      }

      // --- 2. 收集全局设置数据 (安全初始化) ---
      const settings = getSirenSettings();
      // 🌟 安全补丁：确保路径存在，防止 crash
      if (!settings.tts) settings.tts = {};
      if (!settings.tts.voxcpm) settings.tts.voxcpm = {};

      const tts = settings.tts.voxcpm;

      tts.api_base = $("#siren-vox-api").val().trim();
      tts.api_key = $("#siren-vox-apikey").val().trim();
      tts.split_method = $("#siren-vox-param-split-method").val();
      tts.chunk_min_len = parseInt($("#siren-vox-param-chunk-min").val()) || 15;
      tts.chunk_max_len = parseInt($("#siren-vox-param-chunk-max").val()) || 60;
      tts.norm_text = $("#siren-vox-param-norm").is(":checked");
      tts.denoise = $("#siren-vox-param-denoise").is(":checked");
      tts.retry_badcase = $("#siren-vox-param-retry").is(":checked");

      tts.cfg_value = parseFloat($("#siren-vox-param-cfg").val()) || 2.5;
      tts.inference_timesteps =
        parseInt($("#siren-vox-param-steps").val()) || 10;
      tts.min_len = parseInt($("#siren-vox-param-minlen").val()) || 2;
      tts.max_len = parseInt($("#siren-vox-param-maxlen").val()) || 4096;
      tts.retry_badcase_max_times =
        parseInt($("#siren-vox-param-retrymax").val()) || 3;
      tts.retry_badcase_ratio_threshold =
        parseFloat($("#siren-vox-param-retrythresh").val()) || 6.0;

      // --- 3. 存盘与提示 ---
      saveSirenSettings(true);
      await updateTtsGlobalMacros("voxcpm");

      if (!isGlobal && window.toastr) {
        if (isCharSaved) {
          window.toastr.success("VoxCPM 配置已保存！(已同步角色卡与全局)");
        } else {
          window.toastr.success("VoxCPM 全局配置已保存");
        }
      }
    });

  let cachedAudioList = null;

  // 👇 ================= 新增：上传文件逻辑 ================= 👇
  // 点击云朵上传按钮，触发隐藏的 file input
  $("#siren-vox-select-files-btn")
    .off("click")
    .on("click", function () {
      $("#siren-vox-file-input").click();
    });

  // 监听文件选择并执行上传
  $("#siren-vox-file-input")
    .off("change")
    .on("change", async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const settings = getSirenSettings();
      const ttsSettings = settings?.tts?.voxcpm || {};

      if (window.toastr) window.toastr.info(`正在上传: ${file.name}...`);

      // UI 锁死提示
      const $btn = $("#siren-vox-select-files-btn");
      const $icon = $btn.find("i");
      $icon.removeClass("fa-cloud-arrow-up").addClass("fa-spinner fa-spin");

      const result = await uploadVoxCpmAudio(file, ttsSettings);

      if (result && result.status === "success") {
        if (window.toastr)
          window.toastr.success(`上传成功: ${result.filename}`);
        // 上传成功后强制清空缓存，下次点击输入框时重新拉取最新列表
        cachedAudioList = null;
      } else {
        if (window.toastr)
          window.toastr.error("音频上传失败，请检查后端运行状态。");
      }

      // 恢复按钮状态，清空 input 以允许重复上传同一文件
      $icon.removeClass("fa-spinner fa-spin").addClass("fa-cloud-arrow-up");
      $(this).val("");
    });

  const $charList = $("#siren-vox-char-list");

  // 当聚焦或输入时触发搜索和下拉菜单展示
  $charList
    .off("focus input", ".siren-vox-audio-input")
    .on("focus input", ".siren-vox-audio-input", async function () {
      const $input = $(this);
      const $resultsContainer = $input.siblings(".siren-vox-search-results");
      const keyword = $input.val().trim().toLowerCase();

      // 1. 如果缓存为空，去后端拉取
      if (cachedAudioList === null) {
        const settings = getSirenSettings();
        const ttsSettings = settings?.tts?.voxcpm || {};
        cachedAudioList = await fetchVoxCpmAudioList(ttsSettings);
      }

      // 2. 根据关键字进行过滤
      const filteredFiles = cachedAudioList.filter((filename) =>
        filename.toLowerCase().includes(keyword),
      );

      // 3. 渲染下拉菜单
      $resultsContainer.empty();
      if (filteredFiles.length > 0) {
        filteredFiles.forEach((filename) => {
          $resultsContainer.append(`
          <div class="siren-vox-search-item" style="padding: 6px 10px; cursor: pointer; color: #cbd5e1; font-size: 0.9em;">
            <i class="fa-solid fa-file-audio" style="margin-right: 5px; color: #38bdf8;"></i>${filename}
          </div>
        `);
        });
        $resultsContainer.slideDown(150);
      } else {
        $resultsContainer.append(`
        <div style="padding: 6px 10px; color: #64748b; font-size: 0.9em; text-align: center;">
          未找到匹配的音频
        </div>
      `);
        $resultsContainer.show();
      }
    });

  // 点击下拉菜单的某一项，填入输入框
  $charList
    .off("click", ".siren-vox-search-item")
    .on("click", ".siren-vox-search-item", function () {
      const filename = $(this).text().trim();
      const $input = $(this)
        .closest(".siren-vox-audio-ui")
        .find(".siren-vox-audio-input");
      const $resultsContainer = $(this).closest(".siren-vox-search-results");

      $input.val(filename);
      $resultsContainer.hide();
    });

  // 点击页面其他空白处，关闭所有打开的下拉菜单
  $(document)
    .off("click.sirenvox")
    .on("click.sirenvox", function (e) {
      if (!$(e.target).closest(".siren-vox-audio-ui").length) {
        $(".siren-vox-search-results").hide();
      }
    });

  // 绑定 ST 切换角色卡时的自动刷新逻辑
  const context = SillyTavern.getContext();
  if (context && context.eventSource) {
    context.eventSource.removeListener("chat_id_changed", loadVoxCpmData);
    context.eventSource.on("chat_id_changed", loadVoxCpmData);
  }

  // 初始化时执行一次数据加载
  loadVoxCpmData();
}

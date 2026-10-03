// scripts/db.js
import { getSirenSettings } from "./settings.js";

const DB_NAME = "SirenVoiceDB";
const STORE_NAME = "TTS_History";
const DB_VERSION = 5;
const AMBIENCE_STORE_NAME = "AMBIENCE_Cache"; // 👈 [新增] Ambience 专属存储库名
const MIMO_CLONE_STORE_NAME = "MIMO_Clone_Assets"; // 👈 [新增] MiMo VoiceClone 本机参考音频资产

/** @type {Map<string, Object[]>} cache of getTtsHistory results keyed by chatId */
const ttsHistoryCache = new Map();

/**
 * 🌟 [修复] 单飞缓存：记录进行中的 getTtsHistory 加载 Promise
 * 聊天进入时 injectScenePlayButtons 会对全楼并发调用 findExactTtsRecord，
 * 若每个并发调用都各自发起一次 DB getAll + Blob 物化，就会在毫秒内同时驻留
 * “消息数 × 历史条数” 份完整音频 → 手机 OOM。单飞让所有并发调用共享同一次加载。
 */
const ttsHistoryLoads = new Map();

/**
 * 🌟 [修复] 轻量元数据表：id -> { id, chatId, isFavorite, timestamp }
 * 仅保存排序/筛选所需的字段，绝不携带音频 ArrayBuffer，
 * 让 enforceHistoryLimit 无需 store.getAll() 加载全部大块音频即可完成清理。
 */
const ttsMeta = new Map();
let ttsMetaHydrated = false;

function invalidateTtsCache() {
  ttsHistoryCache.clear();
  ttsHistoryLoads.clear();
}

/**
 * 🌟 [修复] 只清空单个聊天窗口的缓存，避免全量失效导致的下一次查询重新加载整条历史
 */
function invalidateTtsCacheForChat(chatId) {
  if (chatId === undefined || chatId === null) return;
  ttsHistoryCache.delete(chatId);
  ttsHistoryLoads.delete(chatId);
}

/**
 * 🌟 [修复] 一次性用游标遍历 DB，只抽取轻量元数据（丢弃音频 ArrayBuffer）
 * 之后的所有写入都会增量维护 ttsMeta，绝不再全量加载音频
 */
async function ensureTtsMetaHydrated() {
  if (ttsMetaHydrated) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const r = cursor.value;
          if (r && r.id) {
            ttsMeta.set(r.id, {
              id: r.id,
              chatId: r.chatId || "default",
              isFavorite: !!r.isFavorite,
              timestamp: r.timestamp || 0,
            });
          }
          cursor.continue();
        } else {
          ttsMetaHydrated = true;
          resolve();
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error("[Siren Voice] 💾 初始化 TTS 元数据失败:", err);
    // 元数据失败只影响自动清理，不应阻断主流程
    ttsMetaHydrated = true;
  }
}

/** 🌟 [修复] 供聊天切换时释放跨聊天累积的内存缓存 */
export function clearTtsCache() {
  invalidateTtsCache();
}

/**
 * 初始化并打开数据库
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }

      // 👇 [新增] 创建 Ambience 专属库，用 url 作为主键，完美防跨层重复！
      if (!db.objectStoreNames.contains(AMBIENCE_STORE_NAME)) {
        const ambienceStore = db.createObjectStore(AMBIENCE_STORE_NAME, {
          keyPath: "url",
        });
        ambienceStore.createIndex("timestamp", "timestamp", {
          unique: false,
        });
      }

      // 👇 [新增] 创建 MiMo VoiceClone 资产库，keyPath 为 id。
      // 只在 Store 不存在时创建；不删除已有 Store，不清空旧语音历史。
      if (!db.objectStoreNames.contains(MIMO_CLONE_STORE_NAME)) {
        db.createObjectStore(MIMO_CLONE_STORE_NAME, { keyPath: "id" });
      }

      const ttsStore = event.target.transaction.objectStore(STORE_NAME);
      if (ttsStore && !ttsStore.indexNames.contains("chatId")) {
        ttsStore.createIndex("chatId", "chatId", { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 添加一条 TTS 记录到数据库
 * @param {Object} record - 包含 provider, char, text, floor, audioBlob, chatId 的对象
 *   MiMo 记录可通过 record.cacheKey 携带缓存身份（由 mimo_logic.js 的 buildMimoCacheKey 生成，
 *   写入与查询必须使用同一个 key，见 findExactTtsRecord 的 cacheKey 参数）。
 */
export async function addTtsRecord(record) {
  try {
    const db = await openDB();
    const settings = getSirenSettings();
    const maxLimit = settings?.tts?.history_length ?? 30;

    // 🌟 核心修复 1：将 Blob 降维转换成 ArrayBuffer，彻底解决手机端存取错乱 Bug
    let bufferToStore = record.audioBlob;
    let mimeType = "audio/mpeg"; // 默认兜底
    if (record.audioBlob instanceof Blob) {
      bufferToStore = await record.audioBlob.arrayBuffer();
      mimeType = record.audioBlob.type;
    }

    const newRecord = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      isFavorite: false,
      chatId: record.chatId || "default",
      ...record,
      audioBlob: bufferToStore,
      mimeType: mimeType,
    };

    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const addReq = store.add(newRecord);
      addReq.onsuccess = () => resolve();
      addReq.onerror = (e) => reject(e.target.error);
    });

    // 🌟 [修复] 增量维护轻量元数据，不再依赖全量遍历
    ttsMeta.set(newRecord.id, {
      id: newRecord.id,
      chatId: newRecord.chatId || "default",
      isFavorite: false,
      timestamp: newRecord.timestamp,
    });

    if (maxLimit > 0) {
      await enforceHistoryLimit(db, maxLimit);
    }

    // 🌟 [修复] 只更新当前聊天的缓存（前插），避免整个缓存失效导致下一次查询重新加载全部记录
    const chatCache = ttsHistoryCache.get(newRecord.chatId || "default");
    if (chatCache) {
      const blobForCache =
        bufferToStore instanceof ArrayBuffer
          ? new Blob([bufferToStore], { type: mimeType })
          : bufferToStore;
      chatCache.unshift({ ...newRecord, audioBlob: blobForCache });
      if (chatCache.length > Math.max(maxLimit * 2, 40)) {
        chatCache.length = Math.max(maxLimit * 2, 40);
      }
    }
  } catch (err) {
    console.error("[Siren Voice] 💾 写入 IndexedDB 失败:", err);
  }
}

/**
 * 获取特定聊天窗口的 TTS 历史记录
 * @param {string} chatId - 聊天窗口 ID
 */
export async function getTtsHistory(chatId) {
  try {
    if (ttsHistoryCache.has(chatId)) {
      return ttsHistoryCache.get(chatId);
    }

    // 🌟 [修复] 单飞：若同一 chatId 的加载正在进行中，直接复用该 Promise，
    // 避免全楼并发扫库时每个 findExactTtsRecord 都重复做一次完整 getAll + Blob 物化
    if (ttsHistoryLoads.has(chatId)) {
      return ttsHistoryLoads.get(chatId);
    }

    const loadPromise = new Promise((resolve, reject) => {
      (async () => {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        let request;
        let usedIndex = true;
        try {
          request = store.index("chatId").getAll(IDBKeyRange.only(chatId));
        } catch {
          request = store.getAll();
          usedIndex = false;
        }
        request.onsuccess = () => {
          const raw = request.result;
          const results = (
            usedIndex ? raw : raw.filter((r) => r.chatId === chatId)
          )
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((r) => {
              if (r.audioBlob instanceof ArrayBuffer) {
                r.audioBlob = new Blob([r.audioBlob], {
                  type: r.mimeType || "audio/mpeg",
                });
              }
              return r;
            });
          ttsHistoryCache.set(chatId, results);
          ttsHistoryLoads.delete(chatId);
          resolve(results);
        };
        request.onerror = (e) => {
          ttsHistoryLoads.delete(chatId);
          reject(e.target.error);
        };
      })().catch((e) => {
        ttsHistoryLoads.delete(chatId);
        reject(e);
      });
    });

    ttsHistoryLoads.set(chatId, loadPromise);
    return loadPromise;
  } catch (err) {
    return [];
  }
}

/**
 * 维持数据库数量不超过设定限制（🚨 核心修改：忽略收藏项）
 * 🌟 [修复] 使用轻量元数据表筛选，不再 store.getAll() 加载所有音频 ArrayBuffer
 */
async function enforceHistoryLimit(db, maxLimit) {
  await ensureTtsMetaHydrated();

  const unFavRecords = Array.from(ttsMeta.values())
    .filter((r) => !r.isFavorite)
    .sort((a, b) => a.timestamp - b.timestamp);

  // 如果未收藏的记录超过了限制
  if (unFavRecords.length > maxLimit) {
    const deleteCount = unFavRecords.length - maxLimit;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (let i = 0; i < deleteCount; i++) {
        const meta = unFavRecords[i];
        store.delete(meta.id);
        ttsMeta.delete(meta.id);
        invalidateTtsCacheForChat(meta.chatId);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  }
}

/**
 * 👇 [新增] 删除单条记录
 */
export async function deleteTtsRecord(id) {
  try {
    const db = await openDB();
    const result = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
    // 🌟 [修复] 定向移除，而不是清空全部缓存
    const meta = ttsMeta.get(id);
    ttsMeta.delete(id);
    for (const [chatId, list] of ttsHistoryCache) {
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) ttsHistoryCache.delete(chatId);
        break;
      }
    }
    if (meta) invalidateTtsCacheForChat(meta.chatId);
    return result;
  } catch (err) {
    console.error("[Siren Voice] 💾 删除记录失败:", err);
  }
}

/**
 * 👇 [新增] 切换收藏状态
 */
export async function toggleFavoriteTtsRecord(id, isFavorite) {
  try {
    const db = await openDB();
    const result = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const data = getReq.result;
        if (data) {
          data.isFavorite = isFavorite; // 更新字段
          const putReq = store.put(data);
          putReq.onsuccess = () => resolve();
          putReq.onerror = (e) => reject(e.target.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
    // 🌟 [修复] 同步更新元数据表 + 各聊天缓存里的收藏状态，避免缓存失效重载
    const meta = ttsMeta.get(id);
    if (meta) meta.isFavorite = isFavorite;
    for (const list of ttsHistoryCache.values()) {
      const hit = list.find((r) => r.id === id);
      if (hit) hit.isFavorite = isFavorite;
    }
    return result;
  } catch (err) {
    console.error("[Siren Voice] 💾 切换收藏状态失败:", err);
  }
}

/**
 * 清空历史记录 (这里也修改一下，保留被收藏的)
 */
export async function clearTtsHistory() {
  try {
    const db = await openDB();
    await ensureTtsMetaHydrated();

    const toDelete = Array.from(ttsMeta.values()).filter((r) => !r.isFavorite);
    const affectedChats = new Set(toDelete.map((r) => r.chatId));

    const result = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const meta of toDelete) {
        store.delete(meta.id);
        ttsMeta.delete(meta.id);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });

    // 🌟 [修复] 只清理受影响聊天的缓存，收藏项保留在缓存中
    for (const chatId of affectedChats) {
      const list = ttsHistoryCache.get(chatId);
      if (list) {
        const kept = list.filter((r) => r.isFavorite);
        if (kept.length === 0) {
          ttsHistoryCache.delete(chatId);
        } else {
          ttsHistoryCache.set(chatId, kept);
        }
      }
    }
    return result;
  } catch (err) {
    console.error("[Siren Voice] 💾 清空 IndexedDB 失败:", err);
  }
}

/**
 * 查找特定条件的最新的 TTS 缓存记录 (用于点击直接播放)
 * @param {string} chatId - 当前聊天窗口 ID
 * @param {string|number} floor - 消息楼层 ID
 * @param {string} char - 角色名
 * @param {string} text - 语音文本
 * @param {string} mood - 情绪 (新增)
 * @param {string} detail - 情绪细节 (新增)
 * @param {string|null} cacheKey - [MiMo] 可选的缓存身份。
 *   只有调用方明确传入 MiMo cacheKey 时，才要求记录中的 provider/cacheKey 完全相同
 *   （叠加原有的 floor/chatId 匹配）；不带该参数的旧调用保持原有字段匹配语义。
 */
export async function findExactTtsRecord(
  chatId,
  floor,
  char,
  text,
  mood = "",
  detail = "",
  cacheKey = null,
) {
  try {
    const history = await getTtsHistory(chatId);
    const match = history.find(
      (r) =>
        String(r.floor) === String(floor) &&
        (cacheKey
          ? // 🌟 [MiMo] 严格身份匹配：Provider + CacheKey（内含 model/voiceKey/Clone revision/文本/stylePrompt）
            r.provider === "mimo" && r.cacheKey === cacheKey
          : r.char === char &&
            r.text === text &&
            (r.mood || "") === mood &&
            (r.detail || "") === detail),
    );

    if (match) {
      // 🌟 核心修复 2：如果拿出来的是 ArrayBuffer，就在内存里当场捏成 Blob 还给调度器
      if (match.audioBlob instanceof ArrayBuffer) {
        match.audioBlob = new Blob([match.audioBlob], {
          type: match.mimeType || "audio/mpeg",
        });
      }
      return match;
    }
    return null;
  } catch (err) {
    console.error("[Siren Voice] 💾 查找精确 TTS 缓存失败:", err);
    return null;
  }
}

/**
 * 👇 [新增] 获取 Ambience 缓存
 * 在 ambience_logic.js 播放前调用，命中则直接用 Blob，并顺手更新一下活跃时间戳
 */
export async function getAmbienceRecord(url) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AMBIENCE_STORE_NAME, "readwrite"); // 使用 readwrite 以便顺手更新时间
      const store = transaction.objectStore(AMBIENCE_STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          // 如果被读取了，就更新时间戳，防止被 LRU 误杀
          record.timestamp = Date.now();
          store.put(record);
        }
        resolve(record);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error("[Siren Voice] 💾 读取 Ambience 缓存失败:", err);
    return null;
  }
}

/**
 * 👇 [新增] 保存 Ambience 缓存，并自动触发 LRU 清理
 */
export async function saveAmbienceRecord(url, audioBlob) {
  try {
    const db = await openDB();
    const MAX_AMBIENCE_CACHE = 20; // 👈 设定最大缓存数量，超过则淘汰最旧的

    const record = {
      url: url,
      audioBlob: audioBlob,
      timestamp: Date.now(), // 存入时打上时间戳
    };

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(AMBIENCE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(AMBIENCE_STORE_NAME);
      // 使用 put：如果存在同样的 url，会自动覆盖并更新 Blob 和 timestamp
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });

    // 保存完毕后，触发容量检测
    await enforceAmbienceLimit(db, MAX_AMBIENCE_CACHE);
  } catch (err) {
    console.error("[Siren Voice] 💾 写入 Ambience 缓存失败:", err);
  }
}

/**
 * 👇 [新增] Ambience 容量限制清理逻辑
 */
async function enforceAmbienceLimit(db, maxLimit) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AMBIENCE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AMBIENCE_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result;

      // 如果数量超标，则按时间从小到大排序 (旧 -> 新)
      if (records.length > maxLimit) {
        records.sort((a, b) => a.timestamp - b.timestamp);

        const deleteCount = records.length - maxLimit;
        for (let i = 0; i < deleteCount; i++) {
          store.delete(records[i].url);
          console.log(
            `[Siren Voice] 🗑️ Ambience 缓存超过 ${maxLimit} 首，已自动清理最旧音频`,
          );
        }
      }
      resolve();
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 👇 [新增] MiMo VoiceClone 资产 CRUD（本机 IndexedDB 专用，与 TTS 历史数据职责分离）
 * 资产结构: { id, name, mimeType, dataUrl, byteLength, createdAt, updatedAt, revision }
 */

/** 保存（新增或整体替换）一条 Clone 资产 */
export async function saveMimoCloneAsset(asset) {
  if (!asset || !asset.id) {
    throw new Error("MiMo Clone 资产缺少 id，无法保存");
  }
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(MIMO_CLONE_STORE_NAME, "readwrite");
    const request = transaction.objectStore(MIMO_CLONE_STORE_NAME).put(asset);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
  return asset;
}

/** 按 id 读取一条 Clone 资产，不存在时返回 null */
export async function getMimoCloneAsset(id) {
  if (!id) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(MIMO_CLONE_STORE_NAME, "readonly");
      const request = transaction.objectStore(MIMO_CLONE_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error("[Siren Voice] 💾 读取 MiMo Clone 资产失败:", err);
    return null;
  }
}

/** 列出全部 Clone 资产（按更新时间倒序） */
export async function listMimoCloneAssets() {
  try {
    const db = await openDB();
    const records = await new Promise((resolve, reject) => {
      const transaction = db.transaction(MIMO_CLONE_STORE_NAME, "readonly");
      const request = transaction.objectStore(MIMO_CLONE_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
    return records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.error("[Siren Voice] 💾 列出 MiMo Clone 资产失败:", err);
    return [];
  }
}

/** 删除一条 Clone 资产，返回是否删除成功 */
export async function deleteMimoCloneAsset(id) {
  if (!id) return false;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(MIMO_CLONE_STORE_NAME, "readwrite");
      const request = transaction
        .objectStore(MIMO_CLONE_STORE_NAME)
        .delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
    return true;
  } catch (err) {
    console.error("[Siren Voice] 💾 删除 MiMo Clone 资产失败:", err);
    return false;
  }
}

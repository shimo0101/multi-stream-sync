/**
 * 配信開始時刻を基準にした手動同期マネージャー。
 *
 * 同期の考え方:
 *   基準プレイヤーの「配信開始時刻 + 現在再生位置」= 実時間での現在地点
 *   ターゲットの再生位置 = 実時間現在地点 - ターゲットの配信開始時刻
 *
 *   例:
 *     YT 配信開始 20:30:00、再生位置 600s → 実時間 20:40:00
 *     TW 配信開始 20:32:00 → TW は (20:40:00 - 20:32:00) = 480s にシーク
 */
export class SyncManager {
  #players = {};
  #startTimeSecs = {};

  /**
   * @param {'yt'|'tw'} id
   * @param {{ getCurrentTime(): number|null, seekTo(s: number): void, isReady(): boolean }} player
   */
  registerPlayer(id, player) {
    this.#players[id] = player;
  }

  /**
   * 配信開始時刻を登録する。
   * @param {'yt'|'tw'} id
   * @param {string} hms - "HH:MM:SS" 形式
   * @returns {boolean} パース成功かどうか
   */
  setStartTime(id, hms) {
    const secs = parseHMS(hms);
    if (secs === null) return false;
    this.#startTimeSecs[id] = secs;
    return true;
  }

  /**
   * 同期を実行する。
   * @param {'yt'|'tw'} referenceId - 基準にするプレイヤー
   * @param {'yt'|'tw'} targetId    - シーク対象のプレイヤー
   * @returns {{ ok: boolean, message: string }}
   */
  sync(referenceId, targetId) {
    const ref = this.#players[referenceId];
    const tgt = this.#players[targetId];

    if (!ref?.isReady())
      return { ok: false, message: `${referenceId.toUpperCase()} プレイヤーが未準備です` };
    if (!tgt?.isReady())
      return { ok: false, message: `${targetId.toUpperCase()} プレイヤーが未準備です` };

    if (this.#startTimeSecs[referenceId] == null)
      return { ok: false, message: `${referenceId.toUpperCase()} の配信開始時刻が未設定です` };
    if (this.#startTimeSecs[targetId] == null)
      return { ok: false, message: `${targetId.toUpperCase()} の配信開始時刻が未設定です` };

    const refPos = ref.getCurrentTime();
    if (refPos === null)
      return { ok: false, message: '再生位置を取得できませんでした' };

    const realTimeSecs = this.#startTimeSecs[referenceId] + refPos;
    const targetPos = realTimeSecs - this.#startTimeSecs[targetId];

    if (targetPos < 0) {
      const diff = Math.abs(Math.round(targetPos));
      return { ok: false, message: `同期先はまだその時刻に達していません（${formatHMS(diff)} 前）` };
    }

    tgt.seekTo(targetPos);
    return {
      ok: true,
      message: `同期完了 ─ ${targetId.toUpperCase()} を ${formatHMS(targetPos)} にシークしました`,
    };
  }
}

/** "HH:MM:SS" → 総秒数。不正な形式は null を返す */
function parseHMS(str) {
  if (!str?.trim()) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [h, m, s] = parts;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/** 総秒数 → "H:MM:SS" */
function formatHMS(totalSecs) {
  const t = Math.floor(totalSecs);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

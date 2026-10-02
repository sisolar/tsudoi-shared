// VAPID Web Push の送信（docs/web-push-decisions.md「サーバー側」）。暗号化（RFC 8291 aes128gcm）と
// VAPID 署名（RFC 8292）は Cloudflare Workers 対応の @block65/webcrypto-web-push に委ねる
// （Node 依存の web-push は Workers で動かないため。Web Crypto だけで実装されたこのライブラリを使う）。
// このモジュールは「1 購読へ 1 回送る」薄いラッパーで、宛先の列挙・掃除・プラットフォーム振り分けは
// サーバーの push.ts（sendPush）が持つ（SQL と配線は push.ts へ集約する既存作法）。shared へ置くのは
// 消費側の出所を一本化するため（ただし実際の利用はサーバーのみ）。
import {
  buildPushPayload,
  type PushMessage as LibPushMessage,
  type PushSubscription as LibPushSubscription,
  type VapidKeys as LibVapidKeys,
} from '@block65/webcrypto-web-push';

// 購読 1 件（web_push_subscription 由来）。endpoint と購読の鍵を持つ。
export type WebPushTarget = {
  endpoint: string;
  p256dh: string; // base64url
  auth: string; // base64url
};

// VAPID 鍵・連絡先。サーバー（push.ts）が env から詰めて渡す（ライブラリの VapidKeys と同形）。
export type VapidKeys = LibVapidKeys;

// 1 件の送信結果。ok=受理（2xx）。gone=無効購読（404/410。掃除対象）。それ以外は失敗（ok/gone とも false）。
export type WebPushSendResult = {
  ok: boolean;
  gone: boolean;
};

// 1 購読へ Web Push を送る。payload は通知の JSON 文字列（SW が読む）。ttl は秒。
// 戻り値で ok / gone（404・410＝掃除対象）を返す。例外は投げず結果に倒す（1 件失敗で全体を止めない）。
export async function sendWebPush(
  target: WebPushTarget,
  payload: string,
  vapid: VapidKeys,
  ttlSeconds: number,
): Promise<WebPushSendResult> {
  try {
    const subscription: LibPushSubscription = {
      endpoint: target.endpoint,
      expirationTime: null,
      keys: { p256dh: target.p256dh, auth: target.auth },
    };
    const message: LibPushMessage = { data: payload, options: { ttl: ttlSeconds } };

    // buildPushPayload が暗号化・VAPID 署名を済ませた { method, headers, body } を返す。そのまま fetch へ。
    const init = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(target.endpoint, init);

    // 404 / 410 は購読が失効・削除された印。掃除対象として gone を立てる。
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
    // 2xx は受理。それ以外（4xx/5xx）は今回は諦める（再送・レシート確認はスコープ外）。
    return { ok: res.ok, gone: false };
  } catch {
    // ネットワーク・鍵不正等の失敗。このバッチは諦める（掃除は次回送信で拾える）。
    return { ok: false, gone: false };
  }
}

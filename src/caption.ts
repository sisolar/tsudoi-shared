// 自分の声の字幕（docs/livekit-decisions.md D32）の純粋関数・定数・メッセージの型。
// サーバー（Caption DO）とアプリで 1 つの実装を共有する。特定ランタイム（Workers / React Native）に依存しない。
//
// 音声の契約: アプリは「16kHz・16bit・リトルエンディアン・mono」の PCM を、WebSocket のバイナリメッセージで送る。
// サーバーはリサンプリングしない（Azure Speech SDK の入力口を 16kHz・16bit・mono で作るため）。
// 形式の変換が要る端末（48kHz などで取れる場合）は、アプリ側で 16kHz に落としてから送る。
// 発話の区切りは Azure Speech SDK のリアルタイム認識がサービス側で行うため、無音検出などは持たない。

// ---- 音声の形式（契約）----------------------------------------------------------------------------

export const CAPTION_SAMPLE_RATE = 16000;
export const CAPTION_BITS_PER_SAMPLE = 16;
export const CAPTION_CHANNELS = 1;

// 1 回に受け付ける音声メッセージの最大バイト数。16kHz・16bit・mono は 1 秒で 32,000 バイトなので、
// 約 4 秒ぶん。異常に大きいメッセージ（誤送信・攻撃）で DO のメモリを使い切らせないための上限。
export const CAPTION_MAX_AUDIO_MESSAGE_BYTES = 128 * 1024;

// ---- 字幕メッセージの本文 ------------------------------------------------------------------------

// 字幕 1 件の本文の最大長。認識結果は外部サービスの値なので、長さを制限して保存する。
export const CAPTION_TEXT_MAX_LENGTH = 500;

// 認識結果の文字列を、字幕メッセージの本文として整える。空（無音・認識できず）や型不正なら null。
// 前後の空白を落とし、CAPTION_TEXT_MAX_LENGTH を超えたら切り捨てる。
export function normalizeCaptionText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim().slice(0, CAPTION_TEXT_MAX_LENGTH);
  return text ? text : null;
}

// ---- WebSocket のメッセージ（Caption DO → アプリ。JSON のテキストメッセージ）--------------------------------

// 話している最中の途中経過。送り主の接続にだけ返す（他の人には届かない。保存もしない）。
export type CaptionPartialMessage = { type: 'partial'; text: string };

// 確定した文を、チャットのメッセージとして保存したことの通知（送り主の画面で「認識中」を消すのに使う）。
export type CaptionFinalMessage = { type: 'final'; text: string };

// 字幕を続けられなくなった。この後サーバーは接続を閉じる。reason は画面の出し分けに使う。
//  - unavailable: サーバー側の設定が無い（Azure のキー等）
//  - recognizer_failed: 認識サービスとの接続に失敗した・認証に失敗した・上限に達した
//  - idle_timeout: 音声が一定時間届かず、サーバーが閉じた
//  - bad_audio: 契約外の音声（大きすぎるメッセージなど）が届いた
export type CaptionErrorReason = 'unavailable' | 'recognizer_failed' | 'idle_timeout' | 'bad_audio';
export type CaptionErrorMessage = { type: 'error'; reason: CaptionErrorReason };

export type CaptionServerMessage = CaptionPartialMessage | CaptionFinalMessage | CaptionErrorMessage;

// 受け取った JSON を CaptionServerMessage として読む。壊れ・未知の type は null（クライアントは無視する。前方互換）。
export function parseCaptionServerMessage(raw: unknown): CaptionServerMessage | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if ((m.type === 'partial' || m.type === 'final') && typeof m.text === 'string') {
    return { type: m.type, text: m.text };
  }
  if (
    m.type === 'error' &&
    (m.reason === 'unavailable' ||
      m.reason === 'recognizer_failed' ||
      m.reason === 'idle_timeout' ||
      m.reason === 'bad_audio')
  ) {
    return { type: 'error', reason: m.reason };
  }
  return null;
}

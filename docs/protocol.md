# Soundcore P30i (A3959) プロトコルメモ

openscq30-lib の実装から読み解いた内容を、ウェブ移植の際の参照用に整理したものです。
一次情報は本家リポジトリの `lib/src/devices/soundcore/` です。

- 本家: https://github.com/Oppzippy/OpenSCQ30
- 該当機種: `lib/src/devices/soundcore/a3959.rs`, `a3959/`
- 共通層: `lib/src/devices/soundcore/common/`

## 1. トランスポート

Bluetooth Classic の **RFCOMM**。サービス UUID は機種によって異なり、本家は次の戦略を取ります。

```
VENDOR_RFCOMM_UUID       = 0cf12d31-fac3-4553-bd80-d6832e700000
VENDOR_RFCOMM_UUID_MASK  = ffffffff-ffff-ffff-ffff-fffffff00000
RFCOMM_UUID (標準 SPP)   = 00001101-0000-1000-8000-00805f9b34fb
```

`RfcommServiceSelectionStrategy::Dynamic` は「マスクを適用して一致するベンダー UUID があればそれ、
なければ標準 SPP」を選びます。A3116（Motion+）は `0cf12d31-fac3-4553-bd80-d6832e7b3116` 固定で、
下位 20 bit に型番が入っているように見えます（A3959 なら `...d6832e7b3959` と推定）。

ブラウザからは **Web Serial API** 経由で RFCOMM にアクセスします。

```js
const uuids = ["0cf12d31-fac3-4553-bd80-d6832e7b3959"]; // 対応機種のサービスのみ
const port = await navigator.serial.requestPort({
  // filters が選択ダイアログに「出すもの」を決める
  filters: uuids.map((bluetoothServiceClassId) => ({ bluetoothServiceClassId })),
  // 非標準 UUID は allowlist に入れないとそもそも候補にならない
  allowedBluetoothServiceClassIds: uuids,
});
await port.open({ baudRate: 9600 }); // RFCOMM では baudRate は無視される
```

`filters` と `allowedBluetoothServiceClassIds` に**同じ UUID 集合**を渡すのがポイントです。
前者だけだと非標準サービスが候補にならず、後者だけだと対応外の機器（USB シリアルや他機種の
SPP ポート）まで一覧に出てしまいます。ワイルドカードは使えないため、本アプリでは
「推定ベンダー UUID + ユーザーが追加した UUID（+ オプトインの標準 SPP）」をこの集合としています。

## 2. パケット形式

```
+----------------+---------+----------+--------+----------+
| direction (5B) | cmd (2B)| length(2)| body   |checksum  |
+----------------+---------+----------+--------+----------+
  outbound: 08 ee 00 00 00
  inbound : 09 ff 00 00 01
```

- `length`: little endian。**direction + command + length + body + checksum** を含んだ全長
- `checksum`: チェックサムを除いた全バイトの加算（wrapping u8）
- A3959 は `ChecksumKind::Suffix`（チェックサムあり）
- 受信はストリームなので、フラグメント分割・複数パケットの連結の両方が起こり得ます。
  解析に失敗した場合はバッファを捨てて再同期します

ACK は「同じコマンド・body 空・逆向き direction」のパケットです。
送信は最大 3 回リトライし、待機時間は `500ms × 試行回数` です。

例（状態要求）:

```
08 ee 00 00 00 01 01 0a 00 02
```

## 3. コマンド一覧（A3959）

### 送信（アプリ → 機器）

| command | 名前 | body |
| --- | --- | --- |
| `01 01` | RequestState | なし |
| `06 81` | SetSoundModes | sound modes 7 バイト（下記） |
| `02 83` | SetEqualizerWithDrc | EQ 設定 12 バイト + DRC 適用後 10 バイト |
| `04 81` | SetButtonAction | `[side, button id, action byte]` |
| `04 82` | ResetButtonsToDefault | なし |
| `04 83` | SetButtonEnabled | `[side, button id, enabled]`（A3959 は未使用） |
| `04 84` | SetAllButtons | 全ボタン（A3959 は非対応） |
| `06 82` | SetAmbientSoundModeCycle | `[bit flags]` |
| `01 86` | SetAutoPowerOff | `[enabled, duration index]` |
| `01 83` | SetTouchTone | `[bool]` |
| `01 87` | SetGamingMode | `[bool]` |
| `02 86` | SetSurroundSound | `[bool]` |
| `10 82` | SetLowBatteryPrompt | `[bool]` |
| `0b 01` | RequestDualConnectionsDevices | なし（複数応答） |
| `0b 81` / `0b 82` / `0b 83` | DualConnections 切断 / 接続 / 削除 | `[mac 6 バイト]` |
| `0b 84` | SetDualConnectionsEnabled | `[bool]` |

### 受信（機器 → アプリ、非要求）

| command | 名前 | body |
| --- | --- | --- |
| `01 01` | 状態更新 | 91 バイト（下記） |
| `01 02` | TWS 状態 | `[host device, connected]` |
| `01 03` | バッテリー残量 | `[left, right]`（+ 未知の 2 バイトが続く場合あり） |
| `01 04` | 充電状態 | `[left, right]` |
| `01 05` | シリアル番号とファームウェア | `[fw left 5B][fw right 5B][serial 16B]` |
| `01 11` | ゲームモード | `[bool]` |
| `06 01` | サウンドモード更新 | sound modes 7 バイト |
| `0b 01` | デュアル接続デバイス一覧 | `[total, index, ...devices]` |

## 4. 状態更新パケット（91 バイト）

| offset | 長さ | フィールド |
| --- | --- | --- |
| 0 | 1 | host device（0=左, 1=右） |
| 1 | 1 | TWS 接続（bool） |
| 2 | 2 | バッテリー残量（左, 右）。`255` は「その側は未接続」 |
| 4 | 2 | 充電状態（左, 右） |
| 6 | 10 | ファームウェア（左 5B + 右 5B, `"01.64"` 形式 ASCII）。全 0 / 全 255 は欠落 |
| 16 | 16 | シリアル番号（ASCII 英数字） |
| 32 | 2 | EQ プリセット ID（little endian）。`0xfefe` = カスタム |
| 34 | 10 | EQ 10 バンド。byte = dB×10 + 120。先頭が `0xff` ならチャンネル無し |
| 44 | 10 | 未知 |
| 54 | 1 | 未知 |
| 55 | 8 | ボタン設定（1 バンド 1 ボタン、下位 nibble = TWS 接続時、上位 = 非接続時） |
| 63 | 1 | モード循環のビットフラグ（bit0=NC, bit1=外音取り込み, bit2=標準） |
| 64 | 7 | サウンドモード（下記） |
| 71 | 1 | 未知 |
| 72 | 1 | 操作音（bool） |
| 73 | 1 | デュアル接続 有効（bool） |
| 74 | 1 | サラウンドサウンド（bool） |
| 75 | 2 | オートパワーオフ（enabled, 期間 index: 0=10分,1=20分,2=30分,3=60分） |
| 77 | 1 | 電池残量低下の通知音（bool） |
| 78 | 1 | ゲームモード（bool）。ファームウェア 01.60 以上でのみ有効 |
| 79 | 12 | 未知 |

### サウンドモード 7 バイト

| index | 内容 |
| --- | --- |
| 0 | 環境サウンドモード（0=NC, 1=外音取り込み, 2=標準） |
| 1 | `(手動 ANC << 4) \| アダプティブ ANC`（どちらも 1〜5） |
| 2 | 環境サウンドモードの再掲（無視） |
| 3 | ANC モード（0=手動, 1=アダプティブ, 2=マルチシーン） |
| 4 | 風切り音（bit0=低減 ON, bit1=検出中） |
| 5 | アダプティブ ANC 感度レベル（0〜10 のほか 255 が観測されている） |
| 6 | マルチシーン ANC（0=交通機関, 1=屋外, 2=屋内） |

### サウンドモード遷移（migration）

機器は公式アプリが行わない遷移を嫌うため、本家は依存関係を木で表し、BFS で
「1 フィールドずつ変化する中間状態列」を求めて、その都度 `06 81` を送ります。

```
ambientSoundMode                       (root)
└─ noiseCancelingMode                  ambient == NoiseCanceling のときのみ変更可
   ├─ adaptiveNoiseCanceling           ncMode == Adaptive のときのみ
   ├─ manualNoiseCanceling             ncMode == Manual のときのみ
   └─ multiSceneAnc                    ncMode == MultiScene のときのみ
windNoise                              ambient ∈ {NoiseCanceling, Transparency} のときのみ
sensitivityLevel                       (root)
```

例: `manual` のまま `multiSceneAnc` を変えると、
`ncMode=multiScene` → `multiSceneAnc=<値>` → `ncMode=manual`（元の値に戻す）の 3 パケットになります。
実装は `src/lib/migration.ts` と `src/devices/a3959/soundModes.ts`。

## 5. ボタン設定

A3959 の定義（`BUTTON_CONFIGURATION_SETTINGS`）:

- 解析順: 左1回, 右1回, 左2回, 右2回, 左3回, 右3回, 左長押し, 右長押し
- button id: 1回=2, 2回=0, 3回=5, 長押し=1
- enabled フラグは無し（`EnabledFlagKind::None`）。**action が `0xf` なら無効**
- action byte: 下位 nibble = TWS 接続時、上位 nibble = TWS 非接続時
- `SetButtonAction` の body: `[side(0=左,1=右), button id, action byte]`

アクション ID:

| id | 動作 |
| --- | --- |
| 0 | 音量アップ |
| 1 | 音量ダウン |
| 2 | 前の曲 |
| 3 | 次の曲 |
| 4 | 環境サウンドモード切替 |
| 5 | 音声アシスタント |
| 6 | 再生／一時停止 |
| 9 | ゲームモード（A3959 の選択肢には含まれない） |
| 0xf | 無効 |

例: 左1回タップを「音量アップ」にする（TWS 接続時は 0、非接続時は現状維持 0xf）→ `[0, 2, 0xf0]`

## 6. イコライザーと DRC

- 10 バンドだが UI に出すのは先頭 8 バンド（100, 200, 400, 800, 1600, 3200, 6400, 12800 Hz）
- 値の範囲は -120〜134（= -12.0〜+13.4 dB、小数 1 桁）
- プリセットは 22 種類（ID 0〜21）、カスタムは `0xfefe`
- 9, 10 バンド目は、プリセット適用時はプリセット値（通常 `0` と `-120`）、
  ユーザーが 8 バンドを編集した場合は固定値 `[0, 0]`
- `02 83` の body は **生の値 12 バイト + DRC 適用後 10 バイト**

DRC は 8×8 の係数行列を使った補正で、`src/lib/structures/equalizer.ts` の `applyDrc` に移植しています。
本家のテストベクタ（`volume_adjustments.rs` の `it_matches_expected_drc_values`）を
`tests/equalizer.test.ts` でそのまま検証しています。

カスタムプロファイルのインポート／エクスポート形式はデスクトップ版と互換です:

```json
[{ "name": "My EQ", "volumeAdjustments": [-6, 6, 2.3, 12, 2.2, -12, -0.4, 1.6] }]
```

## 7. デュアル接続（マルチポイント）

- `0b 01` を送ると `[total packets, current index, ...devices]` が**複数パケット**で返ります
  （上限 20 パケット、2 秒無応答で打ち切り）
- デバイス 1 件: `[length, connected bool, mac 6 バイト, 名前（0 パディング, 最大 32 バイト)]`、
  `length` は自分自身を含めた残り長（名前長 = `length - 8`）
- 接続／切断は `0b 82` / `0b 81` に MAC を付けて送る（応答を待たない）。同時に接続できるのは 2 台まで
- 一覧から消した機器には `0b 83`（forget）を送る

## 8. 実機ログの採取

本アプリの「通信ログ」を開くと送受信パケットが 16 進で表示されます。
未知のファームウェアで接続に失敗する場合、この 16 進（特に `01 01` の応答）を
本家リポジトリの issue に貼ると解析が進みます（本家には
`docs/capture-bluetooth-logs.md` と Wireshark プラグインもあります）。

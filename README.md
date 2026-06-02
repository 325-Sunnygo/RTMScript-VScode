# RTM Script Helper (vscord-rtm)

RealTrainMod (RTM) のモデルパック用 **ES5 / Rhino スクリプト**を VSCode で書きやすくする拡張機能です。

- 🔴 **構文ミスを赤で表示** — ES5 として解析し、文法エラーに波線を出します
- ⌨️ **補完候補** — RTM / NGTLib のクラス・メソッド、難読メソッド (`func_xxxxx_x`)、`importPackage`、`init` / `render` / `onUpdate` などのコールバックを候補に
- ⇥ **Tab で補完確定** — 候補が出ている状態で Tab（または Enter）で確定
- 🔀 **左サイドバーで 1.12.2 / 1.7.10 を切替** — 切替えると補完候補がそのバージョンの API に切り替わります

補完データは、お手元のデコンパイル済みソースから生成しています:

| バージョン | 生成元 |
|---|---|
| **1.12.2** | `RTM2.4.24-43_forge-1.12.2` + `NGTLib2.4.21-38_forge-1.12.2`(デコンパイル) |
| **1.7.10** | `KaizPatchX-master`(ソース) |

---

## 使い方(デバッグ実行)

1. このフォルダ (`vscord_rtm`) を VSCode で開く
2. 依存をインストール
   ```bash
   npm install
   ```
3. `F5`(または「実行とデバッグ」→「拡張機能を実行」)を押す
   → 拡張機能がロードされた新しい VSCode ウィンドウが開きます
4. その新ウィンドウで RTM の `.js` スクリプトを開く
5. 左端のアクティビティバーに **🚆 RTM Script** アイコンが出ます。ここで **1.12.2 / 1.7.10 を切替**

> Tab 補完を確実にしたい場合は、設定 `editor.tabCompletion` を `on` にしておくと、
> 候補が無いときでも単語の Tab 補完が効きます(候補表示中はデフォルトで Tab/Enter 確定できます)。

## インストール(.vsix にして常用する)

```bash
npm install -g @vscode/vsce   # 初回のみ
vsce package                  # vscord-rtm-0.1.0.vsix が生成される
```
できた `.vsix` を VSCode の拡張機能ビュー右上「…」→「VSIX からのインストール」で導入。

---

## 補完が出る場面

| 入力中の状況 | 出る候補 |
|---|---|
| `importPackage(Packages.jp.ngt.rtm.` | パッケージ階層 + クラス名 |
| `new Pa` | クラス名(`Parts` など) |
| `renderer.` | `VehiclePartsRenderer` のメソッド(`registerParts` 等)+ 全メソッド + `func_` |
| `entity.` | `EntityTrainBase` / `EntityVehicleBase` のメソッド + 難読メソッド |
| `dataMap.` `formation.` `scriptExecuter.`(`su.`) | それぞれの型のメンバー |
| 行頭など通常位置 | `init` / `render` / `onUpdate` スニペット、`importPackage`、グローバル変数、クラス名 |

`renderer` / `entity` / `dataMap` / `formation` / `scriptExecuter`(`su`)/ `world` は
RTM がスクリプトに渡す組込みオブジェクトとして型を推定し、優先的に候補へ出します。
それ以外の `obj.` でも、全クラス横断のメソッド名と難読メソッドが候補に出ます
(VSCode が前方一致で絞り込みます)。

## 設定 (`settings.json`)

| キー | 既定 | 説明 |
|---|---|---|
| `rtmScript.version` | `1.12.2` | 補完・チェックに使うバージョン(サイドバーからも変更可) |
| `rtmScript.ecmaVersion` | `5` | 構文チェックの ECMAScript バージョン。RTM は基本 ES5 |
| `rtmScript.enableDiagnostics` | `true` | 構文エラーの赤表示 ON/OFF |
| `rtmScript.activateOnlyInRtmScripts` | `false` | `true` で、RTM らしい記述を含む `.js` のみ有効化 |

---

## 補完データの再生成

別バージョンの jar をデコンパイルした等でデータを作り直す場合:

1. [tools/extract.js](tools/extract.js) 冒頭の `SOURCES` をソースの場所に合わせる
2. 実行:
   ```bash
   node tools/extract.js
   ```
   → `data/api-1.12.2.json` / `data/api-1.7.10.json` を再生成します。

抽出内容: 各クラスの `public` メソッド/フィールド、パッケージ階層、ソース中で使われている
難読メソッド (`func_…`) / 難読フィールド (`field_…`)。

## テスト

vscode をスタブして主要ロジックを検証:
```bash
node test/smoke.js
```

---

## 構成

```
vscord_rtm/
├── package.json          拡張機能マニフェスト
├── extension.js          エントリポイント(状態管理・各機能の登録)
├── src/
│   ├── apiIndex.js        api-*.json の読込・索引化、組込みグローバル定義
│   ├── completion.js      補完プロバイダ
│   ├── diagnostics.js     acorn による ES5 構文チェック
│   └── versionView.js     左サイドバーの TreeView(バージョン切替・情報)
├── data/
│   ├── api-1.12.2.json    1.12.2 の API データ
│   └── api-1.7.10.json    1.7.10 の API データ
├── tools/extract.js      デコンパイルソース → api-*.json 生成ツール
├── test/smoke.js         ロジック検証
└── media/rtm.svg         アクティビティバーアイコン
```

## 注意

- 構文チェックは **構文(文法)のみ**で、未定義変数の検出はしません(Rhino の `importPackage` などで
  実行時に注入される変数を誤検知しないため)。
- `func_…` 難読メソッドは「ソース中での使用箇所」から収集しているため、所属クラスは目安です。

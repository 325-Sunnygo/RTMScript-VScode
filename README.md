# RTM Script Helper

RealTrainMod (RTM) のモデルパック用 ES5 / Rhino スクリプトを VSCode で書きやすくする拡張機能です。

- 構文ミスを赤い波線で表示します(ES5 として解析)
- RTM / NGTLib のクラス・メソッド、難読メソッド (`func_xxxxx_x`)、`importPackage`、`init` / `render` / `onUpdate` などのコールバックを補完します
- メソッドの戻り値の型をたどって、チェーンの続きを補完します(**継承メソッドも含む**)
- `renderer` は先頭の `var renderClass = "..."` を読んで正しい型で補完します
- `GL11.`(OpenGL)や難読名の**意味**(`field_70177_z` → rotationYaw など)も出します
- メソッドの `(` で**引数ヒント**、識別子に**ホバー**で説明
- `init`/`render`/`onUpdate` を正しく書いた**雛形をコマンドで挿入**できます
- 左サイドバーで 1.12.2 / 1.7.10 を切り替えると、補完候補がそのバージョンの API に変わります

補完データは、それぞれ次のソースから生成しています。

| バージョン | 生成元 |
|---|---|
| 1.12.2 | RTM 2.4.24 (forge-1.12.2) + NGTLib 2.4.21 |
| 1.7.10 | KaizPatchX |

---

## 使い方

### 有効になる範囲(普通のJS開発を妨げません)

既定では、**RTM スクリプトと判断できる `.js` のときだけ**補完・構文チェックが働きます。判定はいずれか:

- 中身に RTM 特有の記述がある(`importPackage(` / `Packages.` / `renderer` / `registerParts` / `function onUpdate(` など)
- `scripts` フォルダ配下にある(RTM モデルパックの `assets/.../scripts`)
- ファイル名が `Render_…` `Server_…` `Sound_…` `ANSL_…` などの RTM らしい名前

そのため、普通の(モダンな)JavaScript ファイルでは ES5 エラーや RTM 補完は出ません。
全ての `.js` で常に有効化したい場合は、設定 `rtmScript.activateOnlyInRtmScripts` を `false` にします。

### RTM 専用モード(候補をすっきりさせる)

RTM らしい `.js` を開くと、自動で **「RTM Script」言語モード**に切り替わります(右下の言語表示が
`RTM Script` になります)。このモードでは VSCode 標準の DOM/ブラウザ API 候補(`RTCPeerConnection` や
`document` など RTM と無関係なもの)が出なくなり、候補が RTM 中心になります。

- 自動切替を止めたいとき: 設定 `rtmScript.autoRtmLanguageMode` を `false`
- 手動で切り替え: コマンド `RTM: このファイルを RTM 専用モードで開く` / `RTM: 通常の JavaScript に戻す`
  (右下の言語表示クリックでも変更できます)

なお Tab キーで候補が勝手に確定しないようにしています。候補は一覧が出ている状態で
**↑↓ で選んで Enter** で確定、**Tab はインデント**に使えます。

### バージョンの切り替え

左端のアクティビティバーにある **RTM Script** アイコンを開くと、バージョン切り替えビューがあります。
**1.12.2** / **1.7.10** をクリックすると、補完・構文チェックがそのバージョンに切り替わります
(右下のステータスバーの `RTM 1.12.2` をクリックしても切り替わります)。

### 補完

入力すると候補が自動で表示されます。**Tab** または **Enter** で確定します。

| 入力中の状況 | 出る候補 |
|---|---|
| `importPackage(Packages.jp.ngt.rtm.` | パッケージ階層 + クラス名 |
| `new Pa` | クラス名(`Parts` など) |
| `renderer.` | `VehiclePartsRenderer` のメソッド(`registerParts` など)+ 全メソッド + 難読メソッド |
| `entity.` | `EntityTrainBase` / `EntityVehicleBase` のメソッド + 難読メソッド |
| `dataMap.` `formation.` `scriptExecuter.`(`su.`) | それぞれの型のメンバー |
| 行頭など通常位置 | `init` / `render` / `onUpdate` スニペット、`importPackage`、グローバル変数、クラス名 |

`renderer` / `entity` / `dataMap` / `formation` / `scriptExecuter`(`su`)/ `world` は
RTM がスクリプトに渡す組込みオブジェクトとして型を推定し、優先的に候補へ出します。

### チェーン補完(戻り値の型をたどる)

メソッドの戻り値の型を自動で判別し、その続きを補完します。

```js
ItemWithModel.getModelState(stack).getResourceName()
//             ^ ResourceState を返すと判別     ^ ResourceState のメソッドが候補に出る
```

ローカル変数も `var s = ...;` の代入を遡って型を推定します。

```js
var state = ItemWithModel.getModelState(stack);
state.    // ResourceState のメソッドが候補に出る
```

### 引数ヒント・ホバー

メソッドの `(` を打つと引数のヒントが出ます。識別子(メソッド・クラス・難読名・グローバル)に
カーソルを乗せると、シグネチャや意味の説明が出ます。難読名(`func_…` / `field_…`)は
よく使うものに読める意味(例: `field_70177_z` → rotationYaw)が付きます。

### スクリプト雛形の挿入

コマンドパレット(`Cmd/Ctrl+Shift+P`)で次を実行すると、正しい形の雛形を挿入します。

- `RTM: Render スクリプトの雛形を挿入`
- `RTM: Server スクリプトの雛形を挿入`
- `RTM: Sound スクリプトの雛形を挿入`

### 定番パターンのスニペット

`rtm-` と打つと、定番パターンが候補に出ます(Tab で展開)。

| prefix | 内容 |
|---|---|
| `rtm-render-file` / `rtm-server-file` / `rtm-sound-file` | スクリプト一式 |
| `rtm-part` / `rtm-draw` | パーツ登録 / 描画(push/pop) |
| `rtm-bogie` / `rtm-wheel` | 台車+車輪 / 車輪回転 |
| `rtm-door` / `rtm-doorstate` | ドア開閉 / ドア状態取得 |
| `rtm-panta` / `rtm-needle` / `rtm-light` | パンタ / 計器の針 / 室内灯 |
| `rtm-rollsign` | 方向幕・種別の出し分け |
| `rtm-datamap-get` / `rtm-datamap-set` | dataMap の取得 / 保存 |
| `rtm-import-render` / `rtm-import-server` | importPackage 一式 |

### API チートシート

コマンド `RTM: API チートシートを開く` で、renderer / GL11 / entity / dataMap など
よく使う API の一覧を開けます。

### 構文チェック

ES5 として解析し、文法エラーを赤い波線で表示します。
例えば ES5 では `let` / `const` が使えないため、これらを書くとエラーになります。

### 設定

| キー | 既定 | 説明 |
|---|---|---|
| `rtmScript.version` | `1.12.2` | 補完・チェックに使うバージョン(サイドバーからも変更可) |
| `rtmScript.ecmaVersion` | `5` | 構文チェックの ECMAScript バージョン。RTM は基本 ES5 |
| `rtmScript.enableDiagnostics` | `true` | 構文エラーの赤表示 ON/OFF |
| `rtmScript.activateOnlyInRtmScripts` | `false` | `true` で、RTM らしい記述を含む `.js` のみ有効化 |

---

## 注意

- 構文チェックは文法のみで、未定義変数の検出はしません(Rhino の `importPackage` などで実行時に注入される変数を誤検知しないため)。
- `func_…` 難読メソッドは「ソース中での使用箇所」から収集しているため、所属クラスは目安です。

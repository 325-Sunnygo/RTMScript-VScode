# RTM Script Helper

RealTrainMod (RTM) のモデルパック用 ES5 / Rhino スクリプトを VSCode で書きやすくする拡張機能です。

- 構文ミスを赤い波線で表示します(ES5 として解析)
- RTM / NGTLib のクラス・メソッド、難読メソッド (`func_xxxxx_x`)、`importPackage`、`init` / `render` / `onUpdate` などのコールバックを補完します
- メソッドの戻り値の型をたどって、チェーンの続きを補完します
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

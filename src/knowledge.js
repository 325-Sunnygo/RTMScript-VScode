'use strict';
/*
 * knowledge.js
 * デコンパイルソースからは取れない「RTM スクリプト作成に必須の知識」を手書きでまとめたもの。
 *   - GL11 (LWJGL) のよく使うメソッド・定数
 *   - Minecraft 難読名(func_/field_)の意味(1.12.2 の主要なもの)
 *   - スクリプト種別ごとのグローバル変数と型
 *   - スクリプト雛形(Render / Server / Sound)
 */

// ---- LWJGL GL11 -------------------------------------------------------------
// RTM 描画スクリプトで importPackage(Packages.org.lwjgl.opengl) して使う。
const GL11_METHODS = [
  ['glPushMatrix', '()', '行列スタックを退避'],
  ['glPopMatrix', '()', '行列スタックを復帰'],
  ['glTranslatef', '(x, y, z)', '平行移動(float)'],
  ['glTranslated', '(x, y, z)', '平行移動(double)'],
  ['glRotatef', '(angle, x, y, z)', '回転(度, 軸ベクトル)'],
  ['glScalef', '(x, y, z)', '拡大縮小'],
  ['glColor3f', '(r, g, b)', '色(RGB)'],
  ['glColor4f', '(r, g, b, a)', '色(RGBA)'],
  ['glEnable', '(cap)', '機能を有効化(GL_BLEND など)'],
  ['glDisable', '(cap)', '機能を無効化'],
  ['glBlendFunc', '(src, dst)', 'ブレンド方法'],
  ['glDepthMask', '(flag)', '深度バッファ書き込み可否'],
  ['glBindTexture', '(target, id)', 'テクスチャをバインド'],
  ['glPushAttrib', '(mask)', '属性スタックを退避'],
  ['glPopAttrib', '()', '属性スタックを復帰'],
  ['glLineWidth', '(width)', '線幅'],
  ['glBegin', '(mode)', '描画開始(GL_QUADS など)'],
  ['glEnd', '()', '描画終了'],
  ['glVertex3f', '(x, y, z)', '頂点'],
  ['glNormal3f', '(x, y, z)', '法線'],
  ['glTexCoord2f', '(u, v)', 'テクスチャ座標'],
  ['glLoadIdentity', '()', '単位行列に戻す'],
];
const GL11_CONSTANTS = [
  'GL_BLEND', 'GL_LIGHTING', 'GL_TEXTURE_2D', 'GL_DEPTH_TEST', 'GL_CULL_FACE',
  'GL_SRC_ALPHA', 'GL_ONE_MINUS_SRC_ALPHA', 'GL_ONE', 'GL_QUADS', 'GL_TRIANGLES',
  'GL_LINES', 'GL_POLYGON', 'GL_FOG', 'GL_ALPHA_TEST', 'GL_RGBA',
];

// ---- Minecraft 難読名の意味(1.12.2)---------------------------------------
// RTM スクリプトでよく出てくる Entity/描画系の難読名に読める意味を付ける。
// 1.7.10 は KaizPatchX のソースが脱難読(getName 等)なので、この表は主に 1.12.2 用。
const OBF_MEANING_1122 = {
  // フィールド
  field_70165_t: 'posX — X座標',
  field_70163_u: 'posY — Y座標',
  field_70161_v: 'posZ — Z座標',
  field_70169_q: 'prevPosX — 前tickのX',
  field_70167_r: 'prevPosY — 前tickのY',
  field_70166_s: 'prevPosZ — 前tickのZ',
  field_70159_w: 'motionX — X方向の速度',
  field_70181_x: 'motionY — Y方向の速度',
  field_70179_y: 'motionZ — Z方向の速度',
  field_70177_z: 'rotationYaw — 水平回転角(ヨー)',
  field_70125_A: 'rotationPitch — 上下回転角(ピッチ)',
  field_70126_B: 'prevRotationYaw — 前tickのヨー',
  field_70127_C: 'prevRotationPitch — 前tickのピッチ',
  field_70170_p: 'world — ワールド',
  field_70128_L: 'isDead — 死亡/除去フラグ',
  field_70173_aa: 'ticksExisted — 存在tick数',
  field_70122_E: 'onGround — 接地フラグ',
  // メソッド
  func_70005_c_: 'getName() — 名前',
  func_145782_y: 'getEntityId() — エンティティID',
  func_174791_d: 'getPositionVector() — 位置ベクトル',
  func_180425_c: 'getPosition() — BlockPos',
  func_70070_b: 'getBrightnessForRender() — 描画用の明るさ',
  func_70090_H: 'isInWater() — 水中判定',
  func_70093_af: 'isSneaking() — スニーク中',
  func_70032_d: 'getDistance(entity) — 距離',
  func_174818_b: 'getDistanceSq(pos) — 距離の二乗',
  func_130014_f_: 'getEntityWorld() — ワールド',
  func_184187_bx: 'getRidingEntity() — 乗っている対象',
  func_70089_S: 'isEntityAlive() — 生存中',
  func_71410_x: 'Minecraft.getMinecraft() — クライアント本体(static)',
};

// ---- スクリプト種別ごとのグローバル変数 ------------------------------------
// type は data の FQN を割り当て(完全一致でなくても membersOf で吸収)。
const SCRIPT_GLOBALS = {
  // Render スクリプト
  renderer: { types: ['jp.ngt.rtm.render.PartsRenderer'], doc: '描画オブジェクト(registerParts / rotate / render など)。型は先頭の var renderClass で決まる。' },
  // Server / Sound スクリプト
  entity: { types: ['jp.ngt.rtm.entity.train.EntityTrainBase', 'jp.ngt.rtm.entity.vehicle.EntityVehicleBase'], doc: '車両エンティティ。' },
  scriptExecuter: { types: ['jp.ngt.rtm.modelpack.ScriptExecuter'], doc: 'コマンド実行・弾発射など。getEntity()/execCommand()。' },
  su: { types: ['jp.ngt.rtm.modelpack.ScriptExecuter'], doc: 'ScriptExecuter の慣習的な引数名(Sound)。' },
  dataMap: { types: ['jp.ngt.rtm.modelpack.state.DataMap'], doc: 'ボタン等の状態(getInt/getBoolean/setInt …)。' },
  formation: { types: ['jp.ngt.rtm.entity.train.util.Formation'], doc: '編成。getEntry / getEntity など。' },
  world: { types: ['net.minecraft.world.World'], doc: 'ワールド。' },
};

// ---- スクリプト雛形 ---------------------------------------------------------
const TEMPLATES = {
  render: `var renderClass = "jp.ngt.rtm.render.VehiclePartsRenderer";
importPackage(Packages.org.lwjgl.opengl);            // GL11
importPackage(Packages.jp.ngt.rtm.render);           // Parts など
importPackage(Packages.jp.ngt.ngtlib.renderer.model);

// パーツ登録(モデル内のパーツ名を指定)
function init(par1, par2) {
    body   = renderer.registerParts(new Parts("body"));
    bogieF = renderer.registerParts(new Parts("bogieF"));
    wheelF = renderer.registerParts(new Parts("wheelF1"));
}

// 毎フレーム描画(pass==0 が通常)
function render(entity, pass, par3) {
    if (pass != 0) return;

    GL11.glPushMatrix();
    body.render(renderer);

    // 台車を車両のヨーに合わせて回す例
    var yaw = entity.getBogie(0).field_70177_z - entity.field_70177_z;
    GL11.glPushMatrix();
        renderer.rotate(yaw, 'Y', 0.0, 0.0, 0.0);
        bogieF.render(renderer);
        GL11.glPushMatrix();
            renderer.rotate(renderer.getWheelRotationR(entity), 'X', 0.0, 0.0, 0.0);
            wheelF.render(renderer);
        GL11.glPopMatrix();
    GL11.glPopMatrix();

    GL11.glPopMatrix();
}
`,
  server: `importPackage(Packages.jp.ngt.rtm);                  // RTMCore
importPackage(Packages.net.minecraft.util);          // ResourceLocation
importPackage(Packages.jp.ngt.rtm.entity.train);     // EntityTrainBase

// サーバー側 tick 更新。entity=車両, scriptExecuter=コマンド実行など
function onUpdate(entity, scriptExecuter) {
    var speed = entity.getSpeed() * 72; // km/h 換算の例

    // 例: スピードに応じて状態を保存
    // var dataMap = entity.getResourceState().getDataMap();
    // dataMap.setInt("speed", Math.round(speed));
}
`,
  sound: `importPackage(Packages.jp.ngt.rtm.sound);
importPackage(Packages.net.minecraft.client);        // Minecraft

// 効果音スクリプト。su=ScriptExecuter
function onUpdate(su) {
    var entity = su.getEntity();
    if (entity == null) return;
    var speed = entity.getSpeed() * 72;

    // 例: 速度がしきい値を超えたら走行音、など
}
`,
};

// ---- 新規スクリプト作成(種類を選ぶ)----------------------------------------
// 描画系(init/render)は renderClass 違いだけなので雛形を生成。
function renderSkeleton(renderClass, part) {
  return 'var renderClass = "' + renderClass + '";\n' +
    'importPackage(Packages.org.lwjgl.opengl);            // GL11\n' +
    'importPackage(Packages.jp.ngt.rtm.render);           // Parts\n' +
    'importPackage(Packages.jp.ngt.ngtlib.renderer);      // GLHelper\n' +
    'importPackage(Packages.jp.ngt.ngtlib.renderer.model);\n\n' +
    'function init(par1, par2) {\n' +
    '    ' + part + ' = renderer.registerParts(new Parts("' + part + '"));\n' +
    '}\n\n' +
    'function render(entity, pass, par3) {\n' +
    '    if (pass != 0) return;\n' +
    '    GL11.glPushMatrix();\n' +
    '    ' + part + '.render(renderer);\n' +
    '    GL11.glPopMatrix();\n' +
    '}\n';
}

const GUI_TEMPLATE = `var renderClass = "jp.ngt.rtm.render.VehiclePartsRenderer";
importPackage(Packages.org.lwjgl.opengl);            // GL11

// 車内の GUI / LCD モニタを描画。vehicle=車両, gui=GUI
function renderGui(vehicle, gui) {
    GL11.glPushMatrix();
    // ここに計器/モニタ/行先表示などの描画
    GL11.glPopMatrix();
}
`;

const RAIL_TEMPLATE = `var renderClass = "jp.ngt.rtm.render.RailPartsRenderer";
importPackage(Packages.org.lwjgl.opengl);
importPackage(Packages.jp.ngt.rtm.render);
importPackage(Packages.jp.ngt.ngtlib.renderer.model);

function init(par1, par2) {
    rail = renderer.registerParts(new Parts("rail"));
}

// 静的描画(設置時にベイク)
function renderRailStatic(rail, x, y, z, partialTick, light) {
    rail.render(renderer);
}

// 動的描画(毎フレーム)
function renderRailDynamic(rail, x, y, z, partialTick, light) {
}
`;

const RAILSHAPE_TEMPLATE = `// カスタムレール形状。レールの曲線・高さ・傾きを数式で定義する。
// split = 分割数, index = 0..split の位置。

function getDefaultArgs() {
    return "20"; // 既定の引数(例: 長さ)
}
function getLength() {
    return 20.0; // レール全長(ブロック)
}
function getNearlestPoint(split, x, z) {
    return Math.round(x / getLength() * split); // (x,z)に最も近い分割
}
function getPos(split, index) {
    var t = index / split;
    return [t * getLength(), 0.0, 0.0]; // [x, y, z]
}
function getHeight(split, index) {
    return 0.0;
}
function getYaw(split, index) {
    return 0.0; // 度
}
function getPitch(split, index) {
    return 0.0;
}
function getRoll(split, index) {
    return 0.0;
}
`;

const WIRE_TEMPLATE = `var renderClass = "jp.ngt.rtm.render.WirePartsRenderer";
importPackage(Packages.org.lwjgl.opengl);
importPackage(Packages.jp.ngt.rtm.render);

function renderWireStatic(wire, x, y, z, partialTick, light) {
}
function renderWireDynamic(wire, x, y, z, partialTick, light) {
}
`;

// QuickPick 用: ラベル / 説明 / 中身
const NEW_SCRIPT_TYPES = [
  { label: 'Vehicle 描画 (車両)', detail: 'init/render + VehiclePartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.VehiclePartsRenderer', 'body') },
  { label: 'Signal 描画 (信号)', detail: 'init/render + SignalPartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.SignalPartsRenderer', 'signal') },
  { label: 'Ornament 描画 (装飾)', detail: 'init/render + OrnamentPartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.OrnamentPartsRenderer', 'body') },
  { label: 'NPC 描画', detail: 'init/render + NPCPartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.NPCPartsRenderer', 'body') },
  { label: 'Firearm 描画 (銃)', detail: 'init/render + FirearmPartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.FirearmPartsRenderer', 'body') },
  { label: 'Machine 描画 (機械)', detail: 'init/render + MachinePartsRenderer', content: renderSkeleton('jp.ngt.rtm.render.MachinePartsRenderer', 'body') },
  { label: 'Server (サーバー / onUpdate)', detail: 'onUpdate(entity, scriptExecuter)', content: TEMPLATES.server },
  { label: 'Sound (効果音)', detail: 'onUpdate(su)', content: TEMPLATES.sound },
  { label: 'GUI / LCD (renderGui)', detail: 'renderGui(vehicle, gui)', content: GUI_TEMPLATE },
  { label: 'Rail 描画 (renderRail)', detail: 'renderRailStatic / renderRailDynamic', content: RAIL_TEMPLATE },
  { label: 'Rail カスタム形状 (getPos 等)', detail: 'getPos / getYaw / getLength …', content: RAILSHAPE_TEMPLATE },
  { label: 'Wire / 架線 (renderWire)', detail: 'renderWireStatic / renderWireDynamic', content: WIRE_TEMPLATE },
];

// ---- API チートシート(コマンドで開く)------------------------------------
const CHEATSHEET = `# RTM スクリプト API チートシート

## スクリプトの種類と入口関数
- **Render(車両/信号/装飾/NPC/銃/機械)**: \`init(par1, par2)\` でパーツ登録 → \`render(entity, pass, par3)\` で毎フレーム描画(\`pass==0\` が通常)。\`shouldRenderObject(entity, pass)\` で描画可否。
- **Server**: \`onUpdate(entity, scriptExecuter)\`
- **Sound**: \`onUpdate(su)\`(su = ScriptExecuter)
- **GUI / LCD**: \`renderGui(vehicle, gui)\`
- **Rail 描画**: \`renderRailStatic(rail, x, y, z, partialTick, light)\` / \`renderRailDynamic(...)\`
- **Rail カスタム形状**: \`getLength()\` / \`getPos(split, index)\`→[x,y,z] / \`getYaw|getPitch|getRoll|getHeight(split, index)\` / \`getNearlestPoint(split, x, z)\` / \`getDefaultArgs()\`
- **Wire / 架線**: \`renderWireStatic(...)\` / \`renderWireDynamic(...)\`
- **操作**: \`onRightClick(entity, player)\` / \`onRightDrag(entity, player)\`

コマンドパレットの「**RTM: 新規スクリプト(種類を選んで作成)**」で全種類から選んで雛形を挿入できます。
個別パターンは \`rtm-\` で始まるスニペット(\`rtm-render-file\` / \`rtm-renderrail\` / \`rtm-rendergui\` / \`rtm-railshape\` など)。

## renderer(描画)
先頭の \`var renderClass = "jp.ngt.rtm.render.VehiclePartsRenderer";\` で型が決まります。
- \`renderer.registerParts(new Parts("名前"))\` → パーツ登録(init 内)
- \`パーツ.render(renderer)\` → 描画
- \`renderer.rotate(角度, '軸(X/Y/Z)', x, y, z)\` → 回転(ピボット指定)
- \`renderer.getWheelRotationR(entity)\` / \`getWheelRotationL\` → 車輪回転角
- \`renderer.getDoorMovementR(entity)\` / \`getDoorMovementL\` → ドア開度(0〜1)
- \`renderer.getPantographMovementFront(entity)\` / \`...Back\` → パンタ上昇(0〜1)
- \`renderer.sigmoid(値)\` → イージング

## GL11(OpenGL / org.lwjgl.opengl)
- \`GL11.glPushMatrix()\` / \`GL11.glPopMatrix()\`
- \`GL11.glTranslatef(x, y, z)\` / \`GL11.glRotatef(角度, x, y, z)\` / \`GL11.glScalef(x, y, z)\`

## GLHelper(明るさ / jp.ngt.ngtlib.renderer)
- \`GLHelper.setBrightness(0xF000F0)\` → 最大輝度(光るパーツ)
- \`GLHelper.setLightmapMaxBrightness()\` → 元に戻す

## entity(車両)
- \`entity.getSpeed()\`(×72 で km/h)/ \`entity.getNotch()\`
- \`entity.getBogie(0)\` / \`entity.getBogie(1)\` → 前/後台車(EntityBogie)
- \`entity.getResourceState().getDataMap()\` → dataMap
- \`entity.getTrainStateData(4)\` → ドア状態(0閉/1右/2左/3両)
- \`entity.field_70177_z\` = rotationYaw, \`entity.field_70125_A\` = rotationPitch

## dataMap(状態の保存・取得)
- 取得: \`dataMap.getInt("key")\` / \`getBoolean\` / \`getDouble\` / \`getString\`
- 保存: \`dataMap.setInt("key", 値, 0)\`(第3引数は更新フラグ)

## よく使うスニペット(prefix)
\`rtm-render-file\` / \`rtm-server-file\` / \`rtm-sound-file\` /
\`rtm-part\` / \`rtm-draw\` / \`rtm-bogie\` / \`rtm-wheel\` / \`rtm-door\` /
\`rtm-panta\` / \`rtm-needle\` / \`rtm-light\` / \`rtm-rollsign\` /
\`rtm-datamap-get\` / \`rtm-datamap-set\` / \`rtm-doorstate\` /
\`rtm-import-render\` / \`rtm-import-server\`
`;

module.exports = { GL11_METHODS, GL11_CONSTANTS, OBF_MEANING_1122, SCRIPT_GLOBALS, TEMPLATES, NEW_SCRIPT_TYPES, CHEATSHEET };

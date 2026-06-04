'use strict';
// vscode をスタブして主要ロジックを検証するスモークテスト。
// 実行: node test/smoke.js
const path = require('path');
const Module = require('module');
const STUB = path.join(__dirname, 'vscode-stub.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) {
  if (req === 'vscode') return STUB;
  return orig.call(this, req, ...a);
};

const vscode = require('vscode');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.log('  FAIL- ' + name); }
}

// ---- apiIndex ----
const { ApiIndex } = require('../src/apiIndex');
const dataDir = path.join(__dirname, '..', 'data');
const api1122 = new ApiIndex('1.12.2', dataDir);
const api1710 = new ApiIndex('1.7.10', dataDir);
ok('1.12.2 loads', api1122.ok && api1122.stats.classes > 100);
ok('1.7.10 loads', api1710.ok && api1710.stats.classes > 100);
ok('package resolve has render classes', api1122.resolvePackageNode('jp.ngt.rtm.render').classes.includes('Parts'));

// ---- completion ----
const { analyze, createProvider, resolveType, extractReceiver } = require('../src/completion');
ok('analyze package', analyze('importPackage(Packages.jp.ngt.rtm.').type === 'package');
ok('analyze new', analyze('new Part').type === 'new');
ok('analyze member', analyze('renderer.regi').receiver === 'renderer');
ok('analyze ident', analyze('var x = re').type === 'ident');

const state = { current: () => api1122, versionName: () => '1.12.2' };
const prov = createProvider(state, () => true);
function mockDoc(line) { return { languageId: 'javascript', getText: () => line, lineAt: () => ({ text: line }) }; }
function count(line) {
  const r = prov.provideCompletionItems(mockDoc(line), { line: 0, character: line.length });
  return r ? r.items.length : 0;
}
ok('package completions', count('importPackage(Packages.jp.ngt.rtm.') > 5);
ok('new completions', count('new ') > 100);
ok('member completions', count('renderer.') > 5);
ok('ident completions', count('var x = re') > 100);

// 型が解決できたら「その型のメンバーだけ」= 無関係な型のメソッドを混ぜない
function labelsFor(line) {
  const r = prov.provideCompletionItems(mockDoc(line), { line: 0, character: line.length });
  return (r ? r.items : []).map(i => i.label);
}
const rendererLabels = labelsFor('renderer.');
ok('renderer. is focused (not the whole cross-pool)', rendererLabels.length > 5 && rendererLabels.length < 300);
ok('renderer. excludes unrelated method (getModelState)', !rendererLabels.includes('getModelState'));
ok('renderer. includes its own method (registerParts)', rendererLabels.includes('registerParts'));
// Entity 系は難読フィールドも残す
const entityLabels = labelsFor('entity.');
ok('entity. keeps obf field field_70177_z', entityLabels.includes('field_70177_z'));
// 型不明のレシーバはフォールバックで横断プールが出る
ok('unresolved receiver falls back to cross-pool', count('zzz123.') > 300);

// Tab確定で「名前だけ」挿入される(構文の塊を展開しない)ことを確認
function itemsFor(line) {
  const r = prov.provideCompletionItems(mockDoc(line), { line: 0, character: line.length });
  return r ? r.items : [];
}
// 全スクリプト種別のコールバックが候補に出る
const { NEW_SCRIPT_TYPES } = require('../src/knowledge');
ok('NEW_SCRIPT_TYPES covers >=10 types', NEW_SCRIPT_TYPES.length >= 10);
ok('every script type has content', NEW_SCRIPT_TYPES.every(t => t.content && t.content.length > 20));
const allIdent = itemsFor('');
for (const cb of ['render', 'renderGui', 'renderRailStatic', 'renderWireDynamic', 'getPos', 'getYaw', 'onRightClick']) {
  ok('callback suggested: ' + cb, allIdent.some(i => i.label === cb));
}

const identItems = itemsFor('ini');
const initItem = identItems.find(i => i.label === 'init');
ok('callback init inserts plain name (not snippet)',
  initItem && typeof initItem.insertText === 'string' && initItem.insertText === 'init');
const ipItem = identItems.find(i => i.label === 'importPackage');
ok('importPackage inserts plain name (not snippet)',
  ipItem && typeof ipItem.insertText === 'string' && ipItem.insertText === 'importPackage');
// メソッド候補も名前だけ
const memItems = prov.provideCompletionItems(mockDoc('renderer.'), { line: 0, character: 'renderer.'.length }).items;
const regItem = memItems.find(i => i.label === 'registerParts');
ok('method registerParts inserts plain name',
  regItem && typeof regItem.insertText === 'string' && regItem.insertText === 'registerParts');

// 1.7.10 に切替えたら候補が変わる
const state2 = { current: () => api1710, versionName: () => '1.7.10' };
const prov2 = createProvider(state2, () => true);
function count2(line) {
  const r = prov2.provideCompletionItems(mockDoc(line), { line: 0, character: line.length });
  return r ? r.items.length : 0;
}
ok('1.7.10 obf differs from 1.12.2', api1710.stats.obf !== api1122.stats.obf);

// ---- チェーン型解決 ----
ok('extractReceiver chain', extractReceiver('body = ItemWithModel.getModelState(stack)') === 'ItemWithModel.getModelState(stack)');
function chainHas(receiver, docText, member) {
  const cls = resolveType(receiver, api1122, docText || '', 0);
  return cls.length > 0 && cls.some(c => c.methods.some(m => m.name === member));
}
// クラス名 -> static 的呼び出し -> 戻り値の型 -> そのメンバー
ok('ItemWithModel.getModelState(stack). -> getResourceName',
  chainHas('ItemWithModel.getModelState(stack)', '', 'getResourceName'));
// クラスそのもの.
ok('ResourceState. -> getResourceName',
  chainHas('ResourceState', '', 'getResourceName'));
// 既知グローバル
ok('renderer. -> registerParts',
  chainHas('renderer', '', 'registerParts'));
// ローカル変数の型推定: var s = ItemWithModel.getModelState(stack); s.
ok('local var inference: s.getResourceName',
  chainHas('s', 'var s = ItemWithModel.getModelState(stack);\ns.', 'getResourceName'));
// 2段チェーン: getModelState(stack).getDataMap() -> DataMap が解決できること
const twoStep = resolveType('ItemWithModel.getModelState(stack).getDataMap()', api1122, '', 0);
ok('two-step chain resolves to DataMap', twoStep.length > 0 && twoStep[0].name === 'DataMap');

// ---- パッケージ/FQN 補完(Packages. 無しでも出る) ----
ok('analyze: bare jp.ngt path -> package', analyze('x = jp.ngt.rtm.render.').type === 'package');
ok('analyze: renderClass empty -> renderClass', analyze('var renderClass = "').type === 'renderClass');
ok('analyze: renderClass path -> renderClass', analyze('var renderClass = "jp.ngt.rtm.render.Veh').type === 'renderClass');
ok('analyze: member still works', analyze('entity.getSp').type === 'member');
ok('bare jp.ngt.rtm.render. lists classes', count('x = jp.ngt.rtm.render.') > 5);
const rcItems = prov.provideCompletionItems(mockDoc('var renderClass = "'), { line: 0, character: 'var renderClass = "'.length }).items;
ok('renderClass suggests renderer FQNs',
  rcItems.length > 5 && rcItems.every(i => /^jp\.ngt\.rtm\.render\..*Renderer$/.test(i.label)));

// ---- 知識レイヤー強化(GL11 / renderClass / 継承 / 難読意味 / signature) ----
const { detectRenderClass } = require('../src/completion');
ok('detectRenderClass reads var renderClass',
  detectRenderClass('var renderClass = "jp.ngt.rtm.render.MachinePartsRenderer";') === 'jp.ngt.rtm.render.MachinePartsRenderer');

const rcDoc = 'var renderClass = "jp.ngt.rtm.render.VehiclePartsRenderer";\nrenderer.';
const rcCls = resolveType('renderer', api1122, rcDoc, 0);
ok('renderer resolves via renderClass', rcCls.length > 0 && rcCls[0].name === 'VehiclePartsRenderer');
ok('renderer includes inherited registerParts/rotate',
  chainHas('renderer', rcDoc, 'registerParts') && chainHas('renderer', rcDoc, 'rotate'));

// GL11 補完
const gl = prov.provideCompletionItems(mockDoc('GL11.'), { line: 0, character: 'GL11.'.length }).items;
ok('GL11. completions include glPushMatrix', gl.some(i => i.label === 'glPushMatrix'));

// 難読名の意味が detail に出る(1.12.2)
const entItems = prov.provideCompletionItems(mockDoc('entity.'), { line: 0, character: 'entity.'.length }).items;
const yawItem = entItems.find(i => i.label === 'field_70177_z');
ok('obf field_70177_z shows rotationYaw meaning', yawItem && /rotationYaw/.test(yawItem.detail || ''));

// SignatureHelp
const { findEnclosingCall, createSignatureProvider } = require('../src/signature');
const fc = findEnclosingCall('renderer.rotate(10, ');
ok('findEnclosingCall parses name/receiver/activeParam',
  fc && fc.name === 'rotate' && fc.receiver === 'renderer' && fc.activeParam === 1);
const sigProv = createSignatureProvider(state, () => true);
function sigDoc(text) { return { languageId: 'javascript', getText: () => text, lineAt: () => ({ text }) }; }
const help = sigProv.provideSignatureHelp(sigDoc('renderer.rotate('), { line: 0, character: 'renderer.rotate('.length });
ok('signature help for renderer.rotate', help && help.signatures.length > 0);

// ---- RTM スクリプト検出(普通のJS開発を妨げないこと) ----
const { looksLikeRtmScript } = require('../src/detect');
ok('detect: importPackage を含む -> RTM', looksLikeRtmScript('importPackage(Packages.jp.ngt.rtm.render);', '/x/foo.js'));
ok('detect: renderer 使用 -> RTM', looksLikeRtmScript('body = renderer.registerParts(new Parts("a"));', '/x/foo.js'));
ok('detect: scripts フォルダ配下 -> RTM', looksLikeRtmScript('var x = 1;', '/pack/assets/minecraft/scripts/Foo.js'));
ok('detect: Render_xxx.js -> RTM', looksLikeRtmScript('var x = 1;', '/x/Render_sd8200_1.js'));
ok('detect: 普通のJS(modernなapp.js) -> 非RTM', !looksLikeRtmScript('const app = () => { let n = 1; };', '/proj/src/app.js'));
ok('detect: 普通のindex.js -> 非RTM', !looksLikeRtmScript('module.exports = function () {};', '/proj/index.js'));
ok('detect: var renderClass だけ -> RTM', looksLikeRtmScript('var renderClass = "jp.ngt.rtm.render.RTMEntityRenderer";', '/x/foo.js'));
ok('detect: //include 指令 -> RTM', looksLikeRtmScript('//include <scripts/CustomMonitor_LCD/CustomMonitor_LCD.js>', '/x/foo.js'));

// ---- diagnostics ----
let store = null;
vscode.languages.createDiagnosticCollection = () => ({ set: (uri, d) => { store = d; }, delete: () => { store = null; } });
const { createDiagnostics } = require('../src/diagnostics');
const cfg = () => ({ enableDiagnostics: true, ecmaVersion: '5', activateOnlyInRtmScripts: false });
const diag = createDiagnostics(cfg, () => true);
function makeDoc(text) {
  const lines = text.split('\n');
  return {
    uri: 'u', languageId: 'javascript', getText: () => text, lineCount: lines.length,
    lineAt: (l) => ({ text: lines[l] || '' }),
    positionAt: (p) => ({ line: 0, character: p, translate(a, b) { return { line: 0, character: p + b }; } }),
  };
}
diag.run(makeDoc('importPackage(Packages.jp.ngt.rtm.render);\nfunction init(p1,p2){ body = renderer.registerParts(new Parts("a")); }'));
ok('valid script -> no error', store && store.length === 0);
diag.run(makeDoc('function render(e){\n  if (e.getSpeed() > 0 {\n  }\n}'));
ok('broken script -> 1 error', store && store.length === 1);
ok('error message is japanese', store && /構文エラー/.test(store[0].message));
diag.run(makeDoc('let x = 1;'));
ok('ES5 rejects let', store && store.length === 1);
// rtmjs 言語でも診断が効く
const rtmDoc = makeDoc('function render(e){ if (e { } }');
rtmDoc.languageId = 'rtmjs';
diag.run(rtmDoc);
ok('rtmjs language is diagnosed', store && store.length === 1);

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

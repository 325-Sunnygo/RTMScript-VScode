'use strict';
/*
 * apiIndex.js
 * data/api-<version>.json を読み込み、補完で引きやすい形に索引化する。
 * バージョンごとに 1 つの ApiIndex を作る。
 */

const fs = require('fs');
const path = require('path');

// RTM スクリプトで利用できる組込みグローバル(関数の引数として渡ってくるもの等)。
// type には DB 内の代表的な FQN を割り当て、`obj.` 補完で型推定に使う。
const KNOWN_GLOBALS = {
  // 描画スクリプト
  renderer: ['jp.ngt.rtm.render.VehiclePartsRenderer', 'jp.ngt.rtm.render.PartsRenderer', 'jp.ngt.rtm.render.BasicPartsRenderer'],
  entity: ['jp.ngt.rtm.entity.train.EntityTrainBase', 'jp.ngt.rtm.entity.vehicle.EntityVehicleBase'],
  // サーバースクリプト
  scriptExecuter: ['jp.ngt.rtm.modelpack.ScriptExecuter'],
  su: ['jp.ngt.rtm.modelpack.ScriptExecuter'],
  dataMap: ['jp.ngt.rtm.entity.train.util.TrainStateData', 'jp.ngt.ngtlib.util.NGTUtil'],
  formation: ['jp.ngt.rtm.entity.train.util.Formation'],
  // 共通
  world: ['net.minecraft.world.World'],
};

// RTM スクリプトが実装する代表的なコールバック関数(スニペット候補)。
const SCRIPT_CALLBACKS = [
  { name: 'init', params: ['par1', 'par2'], doc: '描画スクリプト初期化。renderer.registerParts(...) でパーツ登録。' },
  { name: 'render', params: ['entity', 'pass', 'par3'], doc: '毎フレーム描画。pass==0 が通常描画。' },
  { name: 'onUpdate', params: ['entity', 'scriptExecuter'], doc: 'サーバー側 tick 更新。entity と ScriptExecuter を受け取る。' },
  { name: 'playSound', params: ['entity', 'scriptExecuter'], doc: '効果音スクリプト用。' },
];

// Rhino / Nashorn の組込み関数。
const RHINO_BUILTINS = [
  { name: 'importPackage', insert: 'importPackage(Packages.${1:jp.ngt.rtm.render});', doc: 'Java パッケージを取り込む(Rhino)。' },
  { name: 'importClass', insert: 'importClass(Packages.${1:jp.ngt.rtm.render.Parts});', doc: 'Java クラス1つを取り込む(Rhino)。' },
  { name: 'Packages', insert: 'Packages.', doc: 'Java パッケージへのルート参照。' },
  { name: 'load', insert: "load(\"nashorn:mozilla_compat.js\");", doc: '外部スクリプト/互換レイヤを読み込む。' },
  { name: 'JavaImporter', insert: 'JavaImporter(${1:Packages.jp.ngt.rtm.render})', doc: 'with と組み合わせるパッケージインポータ。' },
];

class ApiIndex {
  constructor(version, dataDir) {
    this.version = version;
    this.ok = false;
    this.error = null;
    this.classesByFqn = {};
    this.classShortNames = new Map();   // shortName -> [fqn...]
    this.packageSet = new Set();
    this.packageTree = {};              // ネストした {seg: {__classes:[...], child:{}}}
    this.memberPool = new Map();        // memberName -> {kind, ret/type, owners[], params}
    this.obfMethods = [];
    this.obfFields = [];
    this.memberOwners = {};
    this.stats = { classes: 0, packages: 0, obf: 0 };

    try {
      const file = path.join(dataDir, 'api-' + version + '.json');
      const db = JSON.parse(fs.readFileSync(file, 'utf8'));
      this._build(db);
      this.ok = true;
    } catch (e) {
      this.error = e.message;
    }
  }

  _build(db) {
    this.classesByFqn = db.classes || {};
    this.obfMethods = db.obfMethods || [];
    this.obfFields = db.obfFields || [];
    this.memberOwners = db.memberOwners || {};
    (db.packages || []).forEach(p => this.packageSet.add(p));

    for (const fqn of Object.keys(this.classesByFqn)) {
      const c = this.classesByFqn[fqn];
      // 短縮名インデックス
      if (!this.classShortNames.has(c.name)) this.classShortNames.set(c.name, []);
      this.classShortNames.get(c.name).push(fqn);

      // メンバープール(全クラス横断のメソッド/フィールド)
      for (const m of c.methods || []) {
        let e = this.memberPool.get(m.name);
        if (!e) { e = { name: m.name, kind: 'method', owners: [], params: m.params, ret: m.ret }; this.memberPool.set(m.name, e); }
        if (e.owners.length < 8) e.owners.push(c.name);
      }
      for (const f of c.fields || []) {
        let e = this.memberPool.get(f.name);
        if (!e) { e = { name: f.name, kind: 'field', owners: [], type: f.type }; this.memberPool.set(f.name, e); }
        if (e.owners.length < 8) e.owners.push(c.name);
      }
    }

    // パッケージツリー構築
    for (const pkg of this.packageSet) {
      const segs = pkg.split('.');
      let node = this.packageTree;
      for (const s of segs) {
        node[s] = node[s] || { __classes: [] };
        node = node[s];
      }
    }
    // クラスをそのパッケージノードにぶら下げる
    for (const fqn of Object.keys(this.classesByFqn)) {
      const c = this.classesByFqn[fqn];
      if (!c.pkg) continue;
      const segs = c.pkg.split('.');
      let node = this.packageTree;
      let ok = true;
      for (const s of segs) { if (!node[s]) { ok = false; break; } node = node[s]; }
      if (ok) node.__classes.push(c.name);
    }

    this.stats = {
      classes: Object.keys(this.classesByFqn).length,
      packages: this.packageSet.size,
      obf: this.obfMethods.length,
    };
  }

  // "jp.ngt.rtm" のような接頭辞に対する次セグメント候補とクラスを返す
  resolvePackageNode(prefix) {
    if (!prefix) {
      // ルート: トップレベルセグメント
      return { children: Object.keys(this.packageTree).filter(k => k !== '__classes'), classes: [] };
    }
    const segs = prefix.split('.').filter(Boolean);
    let node = this.packageTree;
    for (const s of segs) {
      if (!node[s]) return { children: [], classes: [] };
      node = node[s];
    }
    return {
      children: Object.keys(node).filter(k => k !== '__classes'),
      classes: node.__classes || [],
    };
  }

  getClass(fqn) { return this.classesByFqn[fqn] || null; }

  // 短縮名 or FQN からクラスを引く
  findClass(name) {
    if (this.classesByFqn[name]) return this.classesByFqn[name];
    const list = this.classShortNames.get(name);
    if (list && list.length) return this.classesByFqn[list[0]];
    return null;
  }

  // 複数の候補 FQN からメンバーをまとめて返す(型推定が曖昧なグローバル用)
  membersOf(fqnList) {
    const out = [];
    const seen = new Set();
    for (const fqn of fqnList) {
      const c = this.classesByFqn[fqn];
      if (!c) continue;
      for (const m of c.methods || []) {
        const k = 'm:' + m.name + '/' + m.params.length;
        if (seen.has(k)) continue; seen.add(k);
        out.push({ kind: 'method', name: m.name, params: m.params, ret: m.ret, owner: c.name });
      }
      for (const f of c.fields || []) {
        const k = 'f:' + f.name;
        if (seen.has(k)) continue; seen.add(k);
        out.push({ kind: 'field', name: f.name, type: f.type, owner: c.name });
      }
    }
    return out;
  }
}

module.exports = { ApiIndex, KNOWN_GLOBALS, SCRIPT_CALLBACKS, RHINO_BUILTINS };

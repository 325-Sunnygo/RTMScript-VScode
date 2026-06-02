#!/usr/bin/env node
/*
 * extract.js
 * デコンパイル済み RTM / NGTLib (1.12.2) と KaizPatchX (1.7.10) の Java ソースを走査し、
 * VSCode 拡張機能の補完用 API データベース(JSON)を生成する。
 *
 * 生成物:
 *   data/api-1.12.2.json
 *   data/api-1.7.10.json
 *
 * 使い方:
 *   node tools/extract.js
 *
 * ソースの場所はこのファイル冒頭の SOURCES で指定。環境に合わせて変更可。
 */

const fs = require('fs');
const path = require('path');

// ---- ソースルート設定 -------------------------------------------------------
const HOME = require('os').homedir();
const DL = path.join(HOME, 'Downloads');

const SOURCES = {
  '1.12.2': [
    path.join(DL, 'rtm', 'RTM2.4.24-43_forge-1.12.2-14.23.2.2611.jar_Decompiler.com'),
    path.join(DL, 'rtm', 'NGTLib2.4.21-38_forge-1.12.2-14.23.2.2611.jar_Decompiler.com'),
  ],
  '1.7.10': [
    path.join(DL, 'KaizPatchX-master', 'src', 'main', 'java'),
  ],
};

const OUT_DIR = path.join(__dirname, '..', 'data');

// ---- ユーティリティ ---------------------------------------------------------
function walk(dir, acc) {
  acc = acc || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith('.java')) acc.push(full);
  }
  return acc;
}

// 1行の宣言からメソッド/フィールド情報を取り出すための正規表現群
const RE_PACKAGE = /^\s*package\s+([\w.]+)\s*;/;
const RE_CLASS = /\b(?:public\s+|final\s+|abstract\s+|static\s+)*(class|interface|enum)\s+([A-Za-z_]\w*)/;
// public な戻り値付きメソッド: public [static] Type name(args)
const RE_METHOD = /\b(?:public)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+|native\s+)*([\w.<>\[\],\s?]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
// public フィールド: public [static] [final] Type name (= ...)?;
const RE_FIELD = /\b(?:public)\s+(?:static\s+|final\s+|transient\s+|volatile\s+)*([\w.<>\[\],\s?]+?)\s+([A-Za-z_]\w*)\s*(?:=|;)/;
// 難読メソッド/フィールドのトークン
const RE_FUNC = /\bfunc_\d+_[a-zA-Z]+\b/g;
const RE_FIELDOBF = /\bfield_\d+_[a-zA-Z]+\b/g;

function shortType(t) {
  if (!t) return '';
  t = t.trim().replace(/\s+/g, ' ');
  // ジェネリクスや配列の中の最後の単純名を取り出して表示を短く
  const noGen = t.replace(/<[^>]*>/g, '');
  const parts = noGen.split('.');
  return parts[parts.length - 1] + (t.includes('[]') ? '[]' : '');
}

// ---- 1ファイル解析 ----------------------------------------------------------
function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  let pkg = '';
  let className = '';
  const methods = new Map(); // name -> {name, params, ret, kind}
  const fields = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!pkg) {
      const mp = line.match(RE_PACKAGE);
      if (mp) { pkg = mp[1]; continue; }
    }
    if (!className) {
      const mc = line.match(RE_CLASS);
      if (mc) { className = mc[2]; }
    }

    // メソッド
    const mm = line.match(RE_METHOD);
    if (mm && !/\b(new|return|if|for|while|switch|catch)\b/.test(mm[2])) {
      const ret = shortType(mm[1]);
      const name = mm[2];
      const rawParams = mm[3].trim();
      // ジェネリック宣言 (public <T> T foo) のときは ret が "<T> T" 等になり得るが許容
      const params = rawParams.length
        ? rawParams.split(',').map(p => {
            const seg = p.trim().split(/\s+/);
            return shortType(seg.slice(0, -1).join(' ')) || shortType(seg[0]);
          })
        : [];
      if (name !== className) { // コンストラクタは除外
        methods.set(name + '/' + params.length, { name, params, ret });
      }
      continue;
    }

    // フィールド (メソッドにマッチしなかった行のみ)
    const mf = line.match(RE_FIELD);
    if (mf && !line.includes('(')) {
      const type = shortType(mf[1]);
      const name = mf[2];
      if (!/\b(return|new)\b/.test(name)) fields.set(name, { name, type });
    }
  }

  // 難読トークン収集 (このファイル中で使われている func_/field_)
  const obfMethods = new Set((text.match(RE_FUNC) || []));
  const obfFields = new Set((text.match(RE_FIELDOBF) || []));

  const fqn = pkg ? pkg + '.' + className : className;
  return {
    pkg, className, fqn,
    methods: [...methods.values()],
    fields: [...fields.values()],
    obfMethods: [...obfMethods],
    obfFields: [...obfFields],
  };
}

// ---- バージョン単位で集約 ---------------------------------------------------
function buildVersion(version, roots) {
  const classes = {};        // fqn -> {name, pkg, fqn, methods[], fields[]}
  const packages = new Set();
  const allObfMethods = new Set();
  const allObfFields = new Set();
  // メソッド名 -> どのクラスで見たか(難読名の所属推定用)
  const memberIndex = new Map();    // memberName -> Set(fqn)

  let fileCount = 0;
  for (const root of roots) {
    const files = walk(root);
    for (const f of files) {
      fileCount++;
      const info = parseFile(f);
      if (!info.className) continue;
      if (info.pkg) packages.add(info.pkg);

      const entry = classes[info.fqn] || {
        name: info.className, pkg: info.pkg, fqn: info.fqn,
        methods: [], fields: [],
      };
      // マージ(同名クラスが複数 root にある場合)
      const seen = new Set(entry.methods.map(m => m.name + '/' + m.params.length));
      for (const m of info.methods) {
        const key = m.name + '/' + m.params.length;
        if (!seen.has(key)) { entry.methods.push(m); seen.add(key); }
        if (!memberIndex.has(m.name)) memberIndex.set(m.name, new Set());
        memberIndex.get(m.name).add(info.fqn);
      }
      const fseen = new Set(entry.fields.map(x => x.name));
      for (const fld of info.fields) {
        if (!fseen.has(fld.name)) { entry.fields.push(fld); fseen.add(fld.name); }
      }
      classes[info.fqn] = entry;

      info.obfMethods.forEach(x => allObfMethods.add(x));
      info.obfFields.forEach(x => allObfFields.add(x));
    }
  }

  // memberIndex を配列化(難読メソッドのホバー用に所属クラス候補を持たせる)
  const memberOwners = {};
  for (const [k, set] of memberIndex) {
    memberOwners[k] = [...set].slice(0, 6);
  }

  return {
    version,
    // 個人情報(絶対パス/ユーザー名)を含めないよう、フォルダ名のみ記録
    generatedFrom: roots.map(r => path.basename(r)),
    fileCount,
    packages: [...packages].sort(),
    classes,                          // オブジェクト(fqn キー)
    obfMethods: [...allObfMethods].sort(),
    obfFields: [...allObfFields].sort(),
    memberOwners,
  };
}

// ---- 実行 -------------------------------------------------------------------
function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const version of Object.keys(SOURCES)) {
    const roots = SOURCES[version].filter(r => fs.existsSync(r));
    if (!roots.length) {
      console.warn('[warn] ' + version + ': ソースが見つかりません。スキップ:', SOURCES[version]);
      continue;
    }
    const db = buildVersion(version, roots);
    const out = path.join(OUT_DIR, 'api-' + version + '.json');
    fs.writeFileSync(out, JSON.stringify(db));
    const classCount = Object.keys(db.classes).length;
    console.log(
      '[ok] ' + version + ': ' + db.fileCount + ' files -> ' +
      classCount + ' classes, ' + db.packages.length + ' packages, ' +
      db.obfMethods.length + ' func_ methods  => ' + path.relative(process.cwd(), out)
    );
  }
}

main();

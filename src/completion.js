'use strict';
/*
 * completion.js
 * RTM スクリプト向けの補完を提供する。state.current() で現在バージョンの ApiIndex を取得。
 *
 * 対応する状況:
 *   1. Packages.xxx / importPackage(Packages.xxx  -> パッケージ階層 + クラス名
 *   2. new Xxx                                    -> クラス名
 *   3. obj.member / a.b().c().                     -> レシーバ式の型を解決してメンバー
 *        - 既知グローバル(renderer/entity/...)は型を推定
 *        - クラス名から static 的呼び出し (ItemWithModel.getModelState(stack))
 *        - メソッドの戻り値の型をたどってチェーン (… .getModelState(stack).getResourceName())
 *        - ローカル変数は var 代入を遡って型推定 (var s = ...; s.)
 *        - 解決できない場合も全メソッド + func_ をフォールバックで出す
 *   4. 通常の識別子                                -> クラス短縮名 / コールバック / Rhino組込み
 */

const vscode = require('vscode');
const { SCRIPT_CALLBACKS, RHINO_BUILTINS } = require('./apiIndex');
const { GL11_METHODS, GL11_CONSTANTS, OBF_MEANING_1122, SCRIPT_GLOBALS } = require('./knowledge');

const CK = vscode.CompletionItemKind;

// グローバル変数名 -> 候補 FQN(知識レイヤーの SCRIPT_GLOBALS から)
const GLOBAL_TYPES = {};
for (const g of Object.keys(SCRIPT_GLOBALS)) GLOBAL_TYPES[g] = SCRIPT_GLOBALS[g].types;

// 先頭の var renderClass = "FQN" を読んで renderer の型を決める
function detectRenderClass(docText) {
  const m = docText && docText.match(/renderClass\s*=\s*["']([\w.$]+)["']/);
  return m ? m[1] : null;
}

function makeItem(label, kind, detail, doc, insert, sortPrefix) {
  const it = new vscode.CompletionItem(label, kind);
  if (detail) it.detail = detail;
  if (doc) it.documentation = new vscode.MarkdownString(doc);
  if (insert !== undefined && insert !== null) it.insertText = insert;
  if (sortPrefix) it.sortText = sortPrefix + label;
  return it;
}

function methodSignature(m) {
  return m.name + '(' + (m.params || []).join(', ') + ')' + (m.ret ? ': ' + m.ret : '');
}

// ---- レシーバ式の抽出 -------------------------------------------------------
// 行頭側に向かって、メンバアクセスの対象(レシーバ)になる後置式を取り出す。
// 例: 'body = ItemWithModel.getModelState(stack).' -> 'ItemWithModel.getModelState(stack)'
function extractReceiver(textBeforeDot) {
  let i = textBeforeDot.length - 1;
  let depth = 0;
  // 末尾の空白を無視
  while (i >= 0 && /\s/.test(textBeforeDot[i]) && depth === 0) i--;
  const end = i + 1;
  for (; i >= 0; i--) {
    const ch = textBeforeDot[i];
    if (ch === ')' || ch === ']') { depth++; continue; }
    if (ch === '(' || ch === '[') {
      if (depth === 0) break; // レシーバの開始境界
      depth--; continue;
    }
    if (depth > 0) continue; // 括弧の中は何でも許容
    if (/[A-Za-z0-9_$.#]/.test(ch)) continue;
    break;
  }
  return textBeforeDot.slice(i + 1, end).trim();
}

// トップレベル(括弧の外)のドットでチェーンを分割
function splitTopLevelDots(expr) {
  const parts = [];
  let depth = 0, cur = '', str = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (str) { cur += ch; if (ch === str && expr[i - 1] !== '\\') str = null; continue; }
    if (ch === '"' || ch === "'") { str = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') { depth++; cur += ch; continue; }
    if (ch === ')' || ch === ']') { depth--; cur += ch; continue; }
    if (ch === '.' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function leadingIdent(tok) {
  const m = tok.match(/^\s*([A-Za-z_$][\w$]*)/);
  return m ? m[1] : '';
}

// ---- 型解決 -----------------------------------------------------------------
// レシーバ式 -> 候補クラス配列(api の class オブジェクト)を返す。解決失敗なら []
function resolveType(receiver, api, docText, depth) {
  if (!receiver || depth > 6) return [];
  receiver = receiver.replace(/#/g, '.').trim();
  const tokens = splitTopLevelDots(receiver);
  if (!tokens.length) return [];

  let classes = resolveBase(tokens[0], api, docText, depth);
  if (!classes.length) return [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    const name = leadingIdent(tok);
    if (!name) return [];
    const isCall = /\(/.test(tok);
    let nextTypeName = null;
    for (const c of classes) {
      if (!c) continue;
      if (isCall) {
        const m = (c.methods || []).find(x => x.name === name);
        if (m && m.ret) { nextTypeName = m.ret; break; }
      } else {
        // 括弧なし: フィールド優先、なければゲッターメソッドとして許容
        const f = (c.fields || []).find(x => x.name === name);
        if (f && f.type) { nextTypeName = f.type; break; }
        const m = (c.methods || []).find(x => x.name === name);
        if (m && m.ret) { nextTypeName = m.ret; break; }
      }
    }
    if (!nextTypeName) return []; // チェーンが途切れたらフォールバックへ
    const nc = api.findClass(stripType(nextTypeName));
    if (!nc) return [];
    classes = [nc];
  }
  return classes;
}

// "List<Foo>" や "Foo[]" を "Foo" に
function stripType(t) {
  return (t || '').replace(/<[^>]*>/g, '').replace(/\[\]/g, '').trim();
}

function resolveBase(baseTok, api, docText, depth) {
  const base = baseTok.trim();

  // new Foo(...)
  let m = base.match(/^new\s+([\w.$]+)/);
  if (m) { const c = api.findClass(stripType(m[1])); return c ? [c] : []; }

  const ident = leadingIdent(base);
  const hasCall = /\(/.test(base);

  // renderer は先頭の var renderClass で型が決まる(継承展開済みなので基底メソッドも出る)
  if (!hasCall && ident === 'renderer') {
    const rc = detectRenderClass(docText);
    if (rc) { const c = api.findClass(stripType(rc)); if (c) return [c]; }
    return GLOBAL_TYPES.renderer.map(f => api.getClass(f)).filter(Boolean);
  }

  // 既知グローバル(entity / dataMap / formation / scriptExecuter / su / world)
  if (!hasCall && GLOBAL_TYPES[ident]) {
    return GLOBAL_TYPES[ident].map(f => api.getClass(f)).filter(Boolean);
  }

  // クラス名(static 的呼び出し: ItemWithModel.getModelState(...))
  if (!hasCall) {
    const c = api.findClass(ident);
    if (c) return [c];
  }

  // ローカル変数: var ident = <rhs>; を遡って型推定
  if (!hasCall && docText) {
    const rhs = findLastAssignment(docText, ident);
    if (rhs) {
      const t = resolveType(rhs, api, docText, depth + 1);
      if (t.length) return t;
    }
  }

  // トップレベル関数呼び出し等は解決不能
  return [];
}

// docText から `var ident = RHS;` または `ident = RHS;` の最後の代入の RHS を返す
function findLastAssignment(docText, ident) {
  const re = new RegExp('(?:var\\s+)?' + ident.replace(/[$]/g, '\\$') + '\\s*=\\s*([^;\\n]+)', 'g');
  let m, last = null;
  while ((m = re.exec(docText)) !== null) last = m[1];
  return last ? last.trim() : null;
}

// 補完で扱うトップレベルパッケージ(これで始まる .区切りは「パッケージ/クラスのパス」とみなす)
const ROOT_PKG = /(?:^|[^\w.$"'])((?:jp|net|org|java|javax)(?:\.[A-Za-z_$][\w$]*)*\.?)$/;

// ---- 状況判定 ---------------------------------------------------------------
function analyze(linePrefix) {
  // var renderClass = "..." の文字列内 → 描画クラスの FQN を補完
  let m = linePrefix.match(/renderClass\s*=\s*["']([\w.]*)$/);
  if (m) return { type: 'renderClass', raw: m[1] };

  // importPackage(Packages.xxx / Packages.xxx
  m = linePrefix.match(/(?:importPackage\s*\(\s*)?Packages\.([\w.]*)$/);
  if (m) return { type: 'package', raw: m[1] };

  m = linePrefix.match(/\bnew\s+([\w$]*)$/);
  if (m) return { type: 'new', prefix: m[1] };

  // Packages. が無くても jp.ngt... のような FQN を直接打っているとき(文字列内含む)
  m = linePrefix.match(ROOT_PKG);
  if (m) return { type: 'package', raw: m[1] };

  // メンバアクセス: 末尾が <式>.<部分メンバ名>
  m = linePrefix.match(/^(.*)\.([A-Za-z_$][\w$]*)?$/);
  if (m) {
    const receiver = extractReceiver(m[1]);
    if (receiver) return { type: 'member', receiver, prefix: m[2] || '' };
  }

  m = linePrefix.match(/([\w$]*)$/);
  return { type: 'ident', prefix: m ? m[1] : '' };
}

// ---- 補完生成 ---------------------------------------------------------------
function buildPackageCompletions(api, raw) {
  const endsDot = raw.endsWith('.');
  const base = endsDot ? raw.slice(0, -1) : raw.split('.').slice(0, -1).join('.');
  const node = api.resolvePackageNode(base);
  const items = [];
  for (const child of node.children) items.push(makeItem(child, CK.Module, 'package', null, child, '0'));
  for (const cls of node.classes) items.push(makeItem(cls, CK.Class, base + '.' + cls, null, cls, '1'));
  return items;
}

// var renderClass = "..." 用: 描画クラスの FQN 一覧(全文を挿入)。range は呼び出し側で設定。
function buildRenderClassCompletions(api) {
  const items = [];
  for (const fqn of Object.keys(api.classesByFqn)) {
    if (!/^jp\.ngt\.rtm\.render\.[A-Za-z0-9_]*Renderer$/.test(fqn)) continue;
    const it = makeItem(fqn, CK.Class, 'renderClass', '描画スクリプトの renderClass に指定するクラス', fqn, '0');
    it.filterText = fqn;
    items.push(it);
  }
  return items;
}

function buildClassCompletions(api, limit) {
  const items = [];
  for (const [short, fqns] of api.classShortNames) {
    const fqn = fqns[0];
    const doc = fqns.length > 1 ? '候補:\n' + fqns.map(f => '- `' + f + '`').join('\n') : '`' + fqn + '`';
    items.push(makeItem(short, CK.Class, fqn, doc, short, '3'));
    if (limit && items.length >= limit) break;
  }
  return items;
}

// 難読名 -> 読める意味(1.12.2 のみ)
function obfMeaning(version, name) {
  return version === '1.12.2' ? (OBF_MEANING_1122[name] || null) : null;
}

// レシーバの型が解決できたら「その型のメンバーだけ」を出す(無関係な型のメソッドは混ぜない)。
// 型が解決できないときだけ、横断プール + 難読をフォールバックで出す。
function buildMemberCompletions(api, resolvedClasses, version) {
  const items = [];
  const seen = new Set();
  const add = (label, kind, detail, doc, sort) => {
    const key = kind + '|' + label;
    if (seen.has(key)) return; seen.add(key);
    items.push(makeItem(label, kind, detail, doc, label, sort));
  };

  const classes = (resolvedClasses || []).filter(Boolean);
  const resolved = classes.length > 0;

  // 1) 型が解決できたクラスのメンバー
  for (const c of classes) {
    for (const m of c.methods || []) {
      const mean = obfMeaning(version, m.name);
      add(m.name, CK.Method, mean ? mean : methodSignature(m), '`' + c.name + '` のメソッド', '0');
    }
    for (const f of c.fields || []) {
      const mean = obfMeaning(version, f.name);
      add(f.name, CK.Field, mean ? mean : (f.name + ': ' + f.type), '`' + c.name + '` のフィールド', '1');
    }
  }

  if (resolved) {
    // Entity 系だけは難読フィールド/メソッド(field_70177_z=rotationYaw 等)も実際に使うので足す。
    // それ以外の型は、無関係なメソッドを混ぜないため「その型のメンバーのみ」で終える。
    const isEntity = classes.some(c => /Entity/.test(c.name));
    if (isEntity) {
      for (const fm of api.obfMethods) {
        const mean = obfMeaning(version, fm);
        const owners = api.memberOwners[fm];
        add(fm, CK.Method, mean ? mean : '難読メソッド', owners ? '使用箇所: ' + owners.slice(0, 4).join(', ') : null, '7');
      }
      for (const ff of api.obfFields) {
        const mean = obfMeaning(version, ff);
        add(ff, CK.Field, mean ? mean : '難読フィールド', null, '8');
      }
    }
    return items;
  }

  // 2) 型が不明なときのフォールバック: 横断プール + 難読(前方一致で絞られる)
  for (const [name, e] of api.memberPool) {
    const mean = obfMeaning(version, name);
    if (e.kind === 'method') add(name, CK.Method, mean ? mean : methodSignature(e), '所属: ' + e.owners.slice(0, 4).join(', '), '5');
    else add(name, CK.Field, mean ? mean : (name + ': ' + (e.type || '')), '所属: ' + e.owners.slice(0, 4).join(', '), '6');
  }
  for (const fm of api.obfMethods) {
    const mean = obfMeaning(version, fm);
    const owners = api.memberOwners[fm];
    add(fm, CK.Method, mean ? mean : '難読メソッド', owners ? '使用箇所: ' + owners.slice(0, 4).join(', ') : null, '7');
  }
  for (const ff of api.obfFields) {
    const mean = obfMeaning(version, ff);
    add(ff, CK.Field, mean ? mean : '難読フィールド', null, '8');
  }

  return items;
}

// GL11.xxx の補完(LWJGL — DBには無いので知識レイヤーから)
function buildGL11Completions() {
  const items = [];
  for (const [name, sig, doc] of GL11_METHODS) {
    items.push(makeItem(name, CK.Method, 'GL11.' + name + sig, doc, name, '0'));
  }
  for (const c of GL11_CONSTANTS) {
    items.push(makeItem(c, CK.Constant, 'GL11 定数', null, c, '1'));
  }
  return items;
}

function buildIdentCompletions(api) {
  const items = [];
  // コールバック・Rhino組込みも「名前だけ」を挿入する(構文の塊を一気に展開しない)。
  // どんな関数/シグネチャかは detail / documentation で確認できる。
  for (const cb of SCRIPT_CALLBACKS) {
    const detail = 'function ' + cb.name + '(' + cb.params.join(', ') + ')';
    items.push(makeItem(cb.name, CK.Function, 'RTM コールバック  ' + detail, cb.doc, cb.name, '0'));
  }
  for (const b of RHINO_BUILTINS) {
    items.push(makeItem(b.name, CK.Keyword, 'Rhino/Nashorn', b.doc, b.name, '1'));
  }
  // GL11(描画スクリプトで頻出)
  items.push(makeItem('GL11', CK.Class, 'org.lwjgl.opengl.GL11', 'OpenGL。glPushMatrix / glRotatef など', 'GL11', '1'));
  // 組込みグローバル
  for (const g of Object.keys(SCRIPT_GLOBALS)) {
    items.push(makeItem(g, CK.Variable, 'RTM グローバル: ' + SCRIPT_GLOBALS[g].types[0], SCRIPT_GLOBALS[g].doc, g, '2'));
  }
  for (const it of buildClassCompletions(api, 4000)) items.push(it);
  return items;
}

function createProvider(state, shouldActivate) {
  return {
    provideCompletionItems(document, position) {
      if (!shouldActivate(document)) return undefined;
      const api = state.current();
      if (!api || !api.ok) return undefined;

      const version = state.versionName ? state.versionName() : '1.12.2';
      const linePrefix = document.lineAt(position).text.slice(0, position.character);
      const ctx = analyze(linePrefix);

      let items = [];
      switch (ctx.type) {
        case 'renderClass': {
          items = buildRenderClassCompletions(api);
          // 文字列内に打った部分を丸ごと FQN で置き換える(重複を防ぐ)
          const qm = linePrefix.match(/(["'])([\w.]*)$/);
          if (qm) {
            const startCh = position.character - qm[2].length;
            const range = new vscode.Range(position.line, startCh, position.line, position.character);
            for (const it of items) it.range = range;
          }
          break;
        }
        case 'package':
          items = buildPackageCompletions(api, ctx.raw);
          break;
        case 'new':
          items = buildClassCompletions(api, 4000);
          break;
        case 'member': {
          // GL11. は LWJGL なので知識レイヤーから直接
          if (ctx.receiver === 'GL11') { items = buildGL11Completions(); break; }
          const docText = document.getText();
          const resolved = resolveType(ctx.receiver, api, docText, 0);
          items = buildMemberCompletions(api, resolved, version);
          break;
        }
        default:
          items = buildIdentCompletions(api);
          break;
      }
      return new vscode.CompletionList(items, false);
    },
  };
}

module.exports = { createProvider, analyze, resolveType, extractReceiver, splitTopLevelDots, detectRenderClass, GLOBAL_TYPES };

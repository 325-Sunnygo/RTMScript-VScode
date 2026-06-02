'use strict';
/*
 * signature.js
 * メソッド呼び出しの「(」を打ったときに引数ヒントを出す SignatureHelpProvider。
 * レシーバの型を解決して、その型のメソッドの引数を表示する。
 */

const vscode = require('vscode');
const { resolveType, extractReceiver } = require('./completion');
const { GL11_METHODS } = require('./knowledge');

// カーソルを囲む呼び出しの開き括弧を探し、メソッド名・レシーバ・active引数を返す
function findEnclosingCall(text) {
  let depth = 0;
  let i = text.length - 1;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') {
      if (depth === 0) { if (ch === '(') break; else return null; }
      depth--;
    }
  }
  if (i < 0) return null;
  const openIdx = i;
  // 開き括弧の前のトークン = メソッド/関数名
  const before = text.slice(0, openIdx);
  const nameMatch = before.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  // 名前の前が "." ならレシーバあり
  const beforeName = before.slice(0, before.length - nameMatch[0].length);
  let receiver = null;
  if (/\.\s*$/.test(beforeName)) {
    receiver = extractReceiver(beforeName.replace(/\.\s*$/, ''));
  }
  // active 引数 = 開き括弧から後ろのトップレベルのカンマ数
  const inside = text.slice(openIdx + 1);
  let d = 0, commas = 0, str = null;
  for (let k = 0; k < inside.length; k++) {
    const c = inside[k];
    if (str) { if (c === str && inside[k - 1] !== '\\') str = null; continue; }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) commas++;
  }
  return { name, receiver, activeParam: commas };
}

function sigInfo(label, params, activeParam) {
  const info = new vscode.SignatureInformation(label);
  info.parameters = (params || []).map(p => new vscode.ParameterInformation(p));
  return info;
}

function createSignatureProvider(state, shouldActivate) {
  return {
    provideSignatureHelp(document, position) {
      if (!shouldActivate(document)) return null;
      const api = state.current();
      if (!api || !api.ok) return null;

      // カーソルまでのテキスト(数行さかのぼる)
      const start = new vscode.Position(Math.max(0, position.line - 40), 0);
      const text = document.getText(new vscode.Range(start, position));
      const call = findEnclosingCall(text);
      if (!call) return null;

      const sigs = [];

      // GL11.メソッド
      if (call.receiver === 'GL11') {
        const g = GL11_METHODS.find(x => x[0] === call.name);
        if (g) {
          const params = g[1].replace(/^\(|\)$/g, '').split(',').map(s => s.trim()).filter(Boolean);
          sigs.push(sigInfo('GL11.' + g[0] + g[1], params, call.activeParam));
        }
      } else {
        // レシーバの型からメソッドを探す
        let classes = [];
        if (call.receiver) classes = resolveType(call.receiver, api, document.getText(), 0);
        const seen = new Set();
        for (const c of classes) {
          for (const m of (c.methods || [])) {
            if (m.name !== call.name) continue;
            const key = m.params.length + ':' + m.params.join(',');
            if (seen.has(key)) continue; seen.add(key);
            sigs.push(sigInfo(call.name + '(' + m.params.join(', ') + ')' + (m.ret ? ': ' + m.ret : ''), m.params, call.activeParam));
          }
        }
        // 型が解決できないときは横断プールから1件
        if (!sigs.length) {
          const e = api.memberPool.get(call.name);
          if (e && e.kind === 'method') {
            sigs.push(sigInfo(call.name + '(' + (e.params || []).join(', ') + ')' + (e.ret ? ': ' + e.ret : ''), e.params, call.activeParam));
          }
        }
      }

      if (!sigs.length) return null;
      const help = new vscode.SignatureHelp();
      help.signatures = sigs;
      help.activeSignature = 0;
      help.activeParameter = Math.min(call.activeParam, Math.max(0, (sigs[0].parameters.length - 1)));
      return help;
    },
  };
}

module.exports = { createSignatureProvider, findEnclosingCall };

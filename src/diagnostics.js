'use strict';
/*
 * diagnostics.js
 * acorn で ES5 構文を解析し、構文エラーを赤の波線(Diagnostic)として表示する。
 * RTM/Rhino 特有のグローバル(importPackage, Packages 等)は単なる識別子なので
 * 構文解析には影響しない。未定義変数チェックはしない(誤検知を避けるため構文のみ)。
 */

const vscode = require('vscode');
const acorn = require('acorn');

function ecmaFromConfig(v) {
  if (v === '2015') return 2015;
  if (v === '2017') return 2017;
  return 5;
}

function createDiagnostics(getConfig, shouldActivate) {
  const collection = vscode.languages.createDiagnosticCollection('rtmScript');

  function run(document) {
    if (document.languageId !== 'javascript' && document.languageId !== 'rtmjs') { collection.delete(document.uri); return; }
    const cfg = getConfig();
    if (!cfg.enableDiagnostics || !shouldActivate(document)) {
      collection.delete(document.uri);
      return;
    }

    const text = document.getText();
    const diags = [];
    try {
      acorn.parse(text, {
        ecmaVersion: ecmaFromConfig(cfg.ecmaVersion),
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        allowHashBang: true,
        locations: true,
      });
    } catch (e) {
      // acorn のエラーは pos(オフセット) と loc を持つ
      let range;
      if (e.loc && typeof e.loc.line === 'number') {
        const line = Math.max(0, e.loc.line - 1);
        const col = Math.max(0, e.loc.column);
        const lineText = (document.lineCount > line) ? document.lineAt(line).text : '';
        const end = Math.min(lineText.length, col + 1) || lineText.length;
        range = new vscode.Range(line, col, line, Math.max(col + 1, end));
      } else if (typeof e.pos === 'number') {
        const p = document.positionAt(e.pos);
        range = new vscode.Range(p, p.translate(0, 1));
      } else {
        range = new vscode.Range(0, 0, 0, 1);
      }
      const msg = (e.message || 'Syntax error').replace(/\s*\(\d+:\d+\)\s*$/, '');
      const d = new vscode.Diagnostic(range, '構文エラー: ' + msg, vscode.DiagnosticSeverity.Error);
      d.source = 'RTM(ES' + cfg.ecmaVersion + ')';
      diags.push(d);
    }
    collection.set(document.uri, diags);
  }

  return { collection, run };
}

module.exports = { createDiagnostics };

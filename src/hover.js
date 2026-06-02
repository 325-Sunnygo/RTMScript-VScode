'use strict';
/*
 * hover.js
 * メソッド/フィールド/クラス/難読名にカーソルを乗せると説明を出す HoverProvider。
 *   - 難読名(func_/field_)は読める意味(1.12.2)
 *   - メソッド/フィールドはシグネチャと所属クラス
 *   - クラス短縮名は FQN
 *   - GL11 メソッドは引数と説明
 *   - 組込みグローバルは型と説明
 */

const vscode = require('vscode');
const { GL11_METHODS, OBF_MEANING_1122, SCRIPT_GLOBALS } = require('./knowledge');

function md(s) { return new vscode.MarkdownString(s); }

function createHoverProvider(state, shouldActivate) {
  return {
    provideHover(document, position) {
      if (!shouldActivate(document)) return null;
      const api = state.current();
      if (!api || !api.ok) return null;

      const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/);
      if (!range) return null;
      const word = document.getText(range);
      const version = state.versionName ? state.versionName() : '1.12.2';

      // 難読名の意味
      if (/^(func_|field_)/.test(word)) {
        const mean = version === '1.12.2' ? OBF_MEANING_1122[word] : null;
        const owners = api.memberOwners[word];
        let s = '**' + word + '** ' + (/^func_/.test(word) ? '(難読メソッド)' : '(難読フィールド)');
        if (mean) s += '\n\n→ ' + mean;
        if (owners && owners.length) s += '\n\n使用箇所: ' + owners.slice(0, 5).map(o => '`' + o + '`').join(', ');
        return new vscode.Hover(md(s), range);
      }

      // 組込みグローバル
      if (SCRIPT_GLOBALS[word]) {
        const g = SCRIPT_GLOBALS[word];
        return new vscode.Hover(md('**' + word + '** — RTM グローバル\n\n型: `' + g.types[0] + '`\n\n' + g.doc), range);
      }

      // GL11 / GL11メソッド
      if (word === 'GL11') return new vscode.Hover(md('**GL11** — `org.lwjgl.opengl.GL11`(OpenGL)'), range);
      const g = GL11_METHODS.find(x => x[0] === word);
      if (g) return new vscode.Hover(md('**GL11.' + g[0] + g[1] + '**\n\n' + g[2]), range);

      // クラス短縮名
      const fqns = api.classShortNames.get(word);
      if (fqns && fqns.length) {
        const s = '**' + word + '** — クラス\n\n' + fqns.map(f => '`' + f + '`').join('\n\n');
        return new vscode.Hover(md(s), range);
      }

      // メソッド/フィールド(横断プール)
      const e = api.memberPool.get(word);
      if (e) {
        let s;
        if (e.kind === 'method') s = '**' + e.name + '(' + (e.params || []).join(', ') + ')**' + (e.ret ? ': `' + e.ret + '`' : '');
        else s = '**' + e.name + '**: `' + (e.type || '') + '`';
        s += '\n\n所属: ' + (e.owners || []).slice(0, 5).map(o => '`' + o + '`').join(', ');
        return new vscode.Hover(md(s), range);
      }

      return null;
    },
  };
}

module.exports = { createHoverProvider };

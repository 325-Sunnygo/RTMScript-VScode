'use strict';
/*
 * detect.js
 * 「RTM スクリプトらしい .js か」を判定する純粋関数。
 * activateOnlyInRtmScripts=true(既定)のとき、普通の JavaScript 開発を妨げないために使う。
 */

// 中身に RTM 特有の記述があるか
const RTM_CONTENT = /\bimportPackage\s*\(|\bPackages\.|\brenderer\b|\bscriptExecuter\b|registerParts\b|function\s+(onUpdate|render|init)\s*\(/;
// RTM モデルパックのスクリプト配置(assets/.../scripts)
const SCRIPTS_DIR = /\/scripts\//i;
// RTM スクリプトでよく使われるファイル名
const RTM_FILENAME = /^(Render|Server|Sound|ANSL|Model|RTM)[_A-Za-z0-9]*\.js$/i;

function looksLikeRtmScript(text, filePath) {
  const head = (text || '').slice(0, 4000);
  if (RTM_CONTENT.test(head)) return true;
  const p = (filePath || '').replace(/\\/g, '/');
  if (SCRIPTS_DIR.test(p)) return true;
  const base = p.split('/').pop() || '';
  if (RTM_FILENAME.test(base)) return true;
  return false;
}

module.exports = { looksLikeRtmScript };

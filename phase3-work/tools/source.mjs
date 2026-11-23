import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'parse5';
import * as THREE from 'three';

export const sourcePath = new URL('../index.html', import.meta.url);
export function loadSource(file = sourcePath) {
  const html = readFileSync(file, 'utf8');
  const scripts = [];
  function visit(node) {
    if (node.tagName === 'script' && !node.attrs.some(attr => attr.name === 'src')) {
      scripts.push(node.childNodes.map(child => child.value || '').join(''));
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  const context = { window: {} };
  vm.runInNewContext(scripts.find(script => script.includes('window.AP=')), context, { timeout: 2000 });
  return { html, scripts, AP: context.window.AP };
}

export function worldColliders(script) {
  const noop = () => {};
  const ctx = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop, set: () => true });
  const scope = {
    THREE, scene: new THREE.Scene(), gl: true, colliders: [], npcs: [], texRedraw: [],
    logoImg: { complete: false }, document: { createElement: () => ({ getContext: () => ctx }) }
  };
  const start = script.indexOf('const zones=[];');
  const end = script.indexOf('/* ---------- Status colours ---------- */');
  if (start < 0 || end < 0) throw new Error('World extraction anchors changed');
  vm.runInNewContext(script.slice(start, end), scope, { timeout: 5000 });
  return JSON.parse(JSON.stringify(scope.colliders));
}
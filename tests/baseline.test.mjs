import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, worldColliders } from '../tools/source.mjs';

test('original missions, references and world collision baseline', () => {
  const { AP, scripts } = loadSource(new URL('../baseline/ITK-BGSV Prompt Works_backup_2026-11-09_10-25-05-288.html', import.meta.url));
  assert.equal(AP.MISSIONS.length, 8);
  assert.equal(AP.DISCIPLINES.length, 6);
  assert.equal(AP.PASS, 60);
  for (const mission of AP.MISSIONS) assert.equal(AP.evaluate(mission, mission.ref).score, 100, mission.id);
  const colliders = worldColliders(scripts.find(script => script.includes('function buildWorld()')));
  assert.ok(colliders.length > 50);
  assert.ok(!colliders.some(rect => 0 >= rect.x0 - .4 && 0 <= rect.x1 + .4 && 8.5 >= rect.z0 - .4 && 8.5 <= rect.z1 + .4));
});
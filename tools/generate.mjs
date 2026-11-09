import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSource, worldColliders } from './source.mjs';

const { AP, scripts } = loadSource();
const catalog = {
  missions: AP.MISSIONS.map(mission => ({ ...mission, rubric: mission.rubric.map((item, index) => ({ id: `c${index + 1}`, label: item.label, tip: item.tip })) })),
  disciplines: AP.DISCIPLINES, ranks: AP.RANKS, pass: AP.PASS,
  colliders: worldColliders(scripts.find(script => script.includes('function buildWorld()')))
};
mkdirSync('dist', { recursive: true });
writeFileSync('dist/catalog.json', JSON.stringify(catalog));
console.log(`Generated ${catalog.missions.length} missions and ${catalog.colliders.length} colliders from the game source`);
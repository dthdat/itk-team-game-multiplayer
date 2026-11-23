import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { loadSource, worldColliders } from './source.mjs';

const { AP, scripts } = loadSource();
const catalog = {
  templateHistory: JSON.parse(readFileSync(new URL('../cloudflare-game/mission-template-history.json', import.meta.url),'utf8')),
  templates: JSON.parse(readFileSync(new URL('../cloudflare-game/mission-templates.json', import.meta.url),'utf8')),
  missions: AP.MISSIONS.map(mission => ({ ...mission, rubric: mission.rubric.map((item, index) => ({ id: `c${index + 1}`, label: item.label, tip: item.tip })) })),
  disciplines: AP.DISCIPLINES, ranks: AP.RANKS, pass: AP.PASS,
  colliders: worldColliders(scripts.find(script => script.includes('function buildWorld()')))
};
mkdirSync('dist', { recursive: true });
writeFileSync('dist/catalog.json', JSON.stringify(catalog));
console.log(`Generated ${catalog.missions.length} missions and ${catalog.colliders.length} colliders from the game source`);
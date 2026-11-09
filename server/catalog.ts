import { readFileSync } from 'node:fs';

export interface Criterion { id: string; label: string; tip: string }
export interface Mission {
  id: string; dept: string | null; xp: number; minWords: number; needs?: number;
  brief: string; task: string; lesson: string; data: string[][] | null;
  rubric: Criterion[]; ref: string;
}
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8')) as {
  missions: Mission[]; disciplines: { id: string; name: string; color: string }[];
  ranks: { min: number; name: string }[]; pass: number; colliders: Rect[];
};
export const missions = new Map(catalog.missions.map(mission => [mission.id, mission]));
export const disciplines = new Map(catalog.disciplines.map(discipline => [discipline.id, discipline]));
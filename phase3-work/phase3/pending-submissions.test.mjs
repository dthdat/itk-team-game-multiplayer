import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migratePendingSubmissions, savePendingSubmission } from './pending-submissions.mjs';

test('pending answers are durable, idempotent and deleted with their owner', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE guests(id TEXT PRIMARY KEY); INSERT INTO guests VALUES (\'g1\');');
  migratePendingSubmissions(db); migratePendingSubmissions(db);
  const ids = new Set(['onboard']);
  const submission = { owner: 'g1', submissionId: randomUUID(), missionId: 'onboard', answer: 'An engineering answer' };
  assert.equal(savePendingSubmission(db, submission, ids).state, 'pending');
  assert.equal(savePendingSubmission(db, submission, ids).duplicate, true);
  assert.throws(() => savePendingSubmission(db, { ...submission, answer: 'changed' }, ids), /different content/);
  assert.throws(() => savePendingSubmission(db, { ...submission, submissionId: randomUUID(), missionId: 'invalid' }, ids), /Invalid/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM phase3_pending_submissions').get().n, 1);
  db.prepare('DELETE FROM guests WHERE id=?').run('g1');
  assert.equal(db.prepare('SELECT count(*) AS n FROM phase3_pending_submissions').get().n, 0);
  db.close();
});

test('pending answer survives a database close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'itk-phase3-'));
  const path = join(dir, 'test.sqlite');
  try {
    let db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE guests(id TEXT PRIMARY KEY); INSERT INTO guests VALUES ('g1')");
    migratePendingSubmissions(db);
    const submission = { owner: 'g1', submissionId: randomUUID(), missionId: 'onboard', answer: 'A fictional answer' };
    savePendingSubmission(db, submission, new Set(['onboard']));
    db.close();
    db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT answer FROM phase3_pending_submissions WHERE owner=?').get('g1').answer, submission.answer);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

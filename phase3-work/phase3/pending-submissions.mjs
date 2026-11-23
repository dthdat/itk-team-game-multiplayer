// Isolated Phase 3 prototype. Callers must authenticate and authorize the guest.
// Not wired into the running service or a production migration.
import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = s => createHash('sha256').update(s).digest('hex');

export function migratePendingSubmissions(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS phase3_pending_submissions (
      owner TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      submission_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      answer TEXT NOT NULL,
      answer_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','reviewing','graded','failed','retryable')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY(owner, submission_id)
    );
    CREATE INDEX IF NOT EXISTS phase3_pending_owner_created
      ON phase3_pending_submissions(owner, created_at DESC);`);
}

export function savePendingSubmission(db, { owner, submissionId, missionId, answer }, validMissionIds) {
  if (typeof owner !== 'string' || !owner || typeof submissionId !== 'string' || !uuid.test(submissionId) ||
      typeof missionId !== 'string' || !validMissionIds.has(missionId) || typeof answer !== 'string' ||
      !answer.trim() || answer.length > 15000) throw new Error('Invalid submission');
  const answerHash = digest(answer);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT mission_id,answer_hash,state,created_at FROM phase3_pending_submissions WHERE owner=? AND submission_id=?').get(owner, submissionId);
    if (existing) {
      if (existing.mission_id !== missionId || existing.answer_hash !== answerHash) throw new Error('Submission ID already used with different content');
      db.exec('COMMIT');
      return { submissionId, state: existing.state, createdAt: existing.created_at, duplicate: true };
    }
    const createdAt = Date.now();
    db.prepare("INSERT INTO phase3_pending_submissions VALUES(?,?,?,?,?,'pending',?)").run(owner, submissionId, missionId, answer, answerHash, createdAt);
    db.exec('COMMIT');
    return { submissionId, state: 'pending', createdAt, duplicate: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

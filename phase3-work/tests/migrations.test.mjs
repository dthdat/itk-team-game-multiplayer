import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../dist/server/store.js';
import { Accounts, runMigrations } from '../dist/server/accounts.js';

test('account schema migrations apply once and a failed migration rolls back atomically', () => {
  const store=new Store(':memory:');
  try {
    new Accounts(store.db);
    const versions=store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row=>row.version);
    assert.deepEqual(versions,[1,2,3,4,5]);
    new Accounts(store.db);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,5);
    assert.equal(store.db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='must_change_password'),true);
  } finally { store.close(); }

  const db=new DatabaseSync(':memory:');
  try {
    assert.throws(()=>runMigrations(db,[{version:99,up(database){database.exec('CREATE TABLE should_rollback(id INTEGER)');throw new Error('synthetic migration failure');}}]),/synthetic migration failure/);
    assert.throws(()=>db.prepare('SELECT * FROM should_rollback').all(),/no such table/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,0);
  } finally { db.close(); }
});

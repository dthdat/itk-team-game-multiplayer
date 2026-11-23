import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/server/store.js';
import { Accounts } from '../dist/server/accounts.js';
import { createBackup, restoreBackup, verifySQLite } from '../tools/backup.mjs';

test('SQLite online backup, integrity verification and restore preserve account and pending submission',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'itk-phase3-backup-')),database=join(dir,'game.sqlite'),backup=join(dir,'backups','game.sqlite');
  try{
    let store=new Store(database),accounts=new Accounts(store.db),invite=accounts.issueInvite();
    const created=await accounts.register({invitation:invite,loginId:'backup.engineer',password:'Backups are important 42'});
    accounts.setProfile(created.id,'Backup Engineer','battery',{style:'vest'});
    accounts.submit(created.id,{submissionId:crypto.randomUUID(),missionId:'onboard',answer:'A private pending answer.'});
    store.savePosition(created.id,1.25,2.5,-0.5);
    await createBackup(database,backup);assert.equal(verifySQLite(backup),true);assert.equal((await stat(backup)).mode&0o777,0o600);
    store.close();
    await rm(database,{force:true});await rm(`${database}-wal`,{force:true});await rm(`${database}-shm`,{force:true});
    await restoreBackup(backup,database);
    assert.equal((await stat(database)).mode&0o777,0o600);
    store=new Store(database);accounts=new Accounts(store.db);
    const restored=accounts.session(created.session.token);assert.equal(restored.id,created.id);assert.equal(restored.name,'Backup Engineer');
    assert.equal(store.position(created.id).x,1.25);
    assert.equal(accounts.submissions(created.id)[0].state,'pending');assert.equal(accounts.submissions(created.id)[0].answer,'A private pending answer.');
    store.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});

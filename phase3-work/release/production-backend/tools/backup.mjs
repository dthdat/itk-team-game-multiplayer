import { DatabaseSync } from 'node:sqlite';
import { chmod, copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exists(path){try{await stat(path);return true;}catch{return false;}}

export function verifySQLite(path){
  const db=new DatabaseSync(path);
  try{
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error(`SQLite integrity check failed for ${path}`);
    const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
    if(foreignKeys.length)throw new Error(`SQLite foreign-key check failed for ${path}`);
    return true;
  }finally{db.close();}
}

export async function createBackup(source,destination){
  source=resolve(source);destination=resolve(destination);
  if(source===destination)throw new Error('Backup destination must differ from the live database');
  if(!(await exists(source)))throw new Error('Source database does not exist');
  if(await exists(destination))throw new Error('Backup destination already exists');
  await mkdir(dirname(destination),{recursive:true});
  const db=new DatabaseSync(source,{readOnly:true});
  try{
    const quote=destination.replaceAll("'","''");
    db.exec(`VACUUM INTO '${quote}'`);
  }finally{db.close();}
  await chmod(destination,0o600);
  verifySQLite(destination);
  return destination;
}

export async function restoreBackup(source,target,{force=false}={}){
  source=resolve(source);target=resolve(target);
  if(source===target)throw new Error('Backup and restore target must differ');
  if(!(await exists(source)))throw new Error('Backup does not exist');
  verifySQLite(source);
  const targetExists=await exists(target);
  if(targetExists&&!force)throw new Error('Restore target exists; pass --force after stopping the service');
  for(const suffix of ['-wal','-shm'])if(await exists(target+suffix))throw new Error(`Remove active SQLite sidecar ${target+suffix}; stop the service before restore`);
  await mkdir(dirname(target),{recursive:true});
  if(targetExists){
    const safety=`${target}.pre-restore-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
    await createBackup(target,safety);
  }
  const temporary=`${target}.restore-${process.pid}.tmp`;
  if(await exists(temporary))await unlink(temporary);
  await copyFile(source,temporary);
  await chmod(temporary,0o600);
  verifySQLite(temporary);
  await rename(temporary,target);
  await chmod(target,0o600);
  return target;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [action,sourceArg,destination,flag]=process.argv.slice(2);
  const source=sourceArg||process.env.SQLITE_PATH||'./data/game.sqlite';
  if(action==='backup'){
    const backupDir=process.env.BACKUP_DIR||join(dirname(resolve(source)),'backups');
    const output=destination||join(backupDir,`game-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
    await createBackup(source,output);
    const retentionDays=Number(process.env.BACKUP_RETENTION_DAYS||30);
    if(Number.isInteger(retentionDays)&&retentionDays>0){for(const entry of await (await import('node:fs/promises')).readdir(backupDir,{withFileTypes:true})){if(!entry.isFile()||!/^game-.*\.sqlite$/.test(entry.name))continue;const path=join(backupDir,entry.name);if(path===resolve(output))continue;if(Date.now()-(await stat(path)).mtimeMs>retentionDays*86400000)await unlink(path);}}
    console.log(`Verified SQLite backup: ${output}`);
  }else if(action==='verify'&&source){verifySQLite(source);console.log(`SQLite backup is valid: ${source}`);}
  else if(action==='restore'&&source&&destination){
    await restoreBackup(source,destination,{force:flag==='--force'});console.log(`Restored verified SQLite backup to: ${destination}`);
  }else{console.error('Usage: node tools/backup.mjs backup <db> [backup-file] | verify <backup-file> | restore <backup-file> <db> [--force]');process.exitCode=2;}
}

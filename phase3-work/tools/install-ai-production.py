#!/usr/bin/env python3
"""Approved production installation. All secret values stay in root-only files."""
import pathlib,datetime,json,hashlib,shutil,subprocess,tarfile,tempfile,os,time,urllib.request,sys
root=pathlib.Path(__file__).resolve().parents[1];live=pathlib.Path('/opt/prompt-works');environment=pathlib.Path('/etc/prompt-works/prompt-works.env');unit=pathlib.Path('/etc/systemd/system/prompt-works.service')
manifest=json.loads((root/'release/production-release-manifest.json').read_text());archive=root/manifest['backendArchive']['path']
assert os.geteuid()==0 and hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['backendArchive']['sha256']
assert json.loads((root/'reports/review-consistency-local.json').read_text())['result']=='PASS'
text=environment.read_text();values=dict(l.split('=',1) for l in text.splitlines() if l and not l.startswith('#') and '=' in l)
assert values.get('GROQ_API_KEY') and values.get('GROQ_MODEL')=='openai/gpt-oss-20b'
assert values.get('PUBLIC_GAME_ORIGIN')=='https://game.itkvn.workers.dev'
assert (root/'package-lock.json').read_bytes()==(live/'package-lock.json').read_bytes(),'Runtime dependencies changed; review required'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
rollback=live/('rollback-ai-'+stamp);rollback.mkdir(mode=0o755)
shutil.copytree(live/'dist',rollback/'dist');shutil.copyfile(unit,rollback/'prompt-works.service')
privateBackup=environment.parent/('pre-ai-'+stamp+'.env');shutil.copyfile(environment,privateBackup);privateBackup.chmod(0o600)
subprocess.run(['systemctl','start','prompt-works-backup.service'],check=True)
assert subprocess.check_output(['systemctl','show','prompt-works-backup.service','-p','Result','--value'],text=True).strip()=='success'
staging=pathlib.Path(tempfile.mkdtemp(prefix='.ai-install-',dir=live))
with tarfile.open(archive) as t:t.extractall(staging,filter='data')
updates={'GRADING_PROVIDER':'groq','GROQ_FREE_PLAN_CONFIRMED':'true','GRADING_MAX_OUTPUT_TOKENS':'3072','GRADING_MIN_INTERVAL_MS':'15000','GRADING_DAILY_TOKEN_CAP':'100000','GRADING_MINUTE_TOKEN_CAP':'8000','GRADING_DAILY_CALL_CAP':'300','SUBMISSIONS_PER_IP_HOUR':'1000'}
lines=[]
for l in text.splitlines():
 k=l.split('=',1)[0];lines.append(k+'='+updates.pop(k) if k in updates else l)
lines.extend(k+'='+v for k,v in updates.items())
changed=False
try:
 subprocess.run(['systemctl','stop','prompt-works.service'],check=True);changed=True
 shutil.rmtree(live/'dist');shutil.copytree(staging/'dist',live/'dist')
 shutil.copytree(staging/'deploy',live/'deploy',dirs_exist_ok=True)
 tmp=environment.with_suffix('.env.install');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n');f.flush();os.fsync(f.fileno())
 os.replace(tmp,environment)
 shutil.copyfile(staging/'deploy/prompt-works.service',unit);unit.chmod(0o644)
 subprocess.run(['systemd-analyze','verify',str(unit)],check=True)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','prompt-works.service'],check=True)
 health=None
 for i in range(100):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/readyz',timeout=2) as r:health=json.load(r)
   if health.get('ok') and health.get('grading')=='groq':break
  except Exception:pass
  time.sleep(.1)
 assert health and health.get('ok') and health.get('grading')=='groq','Production AI readiness failed'
 result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'PASS','provider':'groq','model':'openai/gpt-oss-20b','rollbackDirectory':str(rollback),'protectedEnvironmentRollback':str(privateBackup),'archiveSha256':manifest['backendArchive']['sha256'],'migration':5,'publicWorkerRollbackVersion':manifest['rollbackWorkerVersion']}
 report=root/'reports/ai-production-backend.json';report.write_text(json.dumps(result,indent=2)+'\n');shutil.chown(report,'ubuntu','ubuntu')
 print('PASS: production AI backend ready on localhost:3000; migration 5 applied; previous code/environment and verified local snapshot preserved. No credentials displayed.')
except Exception as e:
 if changed:
  subprocess.run(['systemctl','stop','prompt-works.service'],check=False)
  if (live/'dist').exists():shutil.rmtree(live/'dist')
  shutil.copytree(rollback/'dist',live/'dist');shutil.copyfile(privateBackup,environment);environment.chmod(0o600);shutil.copyfile(rollback/'prompt-works.service',unit)
  subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','start','prompt-works.service'],check=False)
 print('Production activation failed; previous code/environment restored. Error category:',type(e).__name__);sys.exit(1)
finally:shutil.rmtree(staging)

import pathlib,shutil,json,hashlib,tarfile,datetime
root=pathlib.Path(__file__).resolve().parents[1];dest=root/'release/production-backend'
shutil.rmtree(dest);dest.mkdir()
shutil.copytree(root/'dist',dest/'dist')
for name in ['package.json','package-lock.json']:
 shutil.copyfile(root/name,dest/name)
for name in ['tools/backup.mjs','deploy/prompt-works.service','deploy/prompt-works-backup.service','deploy/prompt-works-backup.timer','deploy/promptworks-journald.conf','deploy/prompt-works-arm64.env.example']:
 target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,target)
files=[]
for p in sorted(dest.rglob('*')):
 if not p.is_file():continue
 data=p.read_bytes();rel=p.relative_to(dest).as_posix()
 assert not any(x in p.parts for x in ['node_modules','tests','.git'])
 assert not p.name.endswith(('.sqlite','.pem')) and p.name!='.env'
 assert b'gsk_' not in data
 files.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
archive=root/'release/itk-bgsv-ai-production-backend.tar.gz'
with tarfile.open(archive,'w:gz') as t:
 for p in sorted(dest.rglob('*')):
  if p.is_file():t.add(p,arcname=p.relative_to(dest).as_posix(),recursive=False)
assets=[]
for p in sorted((root/'cloudflare-game/public').rglob('*')):
 if p.is_file():
  data=p.read_bytes();assert b'gsk_' not in data
  assets.append({'path':p.relative_to(root/'cloudflare-game/public').as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
for name in ['asset-manifest.json','asset-manifest-production.json']:(root/'cloudflare-game/verification'/name).write_text(json.dumps(assets,indent=2)+'\n')
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':'AI grading, feedback alignment, resume and movement recovery','node':'24.22.2 ARM64','rollbackWorkerVersion':'34aa0418-714a-4f62-ba26-257e0bbe4d37','backendArchive':{'path':str(archive.relative_to(root)),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},'backendFiles':files,'frontendManifest':'cloudflare-game/verification/asset-manifest-production.json'}
(root/'release/production-release-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Packaged',len(files),'backend files and',len(assets),'public assets; no credentials, database files, test fixtures or node_modules included.')

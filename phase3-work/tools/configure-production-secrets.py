#!/usr/bin/env python3
"""Interactive secret entry on Oracle. Never pass secret values as arguments."""
import getpass,json,os,pathlib,subprocess,sys,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
ENV=pathlib.Path('/etc/prompt-works/prompt-works.env')
def validate_groq_key(key):
 # Identify this application explicitly; the default Python client receives an
 # edge 403 from this host before Groq can validate the Authorization header.
 req=urllib.request.Request('https://api.groq.com/openai/v1/models',headers={
  'Authorization':'Bearer '+key,
  'Accept':'application/json',
  'User-Agent':'ITK-BGSV-Setup/1.0'
 })
 try:
  with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  # Do not echo response bodies/messages: they are untrusted and may contain
  # request details. Only fixed diagnostics may reach the terminal.
  hints={401:'Groq rejected authentication; check that the key is active and copied completely.',
         403:'Groq denied access; check organization/project permissions and network restrictions.',
         429:'Groq rate limit reached; wait before retrying.'}
  raise RuntimeError('Groq key validation returned HTTP '+str(e.code)+'. '+hints.get(e.code,'Groq could not validate the key; retry later.')+' No configuration changed.') from None
 except (urllib.error.URLError,TimeoutError):
  raise RuntimeError('Groq models endpoint could not be reached. No configuration changed.') from None
 except ValueError:
  raise RuntimeError('Groq returned an invalid models response. No configuration changed.') from None
def main():
 if os.geteuid()!=0:raise RuntimeError('Run with sudo so protected production configuration can be read.')
 if len(sys.argv)!=2 or sys.argv[1] not in ('cloudflare','groq'):raise RuntimeError('Usage: sudo python3 tools/configure-production-secrets.py cloudflare|groq')
 if not sys.stdin.isatty():raise RuntimeError('Use an interactive terminal for hidden secret entry.')
 text=ENV.read_text();values=dict(line.split('=',1) for line in text.splitlines() if line and not line.startswith('#') and '=' in line)
 if sys.argv[1]=='cloudflare':
  client=getpass.getpass('Production Access Client ID (hidden): ').strip()
  secret=getpass.getpass('Production Access Client Secret (hidden): ').strip()
  if not client.endswith('.access') or len(secret)<20:raise RuntimeError('Invalid service-token format; nothing uploaded.')
  proxy=values.get('TRUSTED_PROXY_SECRET','')
  if len(proxy)<32:raise RuntimeError('Production proxy secret is missing.')
  payload={'ORIGIN_BASE':'https://api.itkteam.store','GAME_PROXY_SECRET':proxy,'CF_ACCESS_CLIENT_ID':client,'CF_ACCESS_CLIENT_SECRET':secret}
  command=['sudo','-u','ubuntu','--','/opt/prompt-works/runtime/node',str(ROOT/'cloudflare-game/node_modules/wrangler/wrangler-dist/cli.js'),'secret','bulk','--name','game','--env','']
  result=subprocess.run(command,cwd=ROOT/'cloudflare-game',input=json.dumps(payload),text=True,capture_output=True)
  if result.returncode:raise RuntimeError('Worker secret upload failed. No credential or command output is displayed; check Wrangler authentication with whoami.')
  print('Four correctly named secrets uploaded only to Worker game. GAME_PROXY_SECRET matches the protected Oracle value. Frontend release still requires the secure route verification and deployment.')
 else:
  if input('Confirm this Groq organization is on the Free plan (type FREE): ').strip()!='FREE':raise RuntimeError('Stopped; paid usage is not authorized.')
  key=getpass.getpass('Groq API key (hidden): ').strip()
  if not key.startswith('gsk_') or len(key)<20:raise RuntimeError('Invalid API key format; nothing stored.')
  data=validate_groq_key(key)
  models={m.get('id') for m in data.get('data',[])};model='openai/gpt-oss-20b'
  if model not in models:raise RuntimeError('Expected model is not available; no configuration changed.')
  updates={'GROQ_API_KEY':key,'GROQ_MODEL':model,'GRADING_PROVIDER':'mock'}
  lines=[]
  for line in text.splitlines():
   name=line.split('=',1)[0]
   lines.append(name+'='+updates.pop(name) if name in updates else line)
  lines.extend(k+'='+v for k,v in updates.items())
  tmp=ENV.with_suffix('.env.new');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n');f.flush();os.fsync(f.fileno())
  os.replace(tmp,ENV)
  print('Groq key validated through the models endpoint and stored only in protected Oracle configuration. No inference request was made. Grading remains mock/zero-XP until the persistent grading queue is implemented and tested; no service restart performed.')
if __name__=='__main__':
 try:main()
 except (RuntimeError,OSError,ValueError) as exc:
  print('Configuration stopped: '+str(exc) if isinstance(exc,RuntimeError) else 'Configuration stopped due to a local file or input error.',file=sys.stderr);sys.exit(1)

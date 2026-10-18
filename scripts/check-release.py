"""Validate source-offer configuration; never publish or access a remote URL."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse, json, re

def check(config):
 issues=[]
 if config.get('license')!='AGPL-3.0-only':issues.append('LICENSE_MISMATCH')
 url=config.get('sourceUrl')
 if not isinstance(url,str) or not url:issues.append('PUBLIC_SOURCE_URL_REQUIRED')
 else:
  u=urlsplit(url);host=(u.hostname or '').lower()
  if u.scheme!='https' or not host or u.username or u.password or u.query or u.fragment:
   issues.append('PUBLIC_SOURCE_URL_INVALID')
  if host in ['localhost','127.0.0.1','::1'] or host.endswith(('.local','.invalid')) or re.match(r'^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)',host):issues.append('NONPUBLIC_SOURCE_ENDPOINT')
  parts=unquote(u.path).lower().strip('/').split('/')
  if host=='github.com' and len(parts)>=2 and parts[0]=='zeola0187' and parts[1].removesuffix('.git') in ['scean-dev','zeolas','dsh-card-studio']:issues.append('KNOWN_PRIVATE_REPOSITORY_NOT_PUBLIC_SOURCE')
 if not re.fullmatch(r'[0-9a-f]{40,64}',str(config.get('revision',''))):issues.append('EXACT_SOURCE_REVISION_REQUIRED')
 if not re.fullmatch(r'[0-9a-f]{64}',str(config.get('sourceArchiveSha256',''))):issues.append('MATCHING_SOURCE_ARCHIVE_HASH_REQUIRED')
 if config.get('anonymousSourceAccessVerified') is not True:issues.append('ANONYMOUS_SOURCE_ACCESS_NOT_VERIFIED')
 if config.get('networkSourceNoticeReady') is not True:issues.append('PROMINENT_NETWORK_SOURCE_OFFER_NOT_VERIFIED')
 return {'status':'HOLD' if issues else 'CONFIGURATION_COMPLETE_EXTERNAL_ATTESTATIONS_PRESENT','issues':issues,'networkAccessPerformed':False,'publicationPerformed':False,'note':'Configuration validation only; verify anonymous access, visible source offer and exact build externally before authorized publication.'}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--config',default=str(Path(__file__).resolve().parents[1]/'release-source.json'));a=p.parse_args()
 result=check(json.loads(Path(a.config).read_text(encoding='utf-8')));print(json.dumps(result,indent=2));raise SystemExit(1 if result['issues'] else 0)

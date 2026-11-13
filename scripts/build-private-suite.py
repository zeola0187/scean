"""Private canonical build entry point; legacy overlay builder is archived."""
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parents[1]
args=[a for a in sys.argv[1:] if a!='--update-runtime']
raise SystemExit(subprocess.run([sys.executable,str(root/'scripts/build-candidate.py'),*args]).returncode)

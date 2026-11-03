#!/bin/bash
# Assembles the deployable files into dist/
set -e
cd "$(dirname "$0")"
mkdir -p dist/backend dist/app
PARSER="$(grep -v 'module.exports' src/parser.js)"

{ echo "$PARSER"; echo; cat src/backend.gs.js; } > dist/backend/Code.gs
cat > dist/backend/appsscript.json <<'JSON'
{
  "timeZone": "Asia/Kolkata",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
JSON

if [ -f src/index.html ]; then
  python3 - <<'PY'
src = open("src/index.html").read()
parser = ''.join(l for l in open('src/parser.js') if 'module.exports' not in l)
open('dist/app/index.html', 'w').write(src.replace('/*__PARSER__*/', parser))
PY
  cp src/manifest.webmanifest src/sw.js dist/app/
fi
echo built

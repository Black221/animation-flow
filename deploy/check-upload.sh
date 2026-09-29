#!/usr/bin/env bash
# Sends a 12 MB picture through the load balancer, as someone bringing a model to the AI would: nginx must let it
# through (it used to stop bodies at 10 MB) and the API must take it. Needs a fresh stack (the first account is
# created here), curl and python3.
#   deploy/check-upload.sh http://localhost:3000
set -euo pipefail
base="${1:-http://localhost:3000}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# 2000 × 2000 pixels of noise: a PNG of about 12 MB that no compression can shrink
python3 - "$tmp/big.png" <<'PY'
import os, struct, sys, zlib
w = h = 2000
rows = b''.join(b'\x00' + os.urandom(w * 3) for _ in range(h))
chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 1)) + chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(png)
PY
size=$(wc -c < "$tmp/big.png"); echo "picture: $size bytes"
[ "$size" -gt 12000000 ] || { echo "the picture is too small to prove anything"; exit 1; }

signup=$(curl -s -o "$tmp/signup" -w '%{http_code}' -c "$tmp/jar" -H 'x-requested-with: animation-flow' -H 'content-type: application/json' \
  -d '{"email":"upload-check@example.org","name":"Upload check","password":"upload-check-password-1"}' "$base/api/auth/signup")
[ "$signup" = 201 ] || { echo "sign-up: HTTP $signup $(head -c 200 "$tmp/signup") (this check needs a fresh stack: its first account)"; exit 1; }
code=$(curl -s -o "$tmp/out" -w '%{http_code}' -b "$tmp/jar" -H 'x-requested-with: animation-flow' -H 'content-type: image/png' \
  --data-binary @"$tmp/big.png" "$base/api/uploads/image")
echo "upload: HTTP $code $(head -c 200 "$tmp/out")"
[ "$code" = 201 ]

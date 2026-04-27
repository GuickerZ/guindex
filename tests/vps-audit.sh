#!/bin/bash
BASE='http://localhost:8090'

echo '=== VPS INTERNAL AUDIT ==='
echo "Date: $(date)"
echo ''

INDEXERS="torrent-dos-filmes starck-filmes vaca_torrent rede_torrent"
QUERIES="daredevil
better call saul
cidade de deus
wednesday
wandinha
round 6
pulp fiction
john wick 4
interstellar
nope
1917
fallout
sintonia
demolidor
o poderoso chefao
velozes e furiosos
homem aranha
spider man
coco
viva a vida e uma festa"

for idx in $INDEXERS; do
  echo "--- $idx ---"
  while IFS= read -r q; do
    START=$(date +%s%3N)
    RESP=$(curl -s --max-time 10 "$BASE/indexers/$idx?q=$(echo $q | sed 's/ /+/g')")
    END=$(date +%s%3N)
    MS=$((END - START))
    COUNT=$(echo "$RESP" | python3 -c 'import sys,json
d=json.load(sys.stdin)
print(d.get("count",len(d.get("results",[]))))' 2>/dev/null)
    if [ -z "$COUNT" ]; then COUNT="err"; fi
    printf '  %-30s → %4s results (%dms)\n' "\"$q\"" "$COUNT" "$MS"
  done <<< "$QUERIES"
  echo ''
done

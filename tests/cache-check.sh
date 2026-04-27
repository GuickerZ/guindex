#!/bin/bash
apt-get install -y jq > /dev/null 2>&1
for q in daredevil "better+call+saul" "the+boys" interstellar "gen+v" "john+wick" wednesday fallout sintonia demolidor; do
  count=$(curl -s --max-time 3 "http://localhost:8090/search?q=$q&limit=200" | jq '.count // (.results | length)' 2>/dev/null)
  echo "$q: $count results in Meilisearch cache"
done

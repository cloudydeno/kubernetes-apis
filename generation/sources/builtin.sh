#!/bin/sh -eux

upstream="https://github.com/kubernetes/kubernetes"
if [ ! -f generation/api-specs/builtin-"$1".json ]
then wget \
  "$upstream/raw/$1/api/openapi-spec/swagger.json" \
  -O "generation/api-specs/builtin-$1.json"
fi

rm -r lib/builtin/* \
|| true

deno run \
  --allow-read="generation/api-specs" \
  --allow-write="lib/builtin" \
  generation/cmd/emit-from-openapi.ts \
  "generation/api-specs/builtin-$1.json" \
  "lib/builtin" \
  "../../"

deno check lib/builtin/*/structs.ts

git status lib/builtin

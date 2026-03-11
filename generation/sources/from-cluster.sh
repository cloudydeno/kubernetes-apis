#!/bin/sh -eux

kubectl get --raw /openapi/v2 \
| jq . \
> generation/api-specs/from-cluster.json

deno run \
  --allow-read="generation/api-specs" \
  --allow-write="lib/from-cluster" \
  generation/cmd/emit-from-openapi.ts \
  "generation/api-specs/from-cluster.json" \
  "lib/from-cluster" \
  "../../"

# deno check lib/from-cluster/*/structs.ts

git status lib/from-cluster

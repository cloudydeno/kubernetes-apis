#!/bin/sh -eux

rawapi="raw.githubusercontent.com"
upstream="fluxcd/flux2"
kustomizationpath="manifests/crds/kustomization.yaml"
projectname="flux-cd"
specdir="generation/api-specs/$projectname-$1"

if [ ! -d "$specdir" ]
then {
  echo 'mkdir '"$specdir"
  echo 'cd '"$specdir"
  wget -O - "https://$rawapi/$upstream/refs/tags/$1/$kustomizationpath" \
  | grep -E 'https:.+[.]yaml' \
  | sed 's/^- /wget /'
} | sh -eux
fi

mkdir -p "lib/$projectname"
rm -r "lib/$projectname"/* \
|| true

deno run \
  --allow-read="generation/api-specs" \
  --allow-write="lib/$projectname" \
  generation/run-on-crds.ts \
  "$specdir" \
  "$projectname"

deno check "lib/$projectname"/*/mod.ts
git status "lib/$projectname"

#!/bin/sh -eux

gitapi="https://api.github.com"
upstream="argoproj/argo-cd"
crdpath="manifests/crds"
projectname="argo-cd"
specdir="generation/api-specs/$projectname-$1"

if [ ! -d "$specdir" ]
then {
  echo 'mkdir '"$specdir"
  echo 'cd '"$specdir"
  wget -O - "$gitapi/repos/$upstream/contents/$crdpath?ref=$1" \
  | jq -r '.[] | select(.name | endswith("-crd.yaml")) | "wget \(.download_url)"'
} | sh -eux
fi

mkdir -p "lib/$projectname"
rm -r "lib/$projectname"/* \
|| true

deno run \
  --allow-read="generation/api-specs" \
  --allow-write="lib/$projectname" \
  generation/cmd/emit-crds-from-yaml.ts \
  "$specdir" \
  "lib/$projectname" \
  "../../"

deno check "lib/$projectname"/*/mod.ts
git status "lib/$projectname"

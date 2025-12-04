#!/bin/sh -eux

gitapi="https://api.github.com"
upstream="jetstack/cert-manager"
crdpath="deploy/crds"
projectname="cert-manager"
specdir="generation/api-specs/$projectname-$1"

if [ ! -d "$specdir" ]
then {
  echo 'mkdir '"$specdir"
  echo 'cd '"$specdir"
  wget -O - "$gitapi/repos/$upstream/contents/$crdpath?ref=$1" \
  | jq -r '.[] | select(.name | endswith(".yaml")) | "wget \(.download_url)"'
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

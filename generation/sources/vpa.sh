#!/bin/sh -eux

gitapi="https://api.github.com"
upstream="kubernetes/autoscaler"
crdpath="vertical-pod-autoscaler/deploy/vpa-v1-crd-gen.yaml"
projectname="vpa"
specdir="generation/api-specs/$projectname-$1"

mkdir -p "$specdir"
if [ ! -f generation/api-specs/$projectname-"$1"/crd.yaml ]
then wget \
  "https://github.com/$upstream/raw/vertical-pod-autoscaler-$1/$crdpath" \
  -O "$specdir/crd.yaml"
fi

mkdir -p "lib/$projectname"
rm -r "lib/$projectname"/* \
|| true

deno run \
  --allow-read="generation/api-specs" \
  --allow-write="lib/$projectname" \
  generation/bin/emit-crds-from-yaml.ts \
  "$specdir" \
  "lib/$projectname"

# Let's not hang on to previous versions
rm -r "lib/$projectname"/*@v1beta2

deno check "lib/$projectname"/*/mod.ts
git status "lib/$projectname"

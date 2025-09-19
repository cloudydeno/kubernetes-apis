#!/bin/sh -eux

# https://github.com/kubernetes/kubernetes/releases
./generation/sources/builtin.sh v1.34.1

# https://github.com/argoproj/argo-cd/releases
./generation/sources/argo-cd.sh v3.1.6

# https://github.com/cert-manager/cert-manager/releases
./generation/sources/cert-manager.sh v1.18.2

# https://github.com/kubernetes-sigs/external-dns/releases
./generation/sources/external-dns.sh v0.19.0

# https://github.com/kubernetes/autoscaler/releases?q=vertical
./generation/sources/vpa.sh 1.4.1

# `@cloudydeno/kubernetes-codegen`

NOTE: This module implements the code generation concepts which are used to maintain [the `@cloudydeno/kubernetes-apis` module](https://jsr.io/@cloudydeno/kubernetes-apis).
If you are not looking to interact with Kubernetes CRDs, you probably don't need to look more into this module.

## Entrypoints

* `./cmd/emit-crds-from-cluster` writes an API client for the CRDs from your live cluster which belong to a particular group.
* `./cmd/emit-crds-from-yaml` writes API clients for all CRDs that are found in YAML files in the named directory
* `./cmd/emit-from-cluster` downloads an OpenAPI definition from your live cluster and writes all API clients available for the cluster, including both builtin APIs and CRD APIs
* `./cmd/emit-from-openapi` reads an OpenAPI JSON file (e.g. from the Kubernetes git repo) and writes all API clients available for the API definitions

## Kubernetes compatability

Clients for builtin Kubernetes APIs are generated from Kubernetes OpenAPI specs, which are large JSON files.

You can pull your cluster's OpenAPI spec easily:

`kubectl get --raw /openapi/v2 > openapi.json`

API specs from Kubernetes v1.14.0 and later should work fine.
Earlier releases would need some codegen changes to be compatible.

## CRD compatability

Clients for CRDs are generated from `apiextensions.k8s.io/v1` resources,
loaded either from yaml files or a connected Kubernetes cluster.

This method skips fetching the cluster OpenAPI spec which simplifies generating clients just for specific CRDs.

Rough example:
```sh
deno run --allow-env --allow-read --allow-net --allow-write=. \
  jsr:@cloudydeno/kubernetes-codegen/cmd/emit-crds-from-cluster \
  helm.toolkit.fluxcd.io lib/
```

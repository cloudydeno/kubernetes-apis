# `@cloudydeno/kubernetes-codegen`

NOTE: This module implements the code generation concepts which are used to maintain [the `@cloudydeno/kubernetes-apis` module](https://jsr.io/@cloudydeno/kubernetes-apis).
If you are not looking to interact with Kubernetes CRDs, you probably don't need to look more into this module.

## Entrypoints

* `./cmd/emit-crds-from-cluster` writes an API client for the CRDs from your live cluster which belong to a particular group.
  * `deno run  --allow-env --allow-read --allow-net --allow-write=. @cloudydeno/kubernetes-codegen/cmd/emit-crds-from-cluster helm.toolkit.fluxcd.io`

## Kubernetes compatability

APIs are generated from Kubernetes OpenAPI specs, which are large JSON files.

You can pull your cluster's OpenAPI spec easily:

`kubectl get --raw /openapi/v2 > openapi.json`

API specs from Kubernetes v1.14.0 and later should work fine.
Earlier releases would need some codegen changes to be compatible.

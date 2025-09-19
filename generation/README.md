[![CI](https://github.com/cloudydeno/kubernetes-apis/actions/workflows/deno-ci.yaml/badge.svg)](https://github.com/cloudydeno/kubernetes-apis/actions/workflows/deno-ci.yaml)

# `@cloudydeno/kubernetes-apis`

NOTE: This README is about code generation concepts.

Users of this library should click into [`lib/`](./lib) for the actual README!

## Kubernetes compatability

APIs are generated from Kubernetes OpenAPI specs, which are large JSON files.

You can pull your cluster's OpenAPI spec easily:

`kubectl get --raw /openapi/v2 > openapi.json`

API specs from Kubernetes v1.14.0 and later should work fine.
Earlier releases would need some codegen changes to be compatible.

## Module Layout

NOTE: This section refers to a hypothetical dynamic-codegen endpoint.
The current way of using this library is importing modules from
[/x/kubernetes_apis](https://deno.land/x/kubernetes_apis).
The latest Kubernetes release is used to generate the published modules,
so you may start noticing a lack of parity if you are using a quite old cluster.

---

Versioning is tricky with Kubernetes APIs because every cluster can have a different surface.

When referring to Kubernetes API surfaces, an exhuastive module path might look like this:

* `https://k8s-apis.deno.dev/v1/kubernetes@v1.17.8/core@v1/mod.ts`
* `https://k8s-apis.deno.dev/v1/kubernetes@v1.18.3/apps@v1beta1/mod.ts`
* `https://k8s-apis.deno.dev/v1/kubernetes@v1.19.1/networking.k8s.io@v1/mod.ts`

There's also third-party projects that register CRDs, such as cert-manager.
OpenAPI specs are almost never published by these projects,
so generating APIs for them generally means feeding CRD YAML files into the codegen and guessing.
This is an imperfect art but so far works well for `cert-manager` and `exernal-dns`.
Alternatively, the CRDs could be installed onto a real control plane and then the APIs extracted.

Several examples of addressing third party APIs might be:

* `https://k8s-apis.deno.dev/v1/cert-manager@v1.0.4/acme.cert-manager.io@v1alpha2/mod.ts`
* `https://k8s-apis.deno.dev/v1/external-dns@v0.7.4/externaldns.k8s.io@v1alpha1/mod.ts`
* `https://k8s-apis.deno.dev/v1/velero@v1.5.2/velero.io@v1/mod.ts`
* `https://k8s-apis.deno.dev/v1/argo-cd@v2.1.7/argoproj.io@v1alpha1/mod.ts`

The only sort of 'directory' of CRDs is likely [Operator Hub](https://operatorhub.io/)
though it is also lacking CRDs that are not explicitly tied to an "Operator".
Otherwise, there's not really any, like, directory of just CRDs,
so we'll possibly need to make a further list ourselves..

Finally, for generating code within a cluster, it's pretty likely that a cluster's apis
will be generated as one unit and possibly stored in S3 or similar, and the paths are more straightforward:

* `//k8s_api_surface/batch@v1/mod.ts`

In any case, the actual API client that works with authentication/transport
will be served authoratatively from a normal deno repo:

* https://deno.land/x/kubernetes_client@v0.7.0/mod.ts

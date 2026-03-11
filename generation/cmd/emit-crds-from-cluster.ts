#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net --allow-write=.
import { autoDetectClient } from '@cloudydeno/kubernetes-client';
import { ApiextensionsV1Api } from "@cloudydeno/kubernetes-apis/apiextensions.k8s.io/v1";

import { describeCrdsSurface } from "../surface-from-crds.ts";
import { emitSurfaceApis } from "../emit.ts";

const kubernetes = await autoDetectClient();
const apiextensionsApi = new ApiextensionsV1Api(kubernetes);
const availableCRDs = await apiextensionsApi.getCustomResourceDefinitionList();

const [desiredGroup, desiredVersion] = Deno.args[0]?.split('@') ?? [];
const v1CRDs = availableCRDs.items.filter(crd => crd.spec.group == desiredGroup);

if (!v1CRDs.length) {
  console.error('No CRDs found for group', JSON.stringify(desiredGroup));
  console.error('Available CRD groups in current cluster:');
  const groupList = [...new Set(
    availableCRDs.items.flatMap(
      x => x.spec.versions.map(
        y => `${x.spec.group}@${y.name}`))
  )].toSorted();
  for (const group of groupList) {
    console.error(`* ${group}`);
  }
  Deno.exit(5);
}

const surface = describeCrdsSurface(v1CRDs, {
  filterVersions(_crd, version) {
    if (!desiredVersion) return true;
    return version.name == desiredVersion;
  },
});

await emitSurfaceApis(surface,
  Deno.args[1] ?? 'lib',
  Deno.args[2] ?? '@cloudydeno/kubernetes-apis/');

#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net --allow-write=.
import { autoDetectClient } from '@cloudydeno/kubernetes-client';
const kubernetes = await autoDetectClient();

import { ApiextensionsV1Api } from "@cloudydeno/kubernetes-apis/apiextensions.k8s.io/v1";
const apiextensionsApi = new ApiextensionsV1Api(kubernetes);

import { runOnCrds } from "../run-on-crds.ts";

const availableCRDs = await apiextensionsApi.getCustomResourceDefinitionList();

const desiredGroup = Deno.args[0];
const v1CRDs = availableCRDs.items.filter(crd => crd.spec.group == desiredGroup);

if (!v1CRDs.length) {
  console.error('No CRDs found for group', JSON.stringify(desiredGroup));
  console.error('Available groups:');
  const groupList = [...new Set(availableCRDs.items.map(x => x.spec.group))].toSorted();
  for (const group of groupList) {
    console.error(`* ${group}`);
  }
  Deno.exit(5);
}

await runOnCrds(v1CRDs, Deno.args[1] ?? 'lib', Deno.args[2]);

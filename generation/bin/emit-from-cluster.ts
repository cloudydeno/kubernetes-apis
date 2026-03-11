#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net --allow-write=.
import { autoDetectClient } from '@cloudydeno/kubernetes-client';
const kubernetes = await autoDetectClient();

import type { OpenAPI2 } from '../openapi.ts';
import { writeApiModule } from "../codegen.ts";
import { describeSurface } from "../describe-surface.ts";

const wholeSpec = await kubernetes.performRequest({
  method: 'GET',
  path: '/openapi/v2',
  expectJson: true,
}) as OpenAPI2;

for (const value of Object.values(wholeSpec.paths)) {
  if (value?.parameters) {
    value.parameters = value.parameters.map(x => x.$ref ? wholeSpec.parameters[x.$ref.split('/')[2]] : x);
  }
  for (const path of [value.get, value.post, value.put, value.patch, value.delete]) {
    if (path?.parameters) {
      path.parameters = path.parameters.map(x => x.$ref ? wholeSpec.parameters[x.$ref.split('/')[2]] : x);
    }
  }
}

const surface = describeSurface(wholeSpec);

for (const api of surface.allApis) {
  try {
    await writeApiModule(surface, api, Deno.args[1] ?? 'lib/from-cluster');
  } catch (err) {
    console.error(`Error writing`, api.apiGroupVersion);
    console.error(err);
  }
}

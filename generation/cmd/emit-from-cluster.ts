#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net --allow-write=.
import { autoDetectClient } from '@cloudydeno/kubernetes-client';

import type { OpenAPI2 } from '../util/openapi.ts';
import { describeOpenapiSurface } from "../surface-from-openapi.ts";
import { emitSurfaceApis } from "../emit.ts";

const kubernetes = await autoDetectClient();
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

const surface = describeOpenapiSurface(wholeSpec);

await emitSurfaceApis(surface,
  Deno.args[1] ?? 'lib',
  Deno.args[2] ?? '@cloudydeno/kubernetes-apis/');

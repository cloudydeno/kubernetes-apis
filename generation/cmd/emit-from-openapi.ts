import type { OpenAPI2 } from '../util/openapi.ts';
import { emitSurfaceApis } from "../emit.ts";
import { describeOpenapiSurface } from "../surface-from-openapi.ts";

const data = await Deno.readTextFile(Deno.args[0] ?? 'openapi.json');
const wholeSpec: OpenAPI2 = JSON.parse(data);

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

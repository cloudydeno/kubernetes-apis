import type { OpenAPI2 } from './openapi.ts';
import { writeApiModule } from "./codegen.ts";
import { describeSurface } from "./describe-surface.ts";

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

const surface = describeSurface(wholeSpec);

for (const api of surface.allApis) {
  try {
    await writeApiModule(surface, api, Deno.args[1] ?? 'lib/builtin');
  } catch (err) {
    console.error(`Error writing`, api.apiGroupVersion);
    console.error(err);
  }
}

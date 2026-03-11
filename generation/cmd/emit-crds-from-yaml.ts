import { parseAll as parseAllYAML } from "@std/yaml/parse";
import type { ApiKind, JSONValue } from "@cloudydeno/kubernetes-client/lib/contract.ts";
import {
  type CustomResourceDefinition as CRDv1,
  toCustomResourceDefinition as toCRDv1,
} from "@cloudydeno/kubernetes-apis/apiextensions.k8s.io/v1";

import { runOnCrds } from "../run-on-crds.ts";

const v1CRDs = new Array<CRDv1>();

for await (const dirEntry of Deno.readDir(Deno.args[0])) {
  if (!dirEntry.isFile) continue;
  if (!dirEntry.name.endsWith('.yaml')) continue;
  if (dirEntry.name.endsWith('.example.yaml')) continue;

  const raw = await Deno.readFile(Deno.args[0]+'/'+dirEntry.name);
  const docs = parseAllYAML(new TextDecoder('utf-8').decode(raw)) as Array<unknown>;
  for (const doc of docs) {

    const typing = doc as ApiKind;
    if (typing.kind !== "CustomResourceDefinition") throw new Error(
      `I didn't see a CRD in ${dirEntry.name}`);
    switch (typing.apiVersion) {
      case 'apiextensions.k8s.io/v1':
        v1CRDs.push(toCRDv1(doc as JSONValue));
        break;
      default: throw new Error(
        `The CRD in ${dirEntry.name} uses an unsupported apiVersion ${JSON.stringify(typing.apiVersion)}`);
    }
  }
}

await runOnCrds(v1CRDs, Deno.args[1] ?? 'lib', Deno.args[2]);

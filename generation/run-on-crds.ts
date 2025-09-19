import { parseAll as parseAllYAML } from "@std/yaml/parse";
import type { ApiKind, JSONValue } from "@cloudydeno/kubernetes-client/lib/contract.ts";

import type { OpenAPI2SchemaObject, OpenAPI2Methods, OpenAPI2PathMethod } from './openapi.ts';
import { writeApiModule } from "./codegen.ts";
import { SurfaceMap, SurfaceApi, OpScope } from "./describe-surface.ts";
import { ShapeLibrary } from "./describe-shapes.ts";
import { knownOptsForward } from "./known-opts.ts";

import {
  CustomResourceDefinition as CRDv1,
  toCustomResourceDefinition as toCRDv1,
  CustomResourceSubresources,
  CustomResourceDefinitionNames,
} from "../lib/builtin/apiextensions.k8s.io@v1/structs.ts";

const v1CRDs = new Array<CRDv1>();

const knownOpts = knownOptsForward;

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

// Sort CRDs by name, to ensure we use a stable order
v1CRDs.sort((a,b) => a.metadata!.name!.localeCompare(b.metadata!.name!));

const apiMap = new SurfaceMap({
  paths: {},
  definitions: {},
  swagger: 'faked'
});
apiMap.allApis[0].moduleName = `../builtin/meta@v1`;

apiMap.registerApi({
  apiRoot: '/api/v1/',
  shapePrefix: 'io.k8s.api.core.v1.',

  apiGroup: 'core',
  apiVersion: 'v1',
  apiGroupVersion: 'v1',
  friendlyName: 'CoreV1',
  moduleName: `../builtin/core@v1`,

  operations: new Array,
  definitions: new Map,
  kinds: new Map(),
  shapes: new ShapeLibrary('io.k8s.api.core.v1.', apiMap.byDefPrefix),
});

// used for /scale subresources
apiMap.registerApi({
  apiRoot: '/apis/autoscaling/v1',
  shapePrefix: 'io.k8s.api.autoscaling.v1.',

  apiGroup: 'autoscaling',
  apiVersion: 'v1',
  apiGroupVersion: 'autoscaling/v1',
  friendlyName: 'AutoscalingV1',
  moduleName: `../builtin/autoscaling@v1`,

  operations: new Array,
  definitions: new Map,
  kinds: new Map(),
  shapes: new ShapeLibrary('io.k8s.api.autoscaling.v1.', apiMap.byDefPrefix),
});

type DefMap = Map<string, OpenAPI2SchemaObject>;
const apis = new Map<string, [SurfaceApi, DefMap]>();
function recognizeGroupVersion(apiGroup: string, apiVersion: string) {
  const key = JSON.stringify([apiGroup, apiVersion]);
  const existing = apis.get(key);
  if (existing) return existing;

  const groupName = apiGroup
    .replace(/\.k8s\.io$/, '')
    .replace(/(^|[.-])[a-z]/g, x => x.slice(-1).toUpperCase());
  const versionName = apiVersion
    .replace(/(^|[.-])[a-z]/g, x => x.slice(-1).toUpperCase());
  // const shapePrefix = `#/definitions/io.k8s.api.certificates.v1beta1.`;
  const shapePrefix = `${apiGroup}.${apiVersion}.`;

  const api = apiMap.registerApi({
    apiRoot: `/apis/${apiGroup}/${apiVersion}/`,
    apiGroup: apiGroup,
    apiVersion: apiVersion,
    apiGroupVersion: [apiGroup, apiVersion].join('/'),
    friendlyName: groupName + versionName,
    moduleName: `${apiGroup}@${apiVersion}`,
    shapePrefix: shapePrefix,
    operations: new Array,
    definitions: new Map,
    kinds: new Map,
    shapes: new ShapeLibrary(shapePrefix, apiMap.byDefPrefix),
  });

  const map: DefMap = new Map();
  apis.set(key, [api, map]);
  return [api, map] as const;
}

if (v1CRDs.length > 0) {

  for (const crd of v1CRDs) {
    for (const version of crd.spec.versions ?? []) {

      const schema = version.schema?.openAPIV3Schema;
      if (!schema) throw new Error(
        `TODO: No schema given for ${crd.spec.names.kind}`);

      processCRD({
        apiGroup: crd.spec.group,
        apiVersion: version.name,
        schema: schema as OpenAPI2SchemaObject,
        names: crd.spec.names,
        scope: crd.spec.scope,
        subResources: {...version.subresources},
      });
    }
  }

} else {
  throw new Error(`No CRDs found! Whoops?`);
}

for (const [api, defs] of apis.values()) {
  api.shapes.loadShapes(defs);
}

for (const api of apiMap.allApis) {
  if (api.moduleName.startsWith('../')) continue;
  try {
    await writeApiModule(apiMap, api, Deno.args[1], Deno.args[2]);
  } catch (err) {
    console.error(`Error writing`, api.apiGroupVersion);
    console.error(err);
  }
}

function processCRD({apiGroup, apiVersion, schema, names, scope, subResources}: {
  apiGroup: string,
  apiVersion: string,
  schema: OpenAPI2SchemaObject,
  names: CustomResourceDefinitionNames,
  scope: string,
  subResources: CustomResourceSubresources,
}) {

  const [api, defs] = recognizeGroupVersion(apiGroup, apiVersion);

  // operations: Array<SurfaceOperation>,
  // definitions: Map<string,OpenAPI2SchemaObject>,
  // kinds: Map<string,SurfaceKind>,
  // shapes: ShapeLibrary,

  fixupSchema(schema, api.shapePrefix, defs, [names.kind]);

  // seems like additionalProperties gives type problems
  // api.definitions.set(names.kind, schema as OpenAPI2SchemaObject);
  schema["x-kubernetes-group-version-kind"] = [{
    group: api.apiGroup,
    version: api.apiVersion,
    kind: names.kind,
  }];
  schema.properties!["metadata"] = {
    "$ref": "#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta"
  };
  defs.set(names.kind, schema);

  defs.set(names.kind+'List', {
    "type": "object",
    "required": [ "items" ],
    "properties": {
      "apiVersion": { "type": "string" },
      "items": {
        "items": {
          "$ref": `#/definitions/${api.shapePrefix}${names.kind}`
        },
        "type": "array"
      },
      "kind": { "type": "string" },
      "metadata": {
        "$ref": "#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ListMeta"
      }
    },
    ["x-kubernetes-group-version-kind"]: [{
      group: api.apiGroup,
      version: api.apiVersion,
      kind: names.kind+'List',
    }]
  });

  api.kinds.set(names.kind, {
    name: names.kind,
    plural: names.plural,
    singular: names.singular ?? names.kind,
    listName: names.listKind ?? `${names.kind}List`,
    isNamespaced: scope === 'Namespaced',
  });

  const opBoilerPlate = {
    consumes: ['application/json'],
    produces: ['application/json'],
    schemes: ['https'],
    operationId: 'faked',
  }
  function addOp(operationName: string, scope: OpScope, method: OpenAPI2Methods, action: OpenAPI2PathMethod['x-kubernetes-action'], opts: {
    subPath?: string;
    reqKind?: string;
    respKind?: string;
    knownOpts?: string;
    // params?: OpenAPI2RequestParameter[];
  }) {
    api.operations.push({
      ...opBoilerPlate,
      "x-kubernetes-action": action,
      method: method,
      operationName: operationName,
      scope: scope,
      subPath: (names.plural ?? '') + (opts.subPath ?? ''),
      parameters: [
        ...(opts.subPath?.startsWith('/{name}') ? [
          { name: 'name', in: 'path', schema: { type: 'string' } } as const
        ] : []),
        ...(opts.reqKind ? [
          { name: 'body', in: 'body', schema: { $ref: `#/definitions/${opts.reqKind}` }} as const
        ] : []),
        // ...(opts.params ?? []),
        ...(opts.knownOpts ? opts.knownOpts
          .split(',').map(x => ({name: x, in: 'query', type: 'string'} as const))
        : []),
      ],
      responses: opts.respKind ? { '200': {
        schema: { $ref: `#/definitions/${opts.respKind}` },
      }} : {},
    });
  }

  function addCrdOps(scope: OpScope) {
    addOp(`get${names.kind}List`, scope, 'get', 'list', {
      respKind: `${api.shapePrefix}${names.kind}List`,
      knownOpts: knownOpts.GetListOpts,
    });
    addOp(`watch${names.kind}List`, scope, 'get', 'watchlist', {
      respKind: `${api.shapePrefix}${names.kind}List`,
      knownOpts: knownOpts.WatchListOpts,
    });
    addOp(`create${names.kind}`, scope, 'post', 'post', {
      reqKind: `${api.shapePrefix}${names.kind}`,
      respKind: `${api.shapePrefix}${names.kind}`,
      knownOpts: knownOpts.PutOpts,
    });
    addOp(`delete${names.kind}List`, scope, 'delete', 'deletecollection', {
      reqKind: `io.k8s.apimachinery.pkg.apis.meta.v1.DeleteOptions`,
      respKind: `${api.shapePrefix}${names.kind}List`,
      knownOpts: knownOpts.DeleteListOpts,
    });

    addOp(`get${names.kind}`, scope, 'get', 'get', {
      respKind: `${api.shapePrefix}${names.kind}`,
      knownOpts: knownOpts.GetOpts,
      subPath: '/{name}',
    });
    addOp(`delete${names.kind}`, scope, 'delete', 'delete', {
      reqKind: `io.k8s.apimachinery.pkg.apis.meta.v1.DeleteOptions`,
      respKind: `${api.shapePrefix}${names.kind}`, // or io.k8s.apimachinery.pkg.apis.meta.v1.Status
      knownOpts: knownOpts.DeleteOpts,
      subPath: '/{name}',
    });
    addOp(`replace${names.kind}`, scope, 'put', 'put', {
      reqKind: `${api.shapePrefix}${names.kind}`,
      respKind: `${api.shapePrefix}${names.kind}`,
      knownOpts: knownOpts.PutOpts,
      subPath: '/{name}',
    });
    addOp(`patch${names.kind}`, scope, 'patch', 'patch', {
      reqKind: `${api.shapePrefix}${names.kind}`,
      respKind: `${api.shapePrefix}${names.kind}`,
      knownOpts: knownOpts.PatchOpts,
      subPath: '/{name}',
    });

    if (subResources.status) {

      addOp(`get${names.kind}Status`, scope, 'get', 'get', {
        respKind: `${api.shapePrefix}${names.kind}`,
        knownOpts: knownOpts.GetOpts,
        subPath: '/{name}/status',
      });
      addOp(`replace${names.kind}Status`, scope, 'put', 'put', {
        reqKind: `${api.shapePrefix}${names.kind}`,
        respKind: `${api.shapePrefix}${names.kind}`,
        knownOpts: knownOpts.PutOpts,
        subPath: '/{name}/status',
      });
      addOp(`patch${names.kind}Status`, scope, 'patch', 'patch', {
        reqKind: `${api.shapePrefix}${names.kind}`,
        respKind: `${api.shapePrefix}${names.kind}`,
        knownOpts: knownOpts.PatchOpts,
        subPath: '/{name}/status',
      });

    }
    if (subResources.scale) {

      addOp(`get${names.kind}Scale`, scope, 'get', 'get', {
        respKind: `io.k8s.api.autoscaling.v1.Scale`,
        knownOpts: knownOpts.GetOpts,
        subPath: '/{name}/scale',
      });
      addOp(`replace${names.kind}Scale`, scope, 'put', 'put', {
        reqKind: `io.k8s.api.autoscaling.v1.Scale`,
        respKind: `io.k8s.api.autoscaling.v1.Scale`,
        knownOpts: knownOpts.PutOpts,
        subPath: '/{name}/scale',
      });
      addOp(`patch${names.kind}Scale`, scope, 'patch', 'patch', {
        reqKind: `io.k8s.api.autoscaling.v1.Scale`,
        respKind: `io.k8s.api.autoscaling.v1.Scale`,
        knownOpts: knownOpts.PatchOpts,
        subPath: '/{name}/scale',
      });

    }
  }

  if (scope === 'Namespaced') {

    addOp(`get${names.kind}ListForAllNamespaces`, 'AllNamespaces', 'get', 'list', {
      respKind: `${api.shapePrefix}${names.kind}List`,
      knownOpts: knownOpts.GetListOpts,
    });
    addOp(`watch${names.kind}ListForAllNamespaces`, 'AllNamespaces', 'get', 'watchlist', {
      respKind: `${api.shapePrefix}${names.kind}List`,
      knownOpts: knownOpts.WatchListOpts,
    });

    addCrdOps('Namespaced');

  } else {

    addCrdOps('Cluster');

  }

}


function fixupSchema(schema: OpenAPI2SchemaObject, shapePrefix: string, defMap: DefMap, path: string[] = []) {

  // cert-manager
  const mainPrefix = shapePrefix.replace(/^acme\./, '');

  if (schema.properties) {
    // if (path.slice(-1)[0] === 'dns01')
    //   console.log(schema.type, path);

    for (const [key, val] of Object.entries(schema.properties)) {
      const newPath = [...path, key];

      // ArgoCD
      if (shapePrefix.startsWith('argoproj.io.')) {

        if (newPath.slice(-1)[0] == 'template') {
          schema.properties[key] = {
            description: val.description,
            $ref: `#/definitions/${shapePrefix}ApplicationTemplate`,
          };
          if (!defMap.has('ApplicationTemplate')) {
            defMap.set('ApplicationTemplate', val);
          } else continue;
        }

        if (newPath.slice(-1)[0] == 'source') {
          schema.properties[key] = {
            description: val.description,
            $ref: `#/definitions/${shapePrefix}ApplicationSource`,
          };
          if (!defMap.has('ApplicationSource') && newPath[0] == 'Application') {
            defMap.set('ApplicationSource', val);
          } else continue;
        }

        if (['selector', 'labelSelector'].includes(newPath.slice(-1)[0])) {
          if (Object.keys(val.properties ?? {}).sort().join(',') == 'matchExpressions,matchLabels') {
            schema.properties[key] = {
              description: val.description,
              $ref: "#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.LabelSelector",
            };
            continue;
          }
        }
      }

      if (newPath.slice(-3).join('.') === 'podTemplate.spec.affinity') {
        schema.properties[key] = {
          $ref: "#/definitions/io.k8s.api.core.v1.Affinity",
        };
        continue;
      }

      if (newPath.slice(-1)[0] === 'secretRef' || newPath.slice(-1)[0].endsWith('SecretRef')) {
        schema.properties[key] = {
          $ref: `#/definitions/${mainPrefix}SecretRef`,
        };
        if (!defMap.has('SecretRef') && shapePrefix === mainPrefix) {
          defMap.set('SecretRef', { ...val,
            description: "A reference to a specific 'key' within a Secret resource. In some instances, `key` is a required field.",
          });
        } else continue;
      }

      if (newPath.join('.') === 'Issuer.spec' || newPath.join('.') === 'ClusterIssuer.spec') {
        schema.properties[key] = {
          $ref: `#/definitions/${mainPrefix}IssuerSpec`,
        };
        if (!defMap.has('IssuerSpec')) defMap.set('IssuerSpec', { ...val,
          description: "Desired state of the Issuer or ClusterIssuer resource.",
        });
      }

      if (newPath.join('.') === 'Issuer.status' || newPath.join('.') === 'ClusterIssuer.status') {
        schema.properties[key] = {
          $ref: `#/definitions/${mainPrefix}IssuerStatus`,
        };
        if (!defMap.has('IssuerStatus')) defMap.set('IssuerStatus', { ...val,
          description: "Status of the Issuer or ClusterIssuer. This is set and managed automatically.",
        });
      }

      if (newPath.join('.') === 'Challenge.spec.solver') {
        schema.properties[key] = {
          $ref: `#/definitions/${mainPrefix}SolverSpec`,
        };
        continue;
      }

      fixupSchema(val, shapePrefix, defMap, newPath);
    }

  } else if (schema.items) {
    const originalItems = schema.items;

    if (shapePrefix.startsWith('argoproj.io.')) {

      // Generators are actually recursive, apparently
      if (path.slice(-1)[0] == 'generators') {
        schema.items = {
          description: originalItems.description,
          $ref: `#/definitions/${shapePrefix}ApplicationSetGenerator`,
        };
        if (!defMap.has('ApplicationSetGenerator')) {
          defMap.set('ApplicationSetGenerator', originalItems);
        } else return;
      }

      if (path.slice(-1)[0] == 'sources') {
        schema.items = {
          description: originalItems.description,
          $ref: `#/definitions/${shapePrefix}ApplicationSource`,
        };
        return;
      }
    }

    fixupSchema(originalItems, shapePrefix, defMap, [...path, '*']);

    if (path.join('.').endsWith('Issuer.spec.acme.solvers')) {
      schema.items = {
        $ref: `#/definitions/${shapePrefix}SolverSpec`,
      };
      if (!defMap.has('SolverSpec') && shapePrefix === mainPrefix) {
        defMap.set('SolverSpec', originalItems);
      } else return;
    }
  }

}

import { SurfaceMap, type OpScope } from "./surface.ts";
import {
  MethodList,
  type OpenAPI2,
  type OpenAPI2RequestParameter,
  type OpenAPI2SchemaObject,
} from "./util/openapi.ts";

export function describeOpenapiSurface(wholeSpec: OpenAPI2) {
  const surface = new SurfaceMap(wholeSpec);

  for (const [path, pathObj] of Object.entries(wholeSpec.paths)) {
    if (path.endsWith('/')) continue;

    const api = surface.recognizePath(path);
    if (api) {

      const subPath = path.slice(api.apiRoot.length);
      if (subPath.startsWith('watch/')) continue; // deprecated anyway

      for (const method of MethodList) {
        if (!(method in pathObj)) continue;
        const methodObj = pathObj[method];

        if (methodObj.operationId.endsWith('WithPath')) continue; // TODO: special proxy routes

        const kind = methodObj['x-kubernetes-group-version-kind']?.kind ?? 'Bug';
        let [operationPrefix, operationSuffix] = methodObj.operationId.split(api.friendlyName);

        let scope: OpScope = 'Cluster';
        if (operationSuffix.includes('Namespaced')) {
          operationSuffix = operationSuffix.replace('Namespaced', '');
          scope = 'Namespaced';
        } else if (operationSuffix.includes('ForAllNamespaces')) {
          scope = 'AllNamespaces';
        }

        let opName = '';
        if (operationSuffix.includes(kind)) {
          const [opMidA, opMidB] = operationSuffix.split(kind);

          if (operationPrefix === 'list') {
            opName = ['get', kind, 'List', opMidB].join('');
          } else if (opMidA === 'Collection') {
            opName = [operationPrefix, kind, 'List', opMidB].join('');
          } else if (operationPrefix === 'read') {
            opName = ['get', opMidA, kind, opMidB].join('');
          } else {
            opName = [operationPrefix, opMidA, kind, opMidB].join('');
          }
        } else {
          opName = [operationPrefix, operationSuffix].join('');
        }

        const allParams = new Array<OpenAPI2RequestParameter>()
          .concat(methodObj.parameters ?? [], pathObj.parameters ?? []);

        // Special-case for PodExec/PodAttach which do not type 'command' as a list.
        const commandArg = allParams.find(x => x.name == 'command' && x.description?.includes('argv array'));
        if (commandArg) {
          commandArg.schema = {
            type: 'array',
            items: {
              type: 'string',
            },
          };
          commandArg.type = undefined;
        }
        const portArg = allParams.find(x => x.name == 'ports' && x.description?.includes('List of ports'));
        if (portArg) {
          portArg.schema = {
            type: 'array',
            items: {
              type: 'number',
            },
          };
          portArg.type = undefined;
        }

        if (opName == 'getPodLog') {
          // Add a streaming variant for pod logs
          api.operations.push({
            ...methodObj,
            parameters: allParams.filter(x => !['allowWatchBookmarks', 'watch', 'pretty'].includes(x.name)),
            subPath: subPath,
            method: method,
            operationName: 'streamPodLog', // triggers special codegen logic
            scope: scope,
          });
          // Remove "follow" from the non-stream variant
          allParams.splice(allParams.findIndex(x => x.name == 'follow'), 1);
        }

        api.operations.push({
          ...methodObj,
          parameters: allParams.filter(x => !['allowWatchBookmarks', 'watch', 'pretty'].includes(x.name)),
          subPath: subPath,
          method: method,
          operationName: opName,
          scope: scope,
        });

        if (allParams.some(x => x.name === 'watch')
            && opName.startsWith('get')
            && !['ComponentStatus', 'NodeMetrics', 'PodMetrics'].includes(kind)
        ) {
          api.operations.push({
            ...methodObj,
            parameters: allParams.filter(x => !['continue', 'limit', 'watch', 'pretty'].includes(x.name)),
            subPath: subPath,
            method: method,
            operationName: opName.replace(/^get/, 'watch'),
            scope: scope,
          });
        }

        const kindTuple = methodObj['x-kubernetes-group-version-kind'];
        if (kindTuple) {
          let kindObj = api.kinds.get(kindTuple.kind);
          if (!kindObj) {
            kindObj = {
              name: kindTuple.kind,
              plural: kindTuple.kind+'s',
              singular: kindTuple.kind,
              listName: kindTuple.kind+'List',
              isNamespaced: false,
            };
            api.kinds.set(kindTuple.kind, kindObj);
          }
          if (subPath.startsWith('namespaces/{namespace}/')) {
            kindObj.isNamespaced = true;
          }
        }
      }
    }
  }

  for (const api of surface.allApis) {
    const defs = new Map<string, OpenAPI2SchemaObject>();
    for (const [defId, schema] of Object.entries(wholeSpec.definitions)) {
      if (!defId.startsWith(api.shapePrefix)) continue;
      const defName = defId.slice(api.shapePrefix.length);
      defs.set(defName, schema);
    }
    api.shapes.loadShapes(defs);

    for (const op of api.operations) {
      for (const param of op.parameters) {
        api.shapes.readSchema(param.schema ?? {type: param.type}, null);
      }
      for (const resp of Object.values(op.responses)) {
        if (resp.schema?.$ref) {
          api.shapes.readSchema(resp.schema, null);
        }
      }
    }
  }

  return surface;
}

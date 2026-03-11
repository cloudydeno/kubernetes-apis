import type {
  OpenAPI2Methods,
  OpenAPI2, OpenAPI2SchemaObject,
  OpenAPI2PathMethod, OpenAPI2RequestParameter,
} from './util/openapi.ts';
import { ShapeLibrary } from "./surface-shapes.ts";

export class SurfaceMap {
  wholeSpec: OpenAPI2;
  constructor(wholeSpec: OpenAPI2) {
    this.wholeSpec = wholeSpec;

    this.registerApi({
      apiRoot: '/meta/v1/', // not real (no apis)
      shapePrefix: 'io.k8s.apimachinery.pkg.apis.meta.v1.', // real

      apiGroup: 'meta',
      apiVersion: 'v1',
      apiGroupVersion: 'v1',
      friendlyName: 'MetaV1',
      moduleName: `meta@v1`,

      operations: [],
      definitions: new Map,
      kinds: new Map([
        ['APIResource', { name: 'APIResource', singular: 'APIResource', plural: 'APIResources', listName: 'APIResourceList', isNamespaced: false }],
        ['APIGroup', { name: 'APIGroup', singular: 'APIGroup', plural: 'APIGroups', listName: 'APIGroupList', isNamespaced: false }],
        ['Status', { name: 'Status', singular: 'Status', plural: 'Statuss', listName: 'StatusList', isNamespaced: false }],
      ]),
      shapes: new ShapeLibrary('io.k8s.apimachinery.pkg.apis.meta.v1.', this.byDefPrefix),
    });
  }

  allApis = new Array<SurfaceApi>();
  byPathPrefix = new Map<string,SurfaceApi>();
  byDefPrefix = new Map<string,SurfaceApi>();

  recognizePath(path: string): (SurfaceApi & {
    operations: Array<SurfaceOperation>;
  }) | null {
    const [apiGroupPath, subPath] = path.split(/\/v[0-9]+[^\/]*\//);
    if (!subPath) return null;

    const apiVersion = path.slice(apiGroupPath.length+1, -subPath.length-1);
    const apiRoot = `${apiGroupPath}/${apiVersion}/`;

    const existing = this.byPathPrefix.get(apiRoot);
    if (existing) return existing;

    const apiGroup = apiGroupPath === '/api' ? 'core' : apiGroupPath.slice(6);
    const apiGroupMaybe = apiGroupPath === '/api' ? '' : apiGroupPath.slice(6);

    const groupName = apiGroup
      .replace(/\.k8s\.io$/, '')
      .replace(/(^|[.-])[a-z]/g, x => x.slice(-1).toUpperCase());
    const versionName = apiVersion
      .replace(/(^|[.-])[a-z]/g, x => x.slice(-1).toUpperCase());

    const shapePrefix = Object
      .entries(this.wholeSpec.definitions)
      .filter(([_, x]) => x["x-kubernetes-group-version-kind"]?.every(y => y.group === apiGroupMaybe && y.version === apiVersion))
      .map(([x]) => x.slice(0, x.lastIndexOf('.')+1))[0] ?? 'BUG';

    const api: SurfaceApi = {
      apiRoot: apiRoot,
      apiGroup: apiGroup,
      apiVersion: apiVersion,
      apiGroupVersion: [...(apiGroupMaybe ? [apiGroup] : []), apiVersion].join('/'),
      friendlyName: groupName + versionName,
      moduleName: `${apiGroup}@${apiVersion}`,
      shapePrefix: shapePrefix,
      operations: [],
      definitions: new Map,
      kinds: new Map,
      shapes: new ShapeLibrary(shapePrefix, this.byDefPrefix),
    };
    this.registerApi(api);

    return api;
  }

  registerApi(api: SurfaceApi) {
    this.byPathPrefix.set(api.apiRoot, api);
    this.byDefPrefix.set(api.shapePrefix, api);
    this.allApis.push(api);
    return api;
  }
}

export interface SurfaceApi {
  apiRoot: string;
  apiGroup: string;
  apiVersion: string;
  apiGroupVersion: string;
  moduleName: string;
  friendlyName: string;
  shapePrefix: string;

  operations: Array<SurfaceOperation>,
  definitions: Map<string,OpenAPI2SchemaObject>,
  kinds: Map<string,SurfaceKind>,
  shapes: ShapeLibrary,
}

export type SurfaceOperation = OpenAPI2PathMethod & {
  parameters: OpenAPI2RequestParameter[],
  subPath: string;
  method: OpenAPI2Methods;
  scope: OpScope;
  operationName: string;
}
export type OpScope = 'Cluster' | 'AllNamespaces' | 'Namespaced';

export interface SurfaceKind {
  name: string;
  listName: string | null;
  plural: string | null;
  singular: string | null;
  isNamespaced: boolean;
  // subresources: Record<string,unknown>;
  // operations: Array<ApiOperation>;
}

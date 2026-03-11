import type { OpenAPI2SchemaObject, GroupVersionKind } from "./util/openapi.ts";
import type { SurfaceApi } from "./surface.ts";

export class ShapeLibrary {
  localApi: string;
  otherPrefixes: Map<string, SurfaceApi>;
  constructor(localPrefix: string, otherPrefixes: Map<string, SurfaceApi>) {
    this.localApi = localPrefix;
    Object.defineProperty(this, 'otherPrefixes', {
      enumerable: false,
      value: null,
      writable: true,
    });
    this.otherPrefixes = otherPrefixes;
  }

  availableNames = new Map<string, OpenAPI2SchemaObject>();
  shapes = new Map<string,ApiShape>();
  referencedLibraries = new Set<SurfaceApi>();

  loadShapes(definitions: Map<string, OpenAPI2SchemaObject>) {
    this.availableNames = definitions;
    for (const [path, schema] of definitions.entries()) {
      if (schema.type === 'object') {
        this.readSchema({$ref: `#/definitions/${this.localApi}${path}`}, path)
      }
    }
  }

  readSchema(schema: OpenAPI2SchemaObject, localName: string | null): ApiShape {
    if (schema.$ref) {
      const localDefPref = `#/definitions/${this.localApi}`;
      let shape = schema.$ref.startsWith(localDefPref)
        ? this.shapes.get(schema.$ref.slice(localDefPref.length))
        : undefined;
      if (!shape) {
        shape = this.resolveRef(schema);
      }
      return shape;

    } else if (schema.properties) {
      if (schema.additionalProperties) throw new Error(`TODO: complex obj`)
      const fields = new Map<string,ApiShape>();
      const shape: ApiShape = {
        type: 'structure',
        description: schema.description ?? undefined,
        required: schema.required ?? [],
        fields,
      };
      if (localName) this.shapes.set(localName, shape);

      for (const [key, val] of Object.entries(schema.properties)) {
        fields.set(key, this.readSchema(val, null));
      }
      return shape;

    } else if (schema.type === 'array' && schema.items) {
      return {
        type: 'list',
        description: schema.description ?? undefined,
        inner: this.readSchema(schema.items, null),
      };

    } else if (schema.type === 'object' && typeof schema.additionalProperties === 'object' && schema.additionalProperties != null) {
      return {
        type: 'map',
        description: schema.description ?? undefined,
        inner: this.readSchema(schema.additionalProperties, null),
      };

    } else if (schema['x-kubernetes-preserve-unknown-fields'] || localName == 'FieldsV1') {
      return {
        type: 'any',
        reference: 'unknown',
        description: schema.description ?? undefined,
      };

    } else if (schema.type === 'object') {
      return {
        type: 'structure',
        description: schema.description ?? undefined,
        required: [],
        fields: new Map,
      };

    } else if (schema.type === 'string') {
      if (schema.format === "date-time") {
        return {
          type: 'special',
          name: 'Time',
          description: schema.description ?? undefined,
        };
      }
      if (schema.format === "int-or-string") {
        return {
          type: 'special',
          name: 'IntOrString',
          description: schema.description ?? undefined,
        };
      }

      return {
        type: 'string',
        format: schema.format ?? undefined,
        enum: schema.enum ?? undefined,
        description: schema.description ?? undefined,
      };

    } else if (schema.type === 'integer' || schema.type === 'number') {
      if (schema.format === "date-time") throw new Error(`EROR: numeric date/time`);
      if (schema.format === "int-or-string") throw new Error(`EROR: numeric int-or-string`);
      return {
        type: 'number',
        format: schema.format ?? undefined,
        description: schema.description ?? undefined,
      };

    } else if (schema.type === 'boolean') {
      return {
        type: 'boolean',
        description: schema.description ?? undefined,
      };

    } else if (schema['x-kubernetes-int-or-string']) {
      return {
        type: 'special',
        name: 'IntOrString',
        description: schema.description ?? undefined,
      };

    } else if (localName === 'JSONSchemaPropsOrBool') {
      return {
        type: 'any',
        description: schema.description ?? undefined,
        reference: 'JSONSchemaProps | boolean',
      };

    } else if (localName === 'JSONSchemaPropsOrStringArray') {
      return {
        type: 'any',
        description: schema.description ?? undefined,
        reference: 'JSONSchemaProps | string[]',
      };

    } else if (localName === 'JSONSchemaPropsOrArray') {
      return {
        type: 'any',
        description: schema.description ?? undefined,
        reference: 'JSONSchemaProps | JSONSchemaProps[]',
      };

    } else if (localName === 'JSON') {
      return {
        type: 'any',
        description: schema.description ?? undefined,
        reference: 'JSON[] | Record<string, JSON> | number | string | boolean | null',
      };

    }
    console.log('TODO', schema, localName);
    throw new Error(`TODO`);
  }

  resolveRef(schema: OpenAPI2SchemaObject): ApiShape {
    const prefix = '#/definitions/';
    if (!schema.$ref?.startsWith(prefix)) {
      console.log('TODO 322', schema);
      throw new Error(`TODO resolveSchema ${schema.$ref}`);
    }
    const defId = schema.$ref.slice(prefix.length);

    switch (defId) {
      case 'io.k8s.apimachinery.pkg.runtime.RawExtension':
        return {type: 'any', reference: 'unknown'};
      case 'io.k8s.apimachinery.pkg.api.resource.Quantity':
      case 'io.k8s.apimachinery.pkg.api.resource.Quantity_v2':
        return {type: 'special', name: 'Quantity'};
      case 'io.k8s.apimachinery.pkg.apis.meta.v1.Time':
        return {type: 'special', name: 'Time'};
      case 'io.k8s.apimachinery.pkg.apis.meta.v1.MicroTime':
        return {type: 'special', name: 'MicroTime'};
      case 'io.k8s.apimachinery.pkg.apis.meta.v1.Duration':
        return {type: 'special', name: 'Duration'};
      case 'io.k8s.apimachinery.pkg.util.intstr.IntOrString':
        return {type: 'special', name: 'IntOrString'};
    }

    if (!defId.startsWith(this.localApi)) {
      const defName = defId.slice(defId.lastIndexOf('.')+1);
      const defPrefix = defId.slice(0, -defName.length);
      // console.log('foreign', [defName, defPrefix]);
      const api = this.otherPrefixes.get(defPrefix);
      if (!api) throw new Error(`Foreign not found ${schema.$ref}`);
      this.referencedLibraries.add(api);
      return {
        type: 'foreign',
        api, name: defName,
      };
    }

    const defName = defId.slice(this.localApi.length);
    const definition = this.availableNames.get(defName);
    if (!definition) throw new Error(`Local Def ${defName} not found`);
    const shape = this.readSchema(definition, defName);

    // todo: remove?
    shape.reference = defName;

    this.shapes.set(defName, shape);

    const [kind] = definition["x-kubernetes-group-version-kind"] ?? [];
    if (kind) {
      shape.kind = kind;
    }

    return shape;
  }
}
// export class ApiShape {}

export type ApiShape =
| AnyShape
| BooleanShape
| PrimitiveShape
| WrapperShape
| StructureShape
| ForeignShape
| SpecialShape
;

export interface ShapeMeta {
  reference?: string;
  description?: string;
  kind?: GroupVersionKind;
}

export interface AnyShape extends ShapeMeta {
  type: 'any';
}

export interface BooleanShape extends ShapeMeta {
  type: 'boolean';
}

export interface PrimitiveShape extends ShapeMeta {
  type: 'string' | "number";
  format?: "byte" | "double" | "int32" | "int64";
  enum?: string[];
}

export interface WrapperShape extends ShapeMeta {
  type: 'list' | 'map';
  inner: ApiShape;
}

export interface StructureShape extends ShapeMeta {
  type: 'structure';
  required: string[];
  fields: Map<string,ApiShape>;
}

export interface ForeignShape extends ShapeMeta {
  type: 'foreign';
  api: SurfaceApi;
  name: string;
}

export interface SpecialShape extends ShapeMeta {
  type: 'special';
  name: "IntOrString" | "Quantity" | "Time" | "MicroTime" | "Duration" | "ProxyOptions";
}

import { join as joinPath } from "@std/path/join";
import { generateModuleTypescript } from "./codegen-mod.ts";
import { generateStructsTypescript } from "./codegen-structs.ts";
import type { SurfaceApi, SurfaceMap } from "./surface.ts";

export async function emitSurfaceApis(surface: SurfaceMap, baseDir: string, apisModuleRoot?: string): Promise<void> {
  for (const api of surface.allApis) {
    if (api.moduleName.startsWith('../')) continue;
    try {
      await emitApiModule(surface, api, baseDir, apisModuleRoot);
    } catch (err) {
      console.error(`Error writing`, api.apiGroupVersion);
      console.error(err);
    }
  }
}

async function emitApiModule(surface: SurfaceMap, api: SurfaceApi, baseDir: string, apisModuleRoot?: string): Promise<void> {
  const modRoot = joinPath(baseDir, api.moduleName);

  function postProcess(text: string) {
    if (apisModuleRoot) {
      const isJsrRoot = apisModuleRoot.startsWith('jsr:') || apisModuleRoot.startsWith('@');
      text = text.replaceAll(/from "..\/..\/([^"]+)"/g, (_, path) => {
        if (isJsrRoot && path.includes('@')) {
          return `from "${apisModuleRoot}${path.split('/')[1].replace('@', '/')}"`;
        } else {
          return `from "${apisModuleRoot}${path}"`;
        }
      });
    }
    return text;
  }

  await Deno.mkdir(modRoot, {recursive: true});

  await Deno.writeTextFile(joinPath(modRoot, 'structs.ts'),
    postProcess(generateStructsTypescript(surface, api)));
  console.log('Wrote', joinPath(modRoot, 'structs.ts'));

  if (api.operations.length > 0) {
    await Deno.writeTextFile(joinPath(modRoot, 'mod.ts'),
      postProcess(generateModuleTypescript(surface, api)));
    console.log('Wrote', joinPath(modRoot, 'mod.ts'));
  }
}

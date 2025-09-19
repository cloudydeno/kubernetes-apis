// This file is just the entire matching kubernetes-client version.
// kubernetes-apis itself only depends on specific files,
// so this is provided an optional utility.

export * from "@cloudydeno/kubernetes-client";
export * as tunnelBeta from "@cloudydeno/kubernetes-client/tunnel-beta/via-websocket.ts";

export * from "@cloudydeno/kubernetes-client/lib/contract.ts";
export {
  WatchEventTransformer,
} from "@cloudydeno/kubernetes-client/lib/stream-transformers.ts";

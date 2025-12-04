#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --unstable

import { autoDetectClient } from '../deps.ts';
import { CoreV1Api } from '../builtin/core@v1/mod.ts';

const restClient = await autoDetectClient();
const coreApi = new CoreV1Api(restClient);

// Launch a port-forward into a particular pod
const tunnel = await coreApi
  .namespace('media')
  .tunnelPodPortforward('sabnzbd-srv-0', {
    ports: [8080], // WebSockets work by declaring the port targets upfront
  });

// Connect to the port
const connection = await tunnel.connectToPort(8080);
connection.result.catch(x => console.log(`ERR: ${x.message}`));

// Send an HTTP request
const writer = connection.writable.getWriter();
await writer.write(new TextEncoder().encode([
  `GET /healthz HTTP/1.1`,
  `Host: localhost:8000`,
  `Connection: close`,
  `Accept: */*`,
  ``, ``,
].join('\r\n')));
await writer.close();

// Print the full response
const resp = await new Response(connection.readable).text();
console.log(resp);

// Can also serve the forwarded port locally with this helper:
//tunnel.servePortforward({ port: 8080, targetPort: 8088 });
// Note that this depends on SPDY as the transport.

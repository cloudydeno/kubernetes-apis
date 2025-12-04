#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --unstable

import { autoDetectClient } from '../deps.ts';
import { CoreV1Api } from '../builtin/core@v1/mod.ts';

const restClient = await autoDetectClient();
const coreApi = new CoreV1Api(restClient);

// Launch a process into a particular container
const tunnel = await coreApi
  .namespace('media')
  .tunnelPodExec('sabnzbd-srv-0', {
    command: ['uname', '-a'],
    stdout: true,
    stderr: true,
  });

// Buffer & print the contents of stdout
const output = await tunnel.output();
console.log(new TextDecoder().decode(output.stdout).trimEnd());

// Print any error that occurred
if (output.status !== 'Success') {
  console.error(output.message);
}

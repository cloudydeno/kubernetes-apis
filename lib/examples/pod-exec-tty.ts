#!/usr/bin/env -S deno run --unstable --allow-env --allow-read --allow-net

import { autoDetectClient } from '../deps.ts';
import { CoreV1Api } from '../builtin/core@v1/mod.ts';

const restClient = await autoDetectClient();
const coreApi = new CoreV1Api(restClient);

// Launch a process into a particular container
const tunnel = await coreApi
  .namespace('media')
  .tunnelPodExec('sabnzbd-srv-0', {
    command: ['bash', '-i'],
    stdin: true,
    stdout: true,
    tty: true,
  });

// Report the initial terminal size
await tunnel.ttySetSize(Deno.consoleSize());

// Set up our parent tty for passthru
Deno.stdin.setRaw(true, { cbreak: true });

// Pass several signals into the container tty
Deno.addSignalListener('SIGINT', () => tunnel.ttyWriteSignal('INTR'));
Deno.addSignalListener('SIGQUIT', () => tunnel.ttyWriteSignal('QUIT'));
Deno.addSignalListener('SIGTSTP', () => tunnel.ttyWriteSignal('SUSP'));

// Connect our stdin/stdout with the tunnel's
await Deno.stdin.readable.pipeThrough({
  writable: tunnel.stdin,
  readable: tunnel.stdout,
}).pipeTo(Deno.stdout.writable);

// Copy the remote command's exit code, if any
const status = await tunnel.status;
if (typeof status.exitCode == 'number') {
  Deno.exit(status.exitCode);
} else {
  console.error('Kubernetes says:', status.message);
  Deno.exit(1);
}

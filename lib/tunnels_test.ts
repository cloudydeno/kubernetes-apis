import { assertEquals } from "https://deno.land/std@0.198.0/assert/mod.ts";
import { StdioTunnel, type ExecStatus, PortforwardTunnel } from "./tunnels.ts";

Deno.test('stdiotunnel output buffering', async () => {
  const intendedStdout = 'hello world';

  const tunnel = new StdioTunnel({
    getReadableStream(opts) {
      if (opts.index == 1) return ReadableStream
        .from([intendedStdout])
        .pipeThrough(new TextEncoderStream());
      if (opts.index == 3) return ReadableStream
        .from([JSON.stringify({
            status: 'Success',
          } satisfies ExecStatus)])
        .pipeThrough(new TextEncoderStream());
      throw new Error(`Unexpected read stream ${opts.index}`);
    },
    getWritableStream(opts) {
      throw new Error(`Unexpected write stream ${opts.index}`);
    },
    whenReady: () => Promise.resolve(),
    close: () => Promise.resolve(),
    [Symbol.dispose]: () => Promise.resolve(),
    subProtocol: 'v4.tunnel.k8s.io',
    transportProtocol: 'Opaque',
  }, new URLSearchParams([
    ['stdout', '1'],
  ]));
  await tunnel.ready;

  const output = await tunnel.output();

  assertEquals(new TextDecoder().decode(output.stdout), intendedStdout);
});

Deno.test('stdiotunnel stdin half-close', async () => {
  const startByte = 10;
  const echoedByte = 20;
  const flushByte = 30;

  const echoPipe = new TransformStream<Uint8Array, Uint8Array>({
    start(ctlr) {
      ctlr.enqueue(new Uint8Array([startByte]));
    },
    flush(ctlr) {
      ctlr.enqueue(new Uint8Array([flushByte]));
    },
  });

  const tunnel = new StdioTunnel({
    getReadableStream(opts) {
      if (opts.index == 1) return echoPipe.readable;
      if (opts.index == 3) return ReadableStream
        .from([JSON.stringify({
            status: 'Success',
          } satisfies ExecStatus)])
        .pipeThrough(new TextEncoderStream());
      throw new Error(`Unexpected read stream ${opts.index}`);
    },
    getWritableStream(opts) {
      if (opts.index == 0) return echoPipe.writable;
      throw new Error(`Unexpected write stream ${opts.index}`);
    },
    whenReady: () => Promise.resolve(),
    close: () => Promise.resolve(),
    [Symbol.dispose]: () => Promise.resolve(),
    subProtocol: 'v4.tunnel.k8s.io',
    transportProtocol: 'Opaque',
  }, new URLSearchParams([
    ['stdin', '1'],
    ['stdout', '1'],
  ]));
  await tunnel.ready;

  const stdin = tunnel.stdin.getWriter();
  stdin.write(new Uint8Array([echoedByte]));
  stdin.close();

  const output = await tunnel.output();

  assertEquals(output.stdout, new Uint8Array([startByte, echoedByte, flushByte]));
});

Deno.test('portforwardtunnel echo pipe', async () => {
  const echoPipe = new TransformStream<Uint8Array, Uint8Array>({
    start(ctlr) {
      ctlr.enqueue(new Uint8Array([0,70])); // TODO: this should fail due to mismatch
    },
  });

  const tunnel = new PortforwardTunnel({
    getReadableStream(opts) {
      if (opts.index == 0) return echoPipe.readable;
      return new ReadableStream({
        start(ctlr) {
          ctlr.close();
        },
      }).pipeThrough(new TextEncoderStream());
    },
    getWritableStream(opts) {
      if (opts.index == 0) return echoPipe.writable;
      throw new Error(`Unexpected write stream ${opts.index}`);
    },
    whenReady: () => Promise.resolve(),
    close: () => Promise.resolve(),
    [Symbol.dispose]: () => Promise.resolve(),
    subProtocol: 'v4.tunnel.k8s.io',
    transportProtocol: 'WebSocket', // specifies semantics of tunnelled socket setup
  }, new URLSearchParams([
    ['ports', '80'],
  ]));
  await tunnel.ready;

  const intendedText = 'asdf pickel';

  const socket = tunnel.connectToPort(80);
  const [output] = await Promise.all([
    new Response(socket.readable).text(),
    (async () => {
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(intendedText));
      writer.close();
    })(),
  ]);

  assertEquals(output, intendedText);
});

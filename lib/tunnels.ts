import type { KubernetesTunnel } from "./deps.ts";

export type TerminalSize = {
  columns: number;
  rows: number;
}

export type ExecStatus = {
  status: 'Success' | 'Failure';
  exitCode?: number; // We add this ourselves
  message?: string;
  reason?: string;
  code?: number;
  details?: { causes: Array<{
    reason: string;
    message: string;
  }> };
}

export class StdioTunnel {
  static readonly supportedProtocols = [
    'v5.channel.k8s.io', // v5: adds stdin closing (handled within the WebSocket client)
    'v4.channel.k8s.io', // v4: switches error stream to JSON
    'v3.channel.k8s.io', // v3: adds terminal resizing
    // 'v2.channel.k8s.io',
    // 'channel.k8s.io',
  ];

  constructor(
    private readonly tunnel: KubernetesTunnel,
    originalParams: URLSearchParams,
  ) {
    if (this.tunnel.subProtocol.startsWith('v')) {
      this.channelVersion = parseInt(this.tunnel.subProtocol.slice(1));
    } else {
      this.channelVersion = 1;
    }

    this.#stdin = originalParams.get('stdin') == '1'
      ? tunnel.getWritableStream({ index: 0, spdyHeaders: { streamType: 'stdin' } })
      : null;

    this.#stdout = originalParams.get('stdout') == '1'
      ? tunnel.getReadableStream({ index: 1, spdyHeaders: { streamType: 'stdout' } })
      : null;

    this.#stderr = originalParams.get('stderr') == '1'
      ? tunnel.getReadableStream({ index: 2, spdyHeaders: { streamType: 'stderr' } })
      : null;

    const errorStream = tunnel.getReadableStream({ index: 3, spdyHeaders: { streamType: 'error' } });
    this.status = new Response(errorStream).text()
      .then<ExecStatus>(text => this.channelVersion >= 4
        ? addExitCode(JSON.parse(text))
        : { status: 'Failure', message: text });

    this.#resize = (originalParams.get('tty') == '1' && this.channelVersion >= 3)
      ? wrapResizeStream(tunnel.getWritableStream({ index: 4, spdyHeaders: { streamType: 'resize' } }))
      : null;

    if (this.#stdin && originalParams.get('tty') == '1') {
      const writer = this.#stdinWriter = this.#stdin.getWriter();
      // TODO: check if this breaks stdin backpressure
      this.#stdin = new WritableStream({
        write(chunk) { return writer.write(chunk); },
        abort(reason) { return writer.abort(reason); },
        close() { return writer.close(); },
      });
    }
  }
  readonly channelVersion: number;
  #stdin: WritableStream<Uint8Array> | null = null;
  #stdinWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #stdout: ReadableStream<Uint8Array> | null = null;
  #stderr: ReadableStream<Uint8Array> | null = null;
  #resize: WritableStream<TerminalSize> | null = null;
  status!: Promise<ExecStatus>;

  get ready(): Promise<void> {
    return this.tunnel.whenReady();
  }

  // Take a cue from Deno.Command which presents the streams unconditionally
  // but throws if they are used when not configured
  get stdin(): WritableStream<Uint8Array> {
    if (!this.#stdin) throw new TypeError("stdin was not requested");
    return this.#stdin;
  }
  get stdout(): ReadableStream<Uint8Array> {
    if (!this.#stdout) throw new TypeError("stdout was not requested");
    return this.#stdout;
  }
  get stderr(): ReadableStream<Uint8Array> {
    if (!this.#stderr) throw new TypeError("stderr was not requested");
    return this.#stderr;
  }
  /** If tty was requested, an outbound stream for dynamically changing the TTY dimensions */
  get ttyResizeStream(): WritableStream<TerminalSize> {
    if (!this.#resize) throw new TypeError("tty was not requested");
    return this.#resize;
  }

  /** Shorthand for injecting Ctrl-C and others when running an interactive TTY */
  async ttyWriteSignal(signal: 'INTR' | 'QUIT' | 'SUSP'): Promise<void> {
    if (!this.#stdinWriter) throw new TypeError("tty and stdin were not requested together, cannot write signals");
    switch (signal) {
      // via https://man7.org/linux/man-pages/man3/termios.3.html
      case 'INTR': await this.#stdinWriter.write(new Uint8Array([0o003])); break;
      case 'QUIT': await this.#stdinWriter.write(new Uint8Array([0o034])); break;
      case 'SUSP': await this.#stdinWriter.write(new Uint8Array([0o032])); break;
      default: throw new TypeError(`cannot write unrecognized signal ${signal}`);
    }
  }

  /** Shorthand for writing to the tty resize stream, especially useful for setting an initial size */
  async ttySetSize(size: TerminalSize): Promise<void> {
    const sizeWriter = this.ttyResizeStream.getWriter();
    await sizeWriter.write(size);
    sizeWriter.releaseLock();
  }

  // Based on https://github.com/denoland/deno/blob/ca9ba87d9956e3f940e0116866e19461f008390b/runtime/js/40_process.js#L282C1-L319C1
  /** Buffers all data for stdout and/or stderr and returns the buffers when the remote command exits. */
  async output(): Promise<ExecStatus & {
    stdout: Uint8Array;
    stderr: Uint8Array;
  }> {
    if (this.#stdout?.locked) {
      throw new TypeError(
        "Can't collect output because stdout is locked",
      );
    }
    if (this.#stderr?.locked) {
      throw new TypeError(
        "Can't collect output because stderr is locked",
      );
    }

    const [ status, stdout, stderr ] = await Promise.all([
      this.status,
      this.#stdout ? new Response(this.#stdout).arrayBuffer().then(x => new Uint8Array(x)) : null,
      this.#stderr ? new Response(this.#stderr).arrayBuffer().then(x => new Uint8Array(x)) : null,
    ]);

    return {
      ...status,
      get stdout() {
        if (!stdout) throw new TypeError("stdout was not requested");
        return stdout;
      },
      get stderr() {
        if (!stderr) throw new TypeError("stderr was not requested");
        return stderr;
      },
    };
  }

  /** Immediately disconnects the network tunnel, likely dropping any in-flight data. */
  kill(): void {
    this.tunnel.close();
  }
}


function wrapResizeStream(byteStream: WritableStream<Uint8Array>) {
  const writer = byteStream.getWriter();
  return new WritableStream<TerminalSize>({
    async abort(reason) {
      await writer.abort(reason);
    },
    async close() {
      await writer.close();
    },
    async write(chunk) {
      const bytes = new TextEncoder().encode(JSON.stringify({
        Width: chunk.columns,
        Height: chunk.rows,
      }));
      await writer.write(bytes);
    },
  });
}

// Process exit code, if any, is given as a 'cause' for the non-success
function addExitCode(status: ExecStatus) {
  if (status.status == 'Success') {
    status.exitCode = 0;
  } else if (status.reason == 'NonZeroExitCode') {
    const cause = status.details?.causes.find(x => x.reason == 'ExitCode');
    if (cause) {
      status.exitCode = parseInt(cause.message);
    }
  }
  return status;
}


export class PortforwardTunnel {
  static readonly supportedProtocols = [
    // Apparently this differs between SPDY and WebSocket.
    // TODO: get to the bottom of that.
    'portforward.k8s.io', // SPDY - dynamic multi-port multiplexing
    'v4.channel.k8s.io', // WebSocket - static based on 'ports' param
  ];

  constructor(
    private tunnel: KubernetesTunnel,
    originalParams: URLSearchParams,
  ) {
    if (tunnel.subProtocol !== 'portforward.k8s.io') {
      const requestedPorts = originalParams.getAll('ports').map(x => parseInt(x));
      if (requestedPorts.length > 0) {
        this.remainingPorts = requestedPorts;
      } else {
        tunnel.close();
        throw new Error(`Kubernetes PortForwarding can only use WebSocket with a predefined list of ports. For dynamic multiplexing, try a SPDY client instead.`);
      }
    }
  }
  private nextRequestId = 0;
  private remainingPorts = new Array<number | false>;

  get ready(): Promise<void> {
    return this.tunnel.whenReady();
  }

  async connectToPort(port: number): Promise<{
    result: Promise<null>;
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  }> {
    let dataIdx: number | undefined = undefined;
    let errorIdx: number | undefined = undefined;

    if (this.remainingPorts) {
      const nextAvailableIdx = this.remainingPorts.findIndex(x => x == port);
      if (nextAvailableIdx < 0) throw new Error(`No remaining pre-established connections to port ${port}.`);
      this.remainingPorts[nextAvailableIdx] = false;

      dataIdx = nextAvailableIdx*2;
      errorIdx = dataIdx + 1;
    }

    // Used for SPDY only
    const requestID = this.nextRequestId++;

    const outboundStream = this.tunnel.getWritableStream({
      index: dataIdx,
      spdyHeaders: {
        streamType: 'data',
        port,
        requestID,
      },
    });

    const inboundStream = this.tunnel.getReadableStream({
      index: dataIdx,
      spdyHeaders: {
        streamType: 'data',
        port,
        requestID,
      },
    }).pipeThrough(new DropPrefix(port));

    const errorStream = this.tunnel.getReadableStream({
      index: errorIdx,
      spdyHeaders: {
        streamType: 'error',
        port,
        requestID,
      },
    }).pipeThrough(new DropPrefix(port));
    const errorBody = new Response(errorStream).text();

    await this.tunnel.whenReady();

    return {
      result: errorBody.then(x => x
        ? Promise.reject(new Error(`Portforward stream failed. ${x}`))
        : null),
      readable: inboundStream,
      writable: outboundStream,
    };
  }

  servePortforward(opts: Deno.ListenOptions & {
    targetPort: number;
  }): Deno.Listener {
    const listener = Deno.listen(opts);
    (async () => {
      for await (const downstream of listener) {
        const upstream = await this.connectToPort(opts.targetPort);
        console.error(`Client connection opened to ${opts.targetPort}`);
        Promise.all([
          upstream.result,
          downstream.readable.pipeThrough(upstream).pipeTo(downstream.writable),
        ]).then(x => {
          console.error('Client connection closed.', x[0]);
        }).catch(err => {
          console.error('Client connection crashed:', err.stack);
        });
      }
    })();
    return listener;
  }

  disconnect(): void {
    this.tunnel.close();
  }
}

class DropPrefix extends TransformStream<Uint8Array, Uint8Array> {
  constructor(_expectedPort: number) {
    let remaining = 2;
    super({
      transform(chunk, ctlr) {
        if (remaining > 0) {
          if (chunk.byteLength > remaining) {
            ctlr.enqueue(chunk.slice(remaining));
            remaining = 0;
          } else {
            remaining -= chunk.byteLength;
          }
        } else {
          ctlr.enqueue(chunk);
        }
      },
    });
  }
}

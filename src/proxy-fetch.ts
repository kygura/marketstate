// bun's native fetch() fails to complete the TLS handshake through an HTTP
// CONNECT-tunneling proxy in some sandboxed environments — the CONNECT
// succeeds (200) but the socket resets immediately after (ECONNRESET).
// bun's node:http compat layer turned out to be built on that same broken
// native fetch internally (confirmed: it throws "fetch() URL is invalid"
// from inside node:http's CONNECT path), so it can't be used to route around
// the bug either. node:net + node:tls are genuine, fetch-independent
// implementations and work fine (verified directly). When HTTPS_PROXY/
// https_proxy is set, tunnel manually via a raw net.Socket CONNECT + TLS
// upgrade; with no proxy configured (e.g. a normal local machine) this is a
// transparent pass-through to native fetch.
import * as fs from "node:fs";
import * as net from "node:net";
import * as tls from "node:tls";
import { URL } from "node:url";

export type ProxyFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

function getProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy;
}

function getCaBundle(): Buffer | undefined {
  const p = process.env.NODE_EXTRA_CA_CERTS || process.env.SSL_CERT_FILE;
  if (p && fs.existsSync(p)) return fs.readFileSync(p);
  return undefined;
}

function parseHttpResponse(raw: Buffer): { status: number; body: string } {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("malformed HTTP response: no header terminator");
  const headerText = raw.subarray(0, headerEnd).toString("utf-8");
  let bodyBuf = raw.subarray(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  if (!statusLine) throw new Error("malformed HTTP response: empty status line");
  const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
  if (!statusMatch || !statusMatch[1]) throw new Error(`malformed status line: ${statusLine}`);
  const status = Number(statusMatch[1]);
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  if (headers["transfer-encoding"]?.includes("chunked")) {
    bodyBuf = dechunk(bodyBuf);
  }
  return { status, body: bodyBuf.toString("utf-8") };
}

function dechunk(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const lineEnd = buf.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeLine = buf.subarray(offset, lineEnd).toString("utf-8").split(";")[0]?.trim() ?? "";
    const size = Number.parseInt(sizeLine, 16);
    if (!size) break;
    const chunkStart = lineEnd + 2;
    parts.push(buf.subarray(chunkStart, chunkStart + size));
    offset = chunkStart + size + 2; // skip trailing CRLF after the chunk data
  }
  return Buffer.concat(parts);
}

function tunnelFetch(url: string, init: ProxyFetchInit, proxyUrlStr: string): Promise<ProxyFetchResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = new URL(proxyUrlStr);
    const method = init.method ?? "GET";
    const body = init.body;
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    headers.Host = target.host;
    headers.Connection = "close";
    headers["Accept-Encoding"] = "identity";
    if (body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(body));

    let settled = false;
    const proxyPort = proxy.port ? Number(proxy.port) : 80;
    const targetPort = target.port ? Number(target.port) : 443;
    const socket = net.connect(proxyPort, proxy.hostname);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    if (init.signal) {
      if (init.signal.aborted) {
        fail(new Error("The operation was aborted"));
        return;
      }
      init.signal.addEventListener("abort", () => fail(new Error("The operation was aborted")), { once: true });
    }

    socket.setTimeout(20_000, () => fail(new Error("proxy connection timed out")));
    socket.on("error", (err) => fail(err));

    socket.on("connect", () => {
      socket.write(`CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\nHost: ${target.hostname}:${targetPort}\r\n\r\n`);
    });

    let connectBuf = "";
    let upgraded = false;
    socket.on("data", (chunk) => {
      if (upgraded) return;
      connectBuf += chunk.toString("latin1");
      const headerEnd = connectBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      upgraded = true;

      const statusLine = connectBuf.slice(0, connectBuf.indexOf("\r\n"));
      const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
      if (!statusMatch || statusMatch[1] !== "200") {
        fail(new Error(`proxy CONNECT failed: ${statusLine}`));
        return;
      }

      const tlsSocket = tls.connect({ socket, servername: target.hostname, ca: getCaBundle(), timeout: 20_000 }, () => {
        const reqLines = [`${method} ${target.pathname}${target.search} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", ""];
        tlsSocket.write(reqLines.join("\r\n") + (body ?? ""));
      });

      tlsSocket.on("timeout", () => fail(new Error("TLS request timed out")));
      tlsSocket.on("error", (err) => fail(err));

      const respChunks: Buffer[] = [];
      tlsSocket.on("data", (d: Buffer | string) => respChunks.push(typeof d === "string" ? Buffer.from(d) : d));
      tlsSocket.on("close", () => {
        if (settled) return;
        settled = true;
        try {
          const { status, body: respBody } = parseHttpResponse(Buffer.concat(respChunks));
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(respBody),
            text: async () => respBody,
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  });
}

// bun/fetch's failure signature for this bug: CONNECT succeeds, then the
// socket resets before the TLS response arrives.
function isProxyTunnelBug(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  return code === "ECONNRESET" || msg.includes("socket connection was closed unexpectedly");
}

export async function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<ProxyFetchResponse> {
  // Native fetch first — this is what test mocks (`global.fetch = ...`)
  // intercept, and it's the correct path whenever the proxy isn't hitting
  // the bug (no proxy configured, or a proxy that works fine).
  try {
    return await fetch(url, init as RequestInit);
  } catch (err) {
    const proxyUrlStr = getProxyUrl();
    if (!proxyUrlStr || !isProxyTunnelBug(err)) throw err;
    return tunnelFetch(url, init, proxyUrlStr);
  }
}

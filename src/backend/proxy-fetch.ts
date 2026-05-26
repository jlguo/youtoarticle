// HTTPS-through-TCP-proxy fetch helper
// Uses cloudflare:sockets connect() to tunnel through Webshare proxy,
// then upgrades to TLS for HTTPS requests.
import { connect } from 'cloudflare:sockets';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Make a non-streaming HTTPS GET request through a TCP proxy tunnel.
 * Returns the full response body as text.
 */
export async function proxyFetch(
  targetUrl: string,
  proxy: ProxyConfig,
): Promise<string> {
  const urlObj = new URL(targetUrl);
  const targetHost = urlObj.host;
  const targetPath = urlObj.pathname + urlObj.search;
  const targetPort = 443;

  const socket = connect({ hostname: proxy.host, port: proxy.port }, { secureTransport: "starttls", allowHalfOpen: false });
  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  try {
    // Step 1: Send HTTP CONNECT
    let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
    if (proxy.username && proxy.password) {
      const auth = btoa(`${proxy.username}:${proxy.password}`);
      connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
    }
    connectReq += '\r\n';
    await writer.write(encoder.encode(connectReq));

    // Step 2: Read CONNECT response
    let headerBuf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      headerBuf += decoder.decode(value, { stream: true });
      if (headerBuf.includes('\r\n\r\n')) break;
      if (headerBuf.length > 4096) break;
    }

    if (!headerBuf.includes('200')) {
      const statusLine = headerBuf.split('\r\n')[0];
      throw new Error(`Proxy CONNECT failed: ${statusLine}`);
    }

    // Step 3: Upgrade to TLS
    const tlsSocket = socket.startTls();
    await tlsSocket.opened;

    const tlsWriter = tlsSocket.writable.getWriter();
    const tlsReader = tlsSocket.readable.getReader();

    // Step 4: Send HTTP GET request
    const httpReq = `GET ${targetPath} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`;
    await tlsWriter.write(encoder.encode(httpReq));

    // Step 5: Read full response
    let responseBuf = '';
    while (true) {
      const { done, value } = await tlsReader.read();
      if (done) break;
      responseBuf += decoder.decode(value, { stream: true });
    }

    try { tlsWriter.close(); } catch { /* ignore */ }
    try { tlsReader.cancel(); } catch { /* ignore */ }

    // Step 6: Split headers and body
    const bodyStart = responseBuf.indexOf('\r\n\r\n');
    if (bodyStart === -1) {
      throw new Error('Invalid HTTP response from tunnel');
    }

    const headerSection = responseBuf.substring(0, bodyStart);
    const statusLine = headerSection.substring(0, headerSection.indexOf('\r\n'));
    const body = responseBuf.substring(bodyStart + 4);

    if (!headerSection.includes('200')) {
      throw new Error(`HTTP request through proxy failed: ${statusLine}`);
    }

    return body;
  } finally {
    try { writer.close(); } catch { /* ignore */ }
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

/**
 * Make an HTTPS POST request through a TCP proxy tunnel.
 * Returns the full response text (headers + body for parsing).
 */
export async function proxyFetchPost(
  targetUrl: string,
  proxy: ProxyConfig,
  body: string,
  contentType = 'application/json',
): Promise<string> {
  const urlObj = new URL(targetUrl);
  const targetHost = urlObj.host;
  const targetPath = urlObj.pathname + urlObj.search;
  const targetPort = 443;

  const socket = connect({ hostname: proxy.host, port: proxy.port }, { secureTransport: "starttls", allowHalfOpen: false });
  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  try {
    // Step 1: HTTP CONNECT
    let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
    if (proxy.username && proxy.password) {
      const auth = btoa(`${proxy.username}:${proxy.password}`);
      connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
    }
    connectReq += '\r\n';
    await writer.write(encoder.encode(connectReq));

    // Step 2: Read CONNECT response
    let headerBuf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      headerBuf += decoder.decode(value, { stream: true });
      if (headerBuf.includes('\r\n\r\n')) break;
      if (headerBuf.length > 4096) break;
    }

    if (!headerBuf.includes('200')) {
      const statusLine = headerBuf.split('\r\n')[0];
      throw new Error(`Proxy CONNECT failed: ${statusLine}`);
    }

    // Step 3: TLS upgrade
    const tlsSocket = socket.startTls();
    await tlsSocket.opened;

    const tlsWriter = tlsSocket.writable.getWriter();
    const tlsReader = tlsSocket.readable.getReader();

    // Step 4: Send HTTP POST request
    const bodyBytes = encoder.encode(body);
    const httpReq = `POST ${targetPath} HTTP/1.1\r\nHost: ${targetHost}\r\nContent-Type: ${contentType}\r\nContent-Length: ${bodyBytes.length}\r\nConnection: close\r\n\r\n`;
    await tlsWriter.write(encoder.encode(httpReq));
    await tlsWriter.write(bodyBytes);

    // Step 5: Read full response
    let responseBuf = '';
    while (true) {
      const { done, value } = await tlsReader.read();
      if (done) break;
      responseBuf += decoder.decode(value, { stream: true });
    }

    try { tlsWriter.close(); } catch { /* ignore */ }
    try { tlsReader.cancel(); } catch { /* ignore */ }

    // Step 6: Split headers and body
    const bodyStart = responseBuf.indexOf('\r\n\r\n');
    if (bodyStart === -1) {
      throw new Error('Invalid HTTP response from tunnel');
    }

    const headerSection = responseBuf.substring(0, bodyStart);
    const statusLine = headerSection.substring(0, headerSection.indexOf('\r\n'));
    const respBody = responseBuf.substring(bodyStart + 4);

    if (!headerSection.includes('200')) {
      throw new Error(`HTTP request through proxy failed: ${statusLine}\n${respBody}`);
    }

    return respBody;
  } finally {
    try { writer.close(); } catch { /* ignore */ }
    try { reader.cancel(); } catch { /* ignore */ }
  }
}

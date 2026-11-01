import { createServer } from "node:https";
import { request as upstreamRequest } from "node:http";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const bindHost = process.env.ASH_AI_TLS_HOST;
const port = Number(process.env.ASH_AI_TLS_PORT ?? 3443);
const upstreamPort = Number(process.env.ASH_AI_UPSTREAM_PORT ?? 3035);
const pfxPath = process.env.ASH_AI_TLS_PFX;
const pfxPassphrase = process.env.ASH_AI_TLS_PFX_PASSPHRASE;

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

if (!bindHost || isIP(bindHost) !== 4 || !isPrivateIPv4(bindHost)) {
  throw new Error("ASH_AI_TLS_HOST must be this PC's private IPv4 address.");
}
if (!pfxPath) throw new Error("Set ASH_AI_TLS_PFX to a private local HTTPS certificate in PFX format.");

const pfx = readFileSync(pfxPath);
const server = createServer({ pfx, passphrase: pfxPassphrase }, (request, response) => {
  const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}`, "x-forwarded-proto": "https" };
  const proxy = upstreamRequest({
    hostname: "127.0.0.1",
    port: upstreamPort,
    path: request.url,
    method: request.method,
    headers,
  }, (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ASH Chat local web server is not responding.");
  });
  request.pipe(proxy);
});

server.listen(port, bindHost, () => {
  console.log(`ASH Chat HTTPS proxy listening at https://${bindHost}:${port}`);
  console.log("This is for trusted same-Wi-Fi testing only. Do not port-forward or deploy.");
});

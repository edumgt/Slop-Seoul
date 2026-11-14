// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function getCliArg(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }
  }
  return void 0;
}
function resolvePort() {
  const cliPort = Number(getCliArg("port"));
  if (Number.isInteger(cliPort) && cliPort > 0) {
    return cliPort;
  }
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3e3;
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (Number.isInteger(envPort) && envPort > 0) {
    if (Number.isInteger(nginxPort) && envPort === nginxPort) {
      return defaultAppPort;
    }
    return envPort;
  }
  return defaultAppPort;
}
var app = express();
var PORT = resolvePort();
var HOST = getCliArg("host") || process.env.HOST || "0.0.0.0";
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    } else if (filePath.endsWith(".bin.gz")) {
      res.setHeader("Content-Type", "application/octet-stream");
    } else if (filePath.endsWith(".css")) {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
    }
  }
}));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
var server = app.listen(PORT, HOST, () => {
  console.log(`Slop Seoul \xB7 Teheran-ro server running on http://${HOST}:${PORT}`);
});
server.on("error", (err) => {
  console.error(`Failed to start server on ${HOST}:${PORT}:`, err);
  process.exit(1);
});
function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  setTimeout(() => process.exit(0), 1e3).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

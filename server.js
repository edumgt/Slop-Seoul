// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
var HOST = "0.0.0.0";
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
app.listen(PORT, HOST, () => {
  console.log(`Slop New York server running on http://${HOST}:${PORT}`);
});

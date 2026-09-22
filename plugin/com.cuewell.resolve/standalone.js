"use strict";

const { createEngine, defaultDataDir } = require("./lib/engine");
const { startServer } = require("./lib/server");

const engine = createEngine({ dataDir: defaultDataDir() });
const port = Number(process.env.PORT) || 47321;

startServer(engine, { port }).then((server) => {
  const info = server.info();
  console.log(`Cuewell library: ${engine.dataDir}`);
  console.log(`Open ${info.localUrl}`);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

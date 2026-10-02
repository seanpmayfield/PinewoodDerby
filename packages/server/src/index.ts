import { loadConfig } from './config.js';
import { buildApp, lanUrls } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

await app.fastify.listen({ host: config.host, port: config.port });
const httpsPort = await app.listenHttps().catch((err: Error) => {
  console.error(`HTTPS listener failed: ${err.message}`);
  return null;
});

console.log(`Pinewood Derby server`);
console.log(`  event:   ${app.engine().state.name}`);
console.log(`  timer:   ${config.timer}${app.timer.status.connected ? '' : ' (offline)'}`);
console.log(`  data:    ${config.dataDir}`);
console.log(`  local:   http://localhost:${config.port}${config.webDist ? '' : '  (API only; run the web dev server for the UI)'}`);
for (const url of lanUrls(config.port)) console.log(`  network: ${url}`);
if (httpsPort) {
  for (const url of lanUrls(httpsPort, 'https')) console.log(`  secure:  ${url}  (phones: open /phone once to trust the certificate)`);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { createServer } from "node:http";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { handler } = createApp();
createServer(handler).listen(port, "127.0.0.1", () => {
  console.log(`url-shortener listening on http://127.0.0.1:${port}`);
});

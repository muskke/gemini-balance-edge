import { handleRequest } from "../src/handle_request.js";

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
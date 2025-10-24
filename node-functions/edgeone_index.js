import { handleRequest } from "../src/handle_request.js";

export default function onRequest(context) {
  return handleRequest(context.request);
}

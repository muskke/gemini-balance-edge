import { handleVerification } from "../src/verify_keys.js";

export default function onRequest(context) {
  const request = context.request;
  
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const serverAuthToken = process.env.AUTH_TOKEN;
  if (serverAuthToken) {
    const authHeader = request.headers.get("Authorization");
    const bearer = authHeader?.split(" ")[1];
    if (bearer !== serverAuthToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }
  
  return handleVerification(request);
}

import { handleRequest } from './handle_request.js';

// Deno Deploy 的入口点
Deno.serve(async (request) => {
  try {
    // 直接调用我们现有的 handleRequest 逻辑
    return await handleRequest(request);
  } catch (error) {
    console.error('Critical error in Deno server:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: "An unexpected server error occurred in Deno Deploy.",
          details: error.message,
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

console.log("Deno server is running.");
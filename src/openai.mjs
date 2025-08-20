//Author: muskke
//Project: https://github.com/muskke/gemini-balance-edge
//MIT License : https://github.com/muskke/gemini-balance-edge/blob/main/LICENSE
import { logger, redactHeaders } from "./logger.mjs";

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const errHandler = (err) => {
      logger.error(err);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    try {
      const assert = (success) => {
        if (!success) {
          throw new HttpError("The specified HTTP method is not allowed for the requested resource", 400);
        }
      };

       logger.info("Forwarding to OpenAI compatible endpoint", {
         url: request.url,
         method: request.method,
         headers: redactHeaders(Object.fromEntries(request.headers.entries())),
        //  body: await request.clone().text(),
       });
      
      const { pathname } = new URL(request.url);
      switch (true) {
        case pathname.endsWith("/chat/completions"):
          assert(request.method === "POST");
          return handleCompletions(request)
            .catch(errHandler);
        case pathname.endsWith("/embeddings"):
          assert(request.method === "POST");
          return handleEmbeddings(request).catch(errHandler);
        case pathname.endsWith("/models"):
          assert(request.method === "GET");
          return handleModels(request)
            .catch(errHandler);
        default:
          throw new HttpError("404 Not Found", 404);
      }
    } catch (err) {
      return errHandler(err);
    }
  }
};

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return { headers, status, statusText };
};

const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};


const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";

async function handleModels(request) {
  let url = `${baseUrl}/${apiVersion}/openai/models`;
  const response = await fetch(url, {
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleEmbeddings(request) {
  let url = `${baseUrl}/${apiVersion}/openai/embeddings`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: request.body,
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleCompletions(request) {
  const requestBody = await request.json();
  const stream = requestBody.stream || false;

  let url = `${baseUrl}/${apiVersion}/openai/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": request.headers.get("Authorization"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (stream) {
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await response.text();

  logger.info("Received response from OpenAI compatible endpoint", {
    status: response.status,
    headers: redactHeaders(Object.fromEntries(response.headers.entries())),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  
  return new Response(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function verifyKey(key, controller) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const body = {
    "contents": [{
      "role": "user",
      "parts": [{
        "text": "Hello"
      }]
    }]
  };
  let result;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': key,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await response.text(); // Consume body to release connection
      result = { key: `${key.slice(0, 7)}......${key.slice(-7)}`, status: 'GOOD' };
    } else {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      result = { key: `${key.slice(0, 7)}......${key.slice(-7)}`, status: 'BAD', error: errorData.error.message };
    }
  } catch (e) {
    result = { key: `${key.slice(0, 7)}......${key.slice(-7)}`, status: 'ERROR', error: e.message };
  }
  controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(result) + '\n\n'));
}

export async function handleVerification(request) {
  try {
    const authHeader = request.headers.get('x-goog-api-key');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing x-goog-api-key header.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const keys = authHeader.split(',').map(k => k.trim()).filter(Boolean);

    const stream = new ReadableStream({
      async start(controller) {
        // 并行发起所有校验请求，但不等待它们全部完成
        const verificationPromises = keys.map(key =>
          verifyKey(key, controller).catch(e => {
            // 确保即使单个 promise 失败，也不会中断整个流
            console.error(`Error verifying key: ${key}`, e);
            const errorResult = { key: `${key.slice(0, 7)}......${key.slice(-7)}`, status: 'ERROR', error: 'Stream failed during verification.' };
            controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(errorResult) + '\n\n'));
          })
        );
        
        // 等待所有请求都已发出并处理完毕
        await Promise.all(verificationPromises);
        
        // 所有 key 都处理完毕后，关闭流
        controller.close();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'An unexpected error occurred: ' + e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

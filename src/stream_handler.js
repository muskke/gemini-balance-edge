/**
 * 流式响应处理器
 * 优化流式响应的性能和稳定性
 */

import { logger } from './logger.mjs';

export class StreamHandler {
  constructor() {
    this.activeStreams = new Map();
    this.streamStats = {
      totalStreams: 0,
      activeStreams: 0,
      completedStreams: 0,
      errorStreams: 0
    };
  }

  /**
   * 创建优化的流式响应
   * @param {Response} upstreamResponse - 上游响应
   * @param {string} selectedKey - 使用的密钥
   * @returns {Response}
   */
  createStreamResponse(upstreamResponse, selectedKey) {
    const streamId = this.generateStreamId();
    this.activeStreams.set(streamId, {
      startTime: Date.now(),
      key: selectedKey,
      status: 'active'
    });

    this.streamStats.totalStreams++;
    this.streamStats.activeStreams++;

    logger.info(`创建流式响应 ${streamId}，使用密钥 ...${selectedKey.slice(-4)}`);

    // 创建优化的响应头
    const responseHeaders = new Headers(upstreamResponse.headers);
    this.optimizeStreamHeaders(responseHeaders);

    // 创建流式响应体
    const streamBody = this.createOptimizedStream(upstreamResponse.body, streamId);

    return new Response(streamBody, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  /**
   * 优化流式响应头
   * @param {Headers} headers - 响应头
   */
  optimizeStreamHeaders(headers) {
    // 设置流式响应头
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    headers.set("Connection", "keep-alive");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
    headers.set("Transfer-Encoding", "chunked");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    
    // 设置流式响应特定的头
    headers.set("X-Stream-Type", "gemini-proxy");
    headers.set("X-Stream-Version", "1.0");
  }

  /**
   * 创建优化的流式响应体
   * @param {ReadableStream} upstreamBody - 上游响应体
   * @param {string} streamId - 流ID
   * @returns {ReadableStream}
   */
  createOptimizedStream(upstreamBody, streamId) {
    const encoder = new TextEncoder();
    let buffer = '';
    let chunkCount = 0;
    let lastChunkTime = Date.now();

    const reader = upstreamBody.getReader();
    
    return new ReadableStream({
      start(controller) {
        logger.info(`流式响应 ${streamId} 开始`);
        
        // 发送流开始标记
        controller.enqueue(encoder.encode(`data: {"type":"stream_start","stream_id":"${streamId}"}\n\n`));
      },

      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          
          if (done) {
            // 流结束
            this.handleStreamEnd(streamId, 'completed');
            controller.enqueue(encoder.encode(`data: {"type":"stream_end","stream_id":"${streamId}"}\n\n`));
            controller.close();
            return;
          }

          // 处理数据块
          chunkCount++;
          lastChunkTime = Date.now();
          
          // 发送数据块
          controller.enqueue(value);
          
          // 每100个块记录一次统计
          if (chunkCount % 100 === 0) {
            logger.debug(`流式响应 ${streamId} 已处理 ${chunkCount} 个数据块`);
          }

        } catch (error) {
          logger.error(`流式响应 ${streamId} 处理错误:`, error);
          this.handleStreamEnd(streamId, 'error');
          controller.error(error);
        }
      },

      cancel() {
        logger.info(`流式响应 ${streamId} 被取消`);
        this.handleStreamEnd(streamId, 'cancelled');
        reader.cancel();
      }
    });
  }

  /**
   * 处理流结束
   * @param {string} streamId - 流ID
   * @param {string} status - 结束状态
   */
  handleStreamEnd(streamId, status) {
    const streamInfo = this.activeStreams.get(streamId);
    if (streamInfo) {
      const duration = Date.now() - streamInfo.startTime;
      logger.info(`流式响应 ${streamId} 结束，状态: ${status}，持续时间: ${duration}ms`);
      
      this.activeStreams.delete(streamId);
      this.streamStats.activeStreams--;
      
      if (status === 'completed') {
        this.streamStats.completedStreams++;
      } else if (status === 'error') {
        this.streamStats.errorStreams++;
      }
    }
  }

  /**
   * 生成流ID
   * @returns {string}
   */
  generateStreamId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取流统计信息
   * @returns {Object}
   */
  getStreamStats() {
    return {
      ...this.streamStats,
      activeStreamDetails: Array.from(this.activeStreams.entries()).map(([id, info]) => ({
        id,
        duration: Date.now() - info.startTime,
        key: `...${info.key.slice(-4)}`,
        status: info.status
      }))
    };
  }

  /**
   * 清理超时的流
   * @param {number} timeoutMs - 超时时间（毫秒）
   */
  cleanupTimeoutStreams(timeoutMs = 300000) { // 5分钟超时
    const now = Date.now();
    const timeoutStreams = [];

    for (const [streamId, streamInfo] of this.activeStreams.entries()) {
      if (now - streamInfo.startTime > timeoutMs) {
        timeoutStreams.push(streamId);
      }
    }

    timeoutStreams.forEach(streamId => {
      logger.warn(`清理超时流式响应 ${streamId}`);
      this.handleStreamEnd(streamId, 'timeout');
    });
  }
}

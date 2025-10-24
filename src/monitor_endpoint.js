/**
 * 监控端点处理器
 * 提供系统状态和性能监控的 API 端点
 */

import { logger } from './logger.mjs';

export class MonitorEndpoint {
  constructor(monitoringSystem, keyManager, streamHandler) {
    this.monitoring = monitoringSystem;
    this.keyManager = keyManager;
    this.streamHandler = streamHandler;
  }

  /**
   * 处理监控请求
   * @param {Request} request - 请求对象
   * @returns {Response}
   */
  async handleMonitorRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const searchParams = url.searchParams;

    try {
      switch (path) {
        case '/monitor/health':
          return this.getHealthStatus();
        
        case '/monitor/metrics':
          return this.getMetrics(searchParams.get('format') || 'json');
        
        case '/monitor/keys':
          return this.getKeyStatus();
        
        case '/monitor/streams':
          return this.getStreamStatus();
        
        case '/monitor/errors':
          return this.getErrorReport();
        
        case '/monitor/full':
          return this.getFullReport();
        
        case '/monitor/performance':
          return this.getPerformanceReport();
        
        default:
          return this.getMonitorIndex();
      }
    } catch (error) {
      logger.error('监控端点处理错误:', error);
      return new Response(JSON.stringify({
        error: '监控端点处理失败',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * 获取健康状态
   * @returns {Response}
   */
  getHealthStatus() {
    const health = this.monitoring.getHealthStatus();
    const keyStats = this.keyManager.getStats();
    
    const response = {
      status: health.status,
      timestamp: new Date().toISOString(),
      uptime: health.uptime,
      metrics: {
        requests: {
          total: health.totalRequests,
          successRate: health.successRate
        },
        keys: {
          total: keyStats.totalKeys,
          healthy: keyStats.healthyKeys,
          unhealthy: keyStats.unhealthyKeys,
          healthRate: health.keyHealthRate
        },
        streams: {
          active: health.activeStreams
        },
        errors: {
          total: health.totalErrors
        }
      }
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: health.status === 'healthy' ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取指标数据
   * @param {string} format - 输出格式
   * @returns {Response}
   */
  getMetrics(format) {
    const metrics = this.monitoring.getFullReport();
    
    if (format === 'prometheus') {
      return this.formatPrometheusMetrics(metrics);
    }
    
    return new Response(JSON.stringify(metrics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取密钥状态
   * @returns {Response}
   */
  getKeyStatus() {
    const keyStats = this.keyManager.getStats();
    const monitoring = this.monitoring.getFullReport();
    
    const response = {
      timestamp: new Date().toISOString(),
      summary: {
        total: keyStats.totalKeys,
        healthy: keyStats.healthyKeys,
        unhealthy: keyStats.unhealthyKeys,
        averageWeight: keyStats.averageWeight
      },
      keys: keyStats.keyDetails,
      errorDistribution: monitoring.keys.byErrorCode,
      weightDistribution: monitoring.keys.weightDistribution
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取流状态
   * @returns {Response}
   */
  getStreamStatus() {
    const streamStats = this.streamHandler.getStreamStats();
    const monitoring = this.monitoring.getFullReport();
    
    const response = {
      timestamp: new Date().toISOString(),
      summary: {
        total: streamStats.totalStreams,
        active: streamStats.activeStreams,
        completed: streamStats.completedStreams,
        failed: streamStats.errorStreams
      },
      activeStreams: streamStats.activeStreamDetails,
      performance: {
        averageDuration: monitoring.streams.averageDuration
      }
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取错误报告
   * @returns {Response}
   */
  getErrorReport() {
    const monitoring = this.monitoring.getFullReport();
    
    const response = {
      timestamp: new Date().toISOString(),
      summary: {
        total: monitoring.errors.total,
        byType: monitoring.errors.byType,
        byKey: monitoring.errors.byKey
      },
      recent: monitoring.errors.recent.slice(-20), // 最近20个错误
      trends: this.calculateErrorTrends(monitoring.errors.recent)
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取性能报告
   * @returns {Response}
   */
  getPerformanceReport() {
    // 这里需要从性能优化器获取数据
    // 暂时返回基础性能信息
    const monitoring = this.monitoring.getFullReport();
    
    const response = {
      timestamp: new Date().toISOString(),
      performance: {
        averageResponseTime: monitoring.requests.averageResponseTime,
        totalRequests: monitoring.requests.total,
        successRate: monitoring.requests.total > 0 
          ? (monitoring.requests.successful / monitoring.requests.total * 100).toFixed(2) + '%'
          : '0%',
        errorRate: monitoring.errors.total > 0 
          ? (monitoring.errors.total / monitoring.requests.total * 100).toFixed(2) + '%'
          : '0%'
      },
      system: {
        uptime: monitoring.performance.uptime,
        memoryUsage: monitoring.performance.memoryUsage
      }
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取完整报告
   * @returns {Response}
   */
  getFullReport() {
    const fullReport = this.monitoring.getFullReport();
    const keyStats = this.keyManager.getStats();
    const streamStats = this.streamHandler.getStreamStats();
    
    const response = {
      ...fullReport,
      keyManager: keyStats,
      streamHandler: streamStats,
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 获取监控首页
   * @returns {Response}
   */
  getMonitorIndex() {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Gemini Balance Edge - 监控面板</title>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
        .endpoint { margin: 15px 0; padding: 15px; background: #f8f9fa; border-left: 4px solid #007acc; border-radius: 4px; }
        .endpoint h3 { margin: 0 0 10px 0; color: #007acc; }
        .endpoint p { margin: 5px 0; color: #666; }
        .method { display: inline-block; background: #28a745; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; margin-right: 10px; }
        .url { font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
        .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .healthy { background: #d4edda; color: #155724; }
        .degraded { background: #fff3cd; color: #856404; }
        .unhealthy { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Gemini Balance Edge 监控面板</h1>
        
        <div class="endpoint">
            <h3><span class="method">GET</span> 系统健康状态</h3>
            <p><span class="url">/monitor/health</span> - 获取系统整体健康状态</p>
            <p>返回系统运行状态、成功率、密钥健康度等关键指标</p>
        </div>

        <div class="endpoint">
            <h3><span class="method">GET</span> 性能指标</h3>
            <p><span class="url">/monitor/metrics</span> - 获取详细的性能指标数据</p>
            <p>支持 JSON 和 Prometheus 格式输出</p>
        </div>

        <div class="endpoint">
            <h3><span class="method">GET</span> 密钥状态</h3>
            <p><span class="url">/monitor/keys</span> - 查看所有 API 密钥的状态和权重分布</p>
            <p>包括健康状态、错误统计、权重分布等信息</p>
        </div>

        <div class="endpoint">
            <h3><span class="method">GET</span> 流状态</h3>
            <p><span class="url">/monitor/streams</span> - 监控流式响应的状态</p>
            <p>查看活跃流、完成统计、性能指标等</p>
        </div>

        <div class="endpoint">
            <h3><span class="method">GET</span> 错误报告</h3>
            <p><span class="url">/monitor/errors</span> - 查看错误统计和趋势</p>
            <p>包括错误类型分布、最近错误、趋势分析等</p>
        </div>

        <div class="endpoint">
            <h3><span class="method">GET</span> 完整报告</h3>
            <p><span class="url">/monitor/full</span> - 获取所有监控数据的完整报告</p>
            <p>包含系统、密钥、流、错误等所有监控信息</p>
        </div>

        <div style="margin-top: 30px; padding: 20px; background: #e3f2fd; border-radius: 4px;">
            <h3>📊 实时状态</h3>
            <p>系统运行时间: <span id="uptime">加载中...</span></p>
            <p>健康状态: <span id="health-status">检查中...</span></p>
            <p>活跃流数量: <span id="active-streams">检查中...</span></p>
        </div>
    </div>

    <script>
        async function updateStatus() {
            try {
                const response = await fetch('/monitor/health');
                const data = await response.json();
                
                document.getElementById('uptime').textContent = Math.floor(data.uptime / 1000) + ' 秒';
                
                const statusElement = document.getElementById('health-status');
                statusElement.textContent = data.status === 'healthy' ? '健康' : '降级';
                statusElement.className = 'status ' + (data.status === 'healthy' ? 'healthy' : 'degraded');
                
                document.getElementById('active-streams').textContent = data.metrics.streams.active;
            } catch (error) {
                console.error('状态更新失败:', error);
            }
        }
        
        updateStatus();
        setInterval(updateStatus, 5000); // 每5秒更新一次
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 格式化 Prometheus 指标
   * @param {Object} metrics - 指标数据
   * @returns {Response}
   */
  formatPrometheusMetrics(metrics) {
    let prometheus = '# HELP gemini_balance_edge_requests_total Total number of requests\n';
    prometheus += '# TYPE gemini_balance_edge_requests_total counter\n';
    prometheus += `gemini_balance_edge_requests_total ${metrics.requests.total}\n\n`;

    prometheus += '# HELP gemini_balance_edge_requests_successful_total Total number of successful requests\n';
    prometheus += '# TYPE gemini_balance_edge_requests_successful_total counter\n';
    prometheus += `gemini_balance_edge_requests_successful_total ${metrics.requests.successful}\n\n`;

    prometheus += '# HELP gemini_balance_edge_requests_failed_total Total number of failed requests\n';
    prometheus += '# TYPE gemini_balance_edge_requests_failed_total counter\n';
    prometheus += `gemini_balance_edge_requests_failed_total ${metrics.requests.failed}\n\n`;

    prometheus += '# HELP gemini_balance_edge_average_response_time_seconds Average response time in seconds\n';
    prometheus += '# TYPE gemini_balance_edge_average_response_time_seconds gauge\n';
    prometheus += `gemini_balance_edge_average_response_time_seconds ${(metrics.requests.averageResponseTime / 1000).toFixed(3)}\n\n`;

    prometheus += '# HELP gemini_balance_edge_keys_total Total number of API keys\n';
    prometheus += '# TYPE gemini_balance_edge_keys_total gauge\n';
    prometheus += `gemini_balance_edge_keys_total ${metrics.keys.total}\n\n`;

    prometheus += '# HELP gemini_balance_edge_keys_healthy_total Number of healthy API keys\n';
    prometheus += '# TYPE gemini_balance_edge_keys_healthy_total gauge\n';
    prometheus += `gemini_balance_edge_keys_healthy_total ${metrics.keys.healthy}\n\n`;

    prometheus += '# HELP gemini_balance_edge_streams_active_total Number of active streams\n';
    prometheus += '# TYPE gemini_balance_edge_streams_active_total gauge\n';
    prometheus += `gemini_balance_edge_streams_active_total ${metrics.streams.active}\n\n`;

    return new Response(prometheus, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /**
   * 计算错误趋势
   * @param {Array} errors - 错误记录
   * @returns {Object}
   */
  calculateErrorTrends(errors) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    const lastHour = errors.filter(e => now - e.timestamp < oneHour).length;
    const lastDay = errors.filter(e => now - e.timestamp < oneDay).length;

    return {
      lastHour,
      lastDay,
      trend: lastHour > lastDay / 24 ? 'increasing' : 'stable'
    };
  }
}

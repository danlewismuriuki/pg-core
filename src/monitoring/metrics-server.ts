import http from 'http';
import { logger } from '../utils/logger';
import { register } from './metrics';

export function startMetricsServer(port: number = 9090) {
  const server = http.createServer(async (req, res) => {
    // Only handle /metrics endpoint
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to get metrics');
        res.writeHead(500);
        res.end('Error getting metrics');
      }
      return;
    }
    
    // Add health endpoint
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'pg-core'
      }));
      return;
    }
    
    // Everything else gets 404
    res.writeHead(404);
    res.end();
  });
  
  server.listen(port, () => {
    logger.info(`Metrics server ready at http://localhost:${port}/metrics`);
  });
  
  return server;
}
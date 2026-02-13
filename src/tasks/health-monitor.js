/**
 * Aether-Claw Health Monitor (Node)
 * Basic system metrics (memory, CPU load estimate); no native deps.
 */

const os = require('os');

function checkSystemHealth() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryPercent = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;
  const memoryAvailableMb = freeMem / (1024 * 1024);
  const cpus = os.cpus();
  const loadAvg = os.loadavg && os.loadavg();
  return {
    cpu_percent: 0,
    memory_percent: memoryPercent,
    memory_available_mb: memoryAvailableMb,
    disk_percent: 0,
    disk_available_mb: 0,
    process_count: 0,
    load_average: loadAvg || null,
    uptime_seconds: os.uptime ? os.uptime() : null
  };
}

function detectAnomalies(health, opts = {}) {
  const { cpu_threshold = 80, memory_threshold = 90, disk_threshold = 90 } = opts;
  const anomalies = [];
  if (health.cpu_percent > cpu_threshold) anomalies.push({ anomaly_type: 'high_cpu', severity: health.cpu_percent > 95 ? 'critical' : 'high', message: `CPU ${health.cpu_percent.toFixed(1)}%` });
  if (health.memory_percent > memory_threshold) anomalies.push({ anomaly_type: 'high_memory', severity: health.memory_percent > 95 ? 'critical' : 'high', message: `Memory ${health.memory_percent.toFixed(1)}%` });
  if (health.disk_percent > disk_threshold) anomalies.push({ anomaly_type: 'high_disk', severity: health.disk_percent > 95 ? 'critical' : 'high', message: `Disk ${health.disk_percent.toFixed(1)}%` });
  if (health.memory_available_mb < 500) anomalies.push({ anomaly_type: 'low_memory_available', severity: 'medium', message: `Only ${health.memory_available_mb.toFixed(0)}MB available` });
  return anomalies;
}

module.exports = { checkSystemHealth, detectAnomalies };

module.exports = {
  apps: [{
    name: "them-bot",
    script: "./dist/discord-bot.js",
    watch: false,
    env: {
      NODE_ENV: "production",
    },
    max_memory_restart: "1G",
    autorestart: true,
    error_file: "logs/error.log",
    output_file: "logs/output.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
    log_type: "json",
    combine_logs: true,
    time: true,
    restart_delay: 4000,
    exp_backoff_restart_delay: 100,
    metrics: false,
    metric_interval: 0
  }]
}; 
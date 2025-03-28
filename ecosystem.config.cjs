module.exports = {
  apps: [
    {
      // Production Bot
      name: "them-bot",
      script: "./dist/discord-bot.js",
      watch: false,
      ignore_watch: ["node_modules", "logs", "cache"],
      instance_var: 'INSTANCE_ID',
      env_production: {
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: ".env.production",
        INSTANCE_ID: "production"
      },
      max_memory_restart: "1G",
      autorestart: true,
      error_file: "logs/production/error.log",
      output_file: "logs/production/output.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      log_type: "raw",
      combine_logs: true,
      time: false,
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
      max_restarts: 3,
      min_uptime: "30s",
      metrics: false,
      metric_interval: 0,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 5000,
      exec_mode: "fork",
      instances: 1
    },
    {
      // Development Bot
      name: "them-bot-dev",
      script: "./dist/discord-bot.js",
      watch: false,
      instance_var: 'INSTANCE_ID',
      env_development: {
        NODE_ENV: "development",
        DOTENV_CONFIG_PATH: ".env.development",
        INSTANCE_ID: "development"
      },
      max_memory_restart: "1G",
      autorestart: true,
      error_file: "logs/development/error.log",
      output_file: "logs/development/output.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      log_type: "raw",
      combine_logs: true,
      time: false,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      max_restarts: 3,
      min_uptime: "30s",
      metrics: false,
      metric_interval: 0,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 5000,
      exec_mode: "fork",
      instances: 1
    }
  ]
}; 
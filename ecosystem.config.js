module.exports = {
  apps: [{
    name: "them-bot",
    script: "./dist/discord-bot.js",
    watch: false,
    env: {
      NODE_ENV: "production",
    },
    // Restart if memory exceeds 1GB
    max_memory_restart: "1G",
    // Restart on error
    autorestart: true,
    // Error log file
    error_file: "logs/error.log",
    // Output log file
    output_file: "logs/output.log",
    // Time between automatic restarts
    restart_delay: 4000
  }]
} 
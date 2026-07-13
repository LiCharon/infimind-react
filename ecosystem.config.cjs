{
  "apps": [
    {
      "name": "infimind-server",
      "script": "server/index.js",
      "cwd": "/www/wwwroot/infimind-react",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production"
      },
      "log_date_format": "YYYY-MM-DD HH:mm:ss",
      "error_file": "./logs/server-error.log",
      "out_file": "./logs/server-out.log",
      "merge_logs": true,
      "max_memory_restart": "512M"
    }
  ]
}

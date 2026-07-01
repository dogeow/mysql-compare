module.exports = {
  apps: [{
    name: process.env.PM2_APP || "mysql-compare",
    cwd: process.env.PM2_CWD || __dirname,
    script: "node_modules/.bin/tsx",
    args: "src/web/index.ts",
    interpreter: "node",
    env: {
      NODE_ENV: "production",
      PORT: process.env.PORT || "3006",
      PATH: "/home/actions-runner/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
    },
    error_file: (process.env.APP_ROOT || "/var/www/mysql-compare") + "/logs/error.log",
    out_file: (process.env.APP_ROOT || "/var/www/mysql-compare") + "/logs/out.log",
    merge_logs: true,
    max_memory_restart: "512M",
  }],
};

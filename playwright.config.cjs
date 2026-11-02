const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./e2e',testMatch:'**/*.spec.cjs',fullyParallel:false,workers:1,retries:0,
  timeout:60000,expect:{timeout:10000},reporter:[['list']],outputDir:'test-results',
  use:{baseURL:'http://127.0.0.1:3020',browserName:'chromium',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node e2e/fixtures/server.cjs',url:'http://127.0.0.1:3021/ready',reuseExistingServer:false,timeout:30000,env:{LOCKGUARD_E2E_RUN:'1'}}
});

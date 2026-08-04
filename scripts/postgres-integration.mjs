import { spawnSync } from "node:child_process";

run("docker",["compose","up","-d","--wait","postgres"]);
run(process.execPath,[
  "node_modules/vitest/vitest.mjs",
  "run",
  "packages/persistence-postgres/tests/postgres.integration.test.ts",
],{...process.env,POSTGRES_INTEGRATION:"1"});

function run(command,args,env=process.env){
  const result=spawnSync(command,args,{stdio:"inherit",env,shell:false});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status??1);
}

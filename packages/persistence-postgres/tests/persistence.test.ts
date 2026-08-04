import { describe, expect, it } from "vitest";
import { createIvansDiaryFixture, ivansDiarySchema } from "@trust-core/fixtures-ivans-diary";
import { PostgresOutboxStore, PostgresTrustRepository, deterministicUuid, inTransaction, type DatabasePool, type QueryResult, type TransactionClient } from "../src/index.js";

class RecordingClient implements TransactionClient {
  readonly calls:{text:string;values?:readonly unknown[]}[]=[];
  failOn=""; released=false;
  async query<Row>(text:string,values?:readonly unknown[]):Promise<QueryResult<Row>>{this.calls.push(values ? {text,values} : {text});if(this.failOn&&text.includes(this.failOn))throw new Error("planned failure");return {rows:[],rowCount:0};}
  release(){this.released=true;}
}

function fakePool(client=new RecordingClient()):DatabasePool{return {query:(text,values)=>client.query(text,values),connect:async()=>client,end:async()=>{}};}

describe("PostgreSQL persistence",()=>{
  it("generates stable database UUIDs for portable Trust IDs",()=>{
    expect(deterministicUuid("resource-1")).toBe(deterministicUuid("resource-1"));
    expect(deterministicUuid("resource-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("rolls back and releases failed transactions",async()=>{
    const client=new RecordingClient();client.failOn="WORK";
    await expect(inTransaction(fakePool(client),db=>db.query("WORK"))).rejects.toThrow("planned failure");
    expect(client.calls.map(call=>call.text)).toEqual(["BEGIN","WORK","ROLLBACK"]);
    expect(client.released).toBe(true);
  });
  it("seeds schema, workspace and the entire synthetic dataset atomically",async()=>{
    const client=new RecordingClient();
    await new PostgresTrustRepository(fakePool(client)).seedSyntheticIvan(ivansDiarySchema,createIvansDiaryFixture());
    expect(client.calls[0]?.text).toBe("BEGIN");
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
    expect(client.calls.filter(call=>call.text.startsWith("INSERT INTO resources"))).toHaveLength(9);
    expect(client.calls.filter(call=>call.text.startsWith("INSERT INTO revisions"))).toHaveLength(9);
    expect(client.calls.some(call=>call.text.includes("set_config('trust.workspace_id'"))).toBe(true);
  });
  it("claims outbox work with scoped skip-locked leases and rejects lost ownership",async()=>{const client=new RecordingClient(),store=new PostgresOutboxStore(fakePool(client)),workspaceId=deterministicUuid("workspace");expect(await store.claim({workerId:"worker",workspaceId,limit:10,now:"2026-01-01T00:00:00.000Z",leaseUntil:"2026-01-01T00:00:30.000Z"})).toEqual([]);expect(client.calls.some(call=>call.text.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);await expect(store.complete(workspaceId,"event","worker","2026-01-01T00:00:01.000Z")).rejects.toThrow("lease was lost");});
});

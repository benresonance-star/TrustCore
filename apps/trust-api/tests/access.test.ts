import { describe, expect, it } from "vitest";
import { AdminSessionGateway } from "../src/access.js";

const actor={id:"admin",displayName:"Admin",roles:["admin" as const],workspaceIds:["workspace"]};
describe("administrator sessions",()=>{
  it("exchanges a bootstrap secret for a revocable session with CSRF protection",async()=>{
    const access=new AdminSessionGateway("bootstrap-secret",actor);
    expect(await access.createSession("wrong")).toBeUndefined();
    const created=await access.createSession("bootstrap-secret");expect(created?.session.actor).toEqual(actor);
    expect(await access.authenticateSession(created!.sessionId,undefined,false)).toEqual(actor);
    expect(await access.authenticateSession(created!.sessionId,"wrong",true)).toBeUndefined();
    expect(await access.authenticateSession(created!.sessionId,created!.session.csrfToken,true)).toEqual(actor);
    access.revoke(created!.sessionId);expect(await access.authenticateSession(created!.sessionId,undefined,false)).toBeUndefined();
  });
});

import { randomUUID } from "node:crypto";
import type { AuthenticatedActor, DeleteResourceCommand, DeleteResourceResult, HistorySnapshot, RecoverableItem, RestoreResourceCommand, RevisionCommand, RevisionCommandResult, TrustEventSummary } from "@trust-core/protocol";
import type { CommandProvider } from "./app.js";

export function createFixtureCommands(clock:()=>Date=()=>new Date()):CommandProvider {
  const recoverable:RecoverableItem[]=[{tombstoneId:"demo-tombstone-sketch",workspaceId:"workspace-demo",datasetId:"ivan",resourceId:"sketch-page-18",resourceTitle:"Hospital Visit",resourceType:"SketchPage",deletedAt:"2026-08-03T08:42:00.000Z",recoverUntil:"2026-11-01T00:00:00.000Z",deletedBy:"ivan",priorRevisionId:"revision-17"}];
  const events:TrustEventSummary[]=[{id:"event-1",action:"resource.deleted_logically",subjectId:"sketch-page-18",actorId:"ivan",occurredAt:"2026-08-03T08:42:00.000Z",metadata:{retentionDays:90}}]; let revisionNumber=17;
  const event=(action:string,subjectId:string,actorId:string,metadata:Record<string,unknown>)=>events.unshift({id:randomUUID(),action,subjectId,actorId,occurredAt:clock().toISOString(),metadata});
  return {
    async getHistory(workspaceId){return{recoverable:recoverable.filter(item=>item.workspaceId===workspaceId),events:[...events]};},
    async createRevision(resourceId,actor,command){revisionNumber+=1;const result={resourceId,revisionId:randomUUID(),revisionNumber,source:"user" as const,createdAt:clock().toISOString()};event("revision.created",resourceId,actor.id,{revisionId:result.revisionId});return result;},
    async deleteResource(resourceId,actor,command){const result:DeleteResourceResult={resourceId,tombstoneId:randomUUID(),deletedAt:clock().toISOString(),recoverUntil:command.recoverUntil};recoverable.unshift({tombstoneId:result.tombstoneId,workspaceId:command.workspaceId,datasetId:"fixture",resourceId,resourceTitle:command.reason??"Deleted fixture resource",resourceType:"Resource",deletedAt:result.deletedAt,recoverUntil:result.recoverUntil,deletedBy:actor.id,priorRevisionId:command.expectedRevisionId});event("resource.deleted_logically",resourceId,actor.id,{tombstoneId:result.tombstoneId});return result;},
    async restoreResource(resourceId,actor,_command){const index=recoverable.findIndex(item=>item.resourceId===resourceId);if(index<0)throw new Error("No recoverable deletion exists for this resource.");recoverable.splice(index,1);revisionNumber+=1;const result:RevisionCommandResult={resourceId,revisionId:randomUUID(),revisionNumber,source:"restore",createdAt:clock().toISOString()};event("revision.created",resourceId,actor.id,{source:"restore",revisionId:result.revisionId});return result;},
    async runVerification(_actor,command){const now=clock().toISOString();return{id:randomUUID(),workspaceId:command.workspaceId,level:command.level,status:"passed",startedAt:now,completedAt:now,objectsChecked:3284,bytesRead:command.level==="full_blob"?19971597926:0,issues:[]};},
  };
}

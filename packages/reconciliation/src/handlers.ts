import type { ObjectStorage } from "@trust-core/storage";
import type { EventHandler,OutboxEvent } from "./worker.js";
export interface ReconciliationCatalog { findBlob(input:{workspaceId:string;storageKey:string;sha256:string}):Promise<{id:string;byteLength:number}|undefined>; recordIncident(input:{workspaceId:string;operationId:string;severity:"warning"|"critical";code:string;message:string;metadata:Readonly<Record<string,unknown>>}):Promise<void>; }
export function createReconciliationHandlers(storage:ObjectStorage,catalog:ReconciliationCatalog):Readonly<Record<string,EventHandler>>{
  return{
    "resource.revision_created":async()=>undefined,
    "resource.deleted":async()=>undefined,
    "resource.restored":async()=>undefined,
    "temporary.cleanup_requested":async event=>{const key=requiredString(event,"storageKey");await storage.deleteTemporary({key});},
    "blob.reconcile_requested":async event=>{const storageKey=requiredString(event,"storageKey"),sha256=requiredString(event,"sha256"),expectedLength=requiredNumber(event,"byteLength"),metadata=await catalog.findBlob({workspaceId:event.workspaceId,storageKey,sha256});let head;try{head=await storage.head({key:storageKey});}catch(error){if(metadata)await catalog.recordIncident({workspaceId:event.workspaceId,operationId:event.operationId,severity:"critical",code:"METADATA_WITHOUT_OBJECT",message:"Canonical metadata points to missing or inaccessible bytes.",metadata:{storageKey,blobId:metadata.id}});else throw error;return;}if(!metadata){await catalog.recordIncident({workspaceId:event.workspaceId,operationId:event.operationId,severity:"warning",code:"UNATTACHED_IMMUTABLE_OBJECT",message:"Immutable bytes exist without committed metadata; object retained for review.",metadata:{storageKey,sha256,byteLength:head.byteLength}});return;}if(head.byteLength!==expectedLength||metadata.byteLength!==expectedLength){await catalog.recordIncident({workspaceId:event.workspaceId,operationId:event.operationId,severity:"critical",code:"RECONCILIATION_LENGTH_MISMATCH",message:"Object and metadata byte lengths disagree.",metadata:{storageKey,expectedLength,storageLength:head.byteLength,metadataLength:metadata.byteLength}});}},
  };
}
function requiredString(event:OutboxEvent,key:string):string{const value=event.payload[key];if(typeof value!=="string"||!value)throw new Error(`Invalid ${key} in ${event.eventType}`);return value;}
function requiredNumber(event:OutboxEvent,key:string):number{const value=event.payload[key];if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error(`Invalid ${key} in ${event.eventType}`);return value;}

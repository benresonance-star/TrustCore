import {
  Activity, Archive, BadgeCheck, Box, ChevronRight, CircleCheckBig, Clock3, Database,
  FileClock, Files, Fingerprint, GitBranch, HardDrive, History, Home, KeyRound, Library,
  Network, NotebookPen, PackageOpen, PanelsTopLeft, Search, ShieldCheck, Sparkles,
  TableProperties, Trash2, Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { HistorySnapshot } from "@trust-core/protocol";
import { fixtureGateway } from "./fixture-gateway";
import { GatewayError, httpGateway } from "./http-gateway";
import type { ControlCentreGateway, ControlCentreSnapshot, DatasetSummary, Section } from "./model";

const navigation: readonly { id: Section; label: string; Icon: typeof Home }[] = [
  { id: "home", label: "Home", Icon: Home },
  { id: "datasets", label: "Datasets", Icon: Database },
  { id: "flow", label: "Flow", Icon: Waypoints },
  { id: "health", label: "Health", Icon: Activity },
  { id: "history", label: "History", Icon: History },
  { id: "access", label: "Access", Icon: KeyRound },
];

const defaultGateway=import.meta.env.VITE_TRUST_API_BASE?httpGateway:fixtureGateway;
export function App({gateway=defaultGateway}:{gateway?:ControlCentreGateway}) {
  const [section, setSection] = useState<Section>("home");
  const [snapshot, setSnapshot] = useState<ControlCentreSnapshot | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState("moorabbin");
  const [appAuthRequired,setAppAuthRequired]=useState(false); const [appToken,setAppToken]=useState(""); const [appError,setAppError]=useState("");

  const loadSnapshot=()=>gateway.getSnapshot().then(value=>{setSnapshot(value);setAppAuthRequired(false);}).catch(error=>{if(error instanceof GatewayError&&error.status===401)setAppAuthRequired(true);else setAppError(error instanceof Error?error.message:"Control Centre unavailable.");});
  useEffect(() => { void loadSnapshot(); }, [gateway]);
  async function authenticateApp(event:FormEvent){event.preventDefault();setAppError("");try{await gateway.startAdminSession(appToken);setAppToken("");await loadSnapshot();}catch(error){setAppError(error instanceof Error?error.message:"Sign-in failed.");}}

  if(appAuthRequired)return <div className="auth-shell"><form className="card sign-in-card" onSubmit={event=>void authenticateApp(event)}><div className="brand auth-brand"><span className="brand-mark"><ShieldCheck size={18}/></span><span>Trust Core</span></div><KeyRound size={24}/><h1>Administrator sign-in</h1><p>Dataset summaries and recovery controls are protected. Use your organisation identity, including its passkey or MFA policy.</p><button className="button primary" type="button" onClick={()=>gateway.beginFederatedLogin("/")}>Continue with organisation identity</button><div className="auth-divider"><span>Development fallback</span></div><label>Bootstrap token<input type="password" autoComplete="off" value={appToken} onChange={event=>setAppToken(event.target.value)} required autoFocus/></label>{appError&&<div className="form-error" role="alert">{appError}</div>}<button className="button" type="submit">Use bootstrap token</button></form></div>;
  if(appError&&!snapshot)return <div className="auth-shell"><div className="card sign-in-card"><h1>Control Centre unavailable</h1><p>{appError}</p></div></div>;
  if (!snapshot) return <div className="loading">Loading continuity state…</div>;
  const selected = snapshot.datasets.find((dataset) => dataset.id === selectedDatasetId) ?? snapshot.datasets[0]!;

  function openDataset(id: string) {
    setSelectedDatasetId(id);
    setSection("datasets");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={18} /></span><span>Trust Core</span></div>
        <nav aria-label="Primary">
          {navigation.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={section === id ? "nav-item active" : "nav-item"} onClick={() => setSection(id)} aria-current={section === id ? "page" : undefined}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="operator"><span className="avatar">BR</span><div><strong>Ben</strong><small>Workspace admin</small></div></div>
      </aside>

      <main>
        <header className="topbar"><div><strong>Foundation Studio</strong><span>/ Control centre</span></div><div className="system-ok"><span />All systems operational</div></header>
        <div className="page">
          {section === "home" && <HomeView snapshot={snapshot} openDataset={openDataset} navigate={setSection} />}
          {section === "datasets" && <DatasetsView datasets={snapshot.datasets} selected={selected} onSelect={setSelectedDatasetId} navigate={setSection} />}
          {section === "flow" && <FlowView />}
          {section === "health" && <HealthView snapshot={snapshot} gateway={gateway} />}
          {section === "history" && <HistoryView gateway={gateway} />}
          {section === "access" && <AccessView />}
        </div>
      </main>
    </div>
  );
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="card metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function HomeView({ snapshot, openDataset, navigate }: { snapshot: ControlCentreSnapshot; openDataset: (id: string) => void; navigate: (section: Section) => void }) {
  const recent = snapshot.datasets.filter((dataset) => ["moorabbin", "brighton", "standards"].includes(dataset.id));
  const components = [
    { label: "Documents", note: "Drawings and files", Icon: Files },
    { label: "Tasks", note: "Work and approvals", Icon: CircleCheckBig },
    { label: "Notes", note: "Capture and organise", Icon: NotebookPen },
    { label: "Timesheets", note: "Time and sign-off", Icon: Clock3 },
    { label: "Resources", note: "Codes and references", Icon: Library },
  ];
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);

  return <>
    <PageHeading title="Good morning, Ben" subtitle="Your projects and shared system components." action={<button className="button">+ New project</button>} />
    <section><div className="section-heading"><h2>Recent projects</h2><button className="text-button" onClick={() => navigate("datasets")}>View all datasets</button></div>
      <div className="project-grid">{recent.map((dataset) => <article className="card project-card" key={dataset.id}>
        <div className="project-title"><div><h3>{dataset.name.replace(/^\d+ — /, "")}</h3><small>{dataset.description}</small></div><span className="badge">Active</span></div>
        <div><strong>{dataset.objects}</strong><small>Last verified {dataset.lastVerified.toLowerCase()}</small></div>
        <div className="project-footer"><span className="verified"><i />Protected</span><button className="button" onClick={() => openDataset(dataset.id)}>Open</button></div>
      </article>)}</div>
    </section>
    <div className="home-lower"><section><div className="section-heading"><h2>Common components</h2></div><div className="component-grid">
      {components.map(({ label, note, Icon }) => <button type="button" className={selectedComponent === label ? "component active" : "component"} key={label} onClick={() => setSelectedComponent(label)}><span><Icon size={18} /></span><div><strong>{label}</strong><small>{note}</small></div></button>)}
      <button type="button" className="component" onClick={() => navigate("datasets")}><span><ShieldCheck size={18} /></span><div><strong>Trust Core</strong><small>Storage and recovery</small></div></button>
    </div>{selectedComponent && <p className="selection-note">{selectedComponent} selected — this component will open inside the shared Foundation shell.</p>}</section>
      <article className="card continuity-card"><h2>Practice continuity</h2><div className="integrity-line"><BadgeCheck size={18} />All canonical stores verified</div><dl><div><dt>Protected datasets</dt><dd>{snapshot.status.protectedDatasets}</dd></div><div><dt>Latest backup</dt><dd>{snapshot.status.latestVerifiedBackup}</dd></div><div><dt>Recovery attention</dt><dd>{snapshot.status.recoveryAttention} low priority</dd></div></dl><button className="button wide" onClick={() => navigate("health")}>View system health</button></article>
    </div>
  </>;
}

function DatasetsView({ datasets, selected, onSelect, navigate }: { datasets: readonly DatasetSummary[]; selected: DatasetSummary; onSelect: (id: string) => void; navigate: (section: Section) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const filtered = useMemo(() => datasets.filter((dataset) => (kind === "all" || dataset.kind === kind) && dataset.name.toLowerCase().includes(query.toLowerCase())), [datasets, kind, query]);
  return <>
    <PageHeading title="Dataset registry" subtitle="Canonical stores, recovery state and controlled access." action={<button className="button">Export register</button>} />
    <div className="metrics"><Metric label="Protected datasets" value="128" note="Across 41 active projects" /><Metric label="Latest verified backup" value="02:14" note="Today · integrity passed" /><Metric label="Recovery attention" value="2" note="No canonical data at risk" /></div>
    <section><div className="section-heading registry-tools"><h2>Datasets</h2><div><label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search datasets" /></label><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All stores</option><option value="foundation">Foundation</option><option value="personal">Personal</option><option value="creative">Creative</option><option value="shared">Shared</option></select></div></div>
      <div className="dataset-layout"><div className="table-wrap"><table><thead><tr><th>Dataset</th><th>Canonical store</th><th>Last verified</th><th>Health</th></tr></thead><tbody>{filtered.map((dataset) => <tr key={dataset.id} className={dataset.id === selected.id ? "selected" : ""} onClick={() => onSelect(dataset.id)}><td><strong>{dataset.name}</strong><small>{dataset.description}</small></td><td>{dataset.canonicalStore}</td><td>{dataset.lastVerified}</td><td><span className={dataset.health === "verified" ? "verified" : "review"}><i />{dataset.health === "verified" ? "Verified" : "Review"}</span></td></tr>)}</tbody></table></div>
        <article className="card dataset-detail"><div className="detail-title"><div><h2>{selected.name}</h2><p>{selected.description}</p></div><span className="badge">{selected.kind === "personal" ? "Private" : "Protected"}</span></div><div className="integrity-line"><BadgeCheck size={18} />Canonical objects verified</div><dl><div><dt>Objects</dt><dd>{selected.objects}</dd></div><div><dt>Storage</dt><dd>{selected.storage}</dd></div><div><dt>Schema</dt><dd>{selected.schema}</dd></div><div><dt>Recovery</dt><dd>{selected.recovery}</dd></div><div><dt>Deleted</dt><dd>{selected.deleted}</dd></div></dl><h3>Recent trust events</h3>{selected.recentEvents.map((event) => <div className="event" key={event}><span><CircleCheckBig size={14} /></span><div><strong>{event}</strong><small>Verified event</small></div></div>)}<div className="detail-actions"><button className="button primary" onClick={() => navigate("history")}>Recovery</button><button className="button" onClick={() => navigate("history")}>Audit</button></div></article>
      </div>
    </section>
  </>;
}

const flowNodes = [
  { id: "apps", label: "Applications", note: "Foundation · WeSketch · Ivan", Icon: PanelsTopLeft },
  { id: "gateway", label: "Trust API", note: "One governed entry point", Icon: Network },
  { id: "identity", label: "Identity & policy", note: "Owner · role · permission", Icon: Fingerprint },
  { id: "revision", label: "Revision engine", note: "Immutable history", Icon: GitBranch },
  { id: "portability", label: "Portability", note: "Import · export · migrate", Icon: PackageOpen },
  { id: "semantic", label: "Semantic layer", note: "Derived, never canonical", Icon: Sparkles },
  { id: "metadata", label: "Metadata store", note: "Identity and relationships", Icon: TableProperties },
  { id: "objects", label: "Canonical objects", note: "Original bytes preserved", Icon: Box },
  { id: "audit", label: "Audit log", note: "Append-only trust events", Icon: FileClock },
  { id: "backup", label: "Backup & archive", note: "Restore beyond the app", Icon: Archive },
] as const;

function FlowView() {
  const [selected, setSelected] = useState("gateway");
  const item = flowNodes.find((node) => node.id === selected)!;
  const SelectedIcon = item.Icon;
  return <><PageHeading title="System flow" subtitle="How apps write, protect, recover and derive meaning from trusted data." />
    <div className="flow-canvas"><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs><path d="M210 246L248 246" /><path d="M440 246C466 246 463 63 488 63" /><path d="M440 246L488 206" /><path d="M440 246C466 246 463 350 488 350" /><path d="M690 63L758 63" /><path d="M690 206L758 206" /><path d="M690 350L758 350" /><path d="M865 245L865 458" /><path d="M758 245C650 245 650 495 445 495" /><path d="M345 458L345 285" /></svg>{flowNodes.map(({ id, label, note, Icon }) => <button type="button" key={id} className={`flow-node flow-${id} ${selected === id ? "active" : ""}`} onClick={() => setSelected(id)}><Icon size={17} /><span><strong>{label}</strong><small>{note}</small></span></button>)}</div>
    <div className="card flow-detail"><SelectedIcon size={18} /><strong>{item.label}:</strong><span>{item.note}. Select another node to inspect the boundary.</span></div></>;
}

function HealthView({ snapshot,gateway }: { snapshot: ControlCentreSnapshot;gateway:ControlCentreGateway }) {
  const [running,setRunning]=useState(false),[result,setResult]=useState<string>("");
  async function verify(){setRunning(true);setResult("");try{const run=await gateway.runVerification("workspace-demo","full_blob");setResult(`${run.status.toUpperCase()} · ${run.objectsChecked.toLocaleString()} objects · ${formatBytes(run.bytesRead)} streamed · ${run.issues.length} issues`);}catch(error){setResult(error instanceof Error?error.message:"Verification failed.");}finally{setRunning(false);}}
  return <><PageHeading title="System health" subtitle="Storage, backup, integrity and synchronisation across every adapter." action={<button className="button" disabled={running} onClick={()=>void verify()}>{running?"Verifying bytes…":"Run full verification"}</button>} />{result&&<div className="status-notice" role="status"><ShieldCheck size={17}/>{result}</div>}<div className="metrics"><Metric label="Canonical objects" value={`${snapshot.status.canonicalIntegrityPercent}%`} note="Hashes verified" /><Metric label="Backup coverage" value="128/128" note="No dataset unprotected" /><Metric label="Sync queue" value={String(snapshot.status.syncQueue)} note="WeSketch revision pending" /></div><div className="two-columns"><article className="card panel"><h2>Storage adapters</h2>{[["S3 Australia", 96], ["Cloud continuity", 89], ["Glacier archive", 100]].map(([name, value]) => <div className="adapter" key={String(name)}><div><strong>{name}</strong><span className="verified"><i />Operational</span></div><div><span style={{ width: `${value}%` }} /></div></div>)}</article><article className="card panel"><h2>Items requiring attention</h2><div className="attention"><HardDrive size={18} /><div><strong>WeSketch revision awaiting upload</strong><small>Device last seen 23 minutes ago</small></div><span className="badge">Low</span></div><div className="attention"><KeyRound size={18} /><div><strong>Two archive keys due for rotation</strong><small>Scheduled in 12 days</small></div><span className="badge">Planned</span></div></article></div></>;
}
function formatBytes(value:number):string{if(value<1024)return`${value} B`;const units=["KB","MB","GB","TB"];let size=value/1024,index=0;while(size>=1024&&index<units.length-1){size/=1024;index+=1;}return`${size.toFixed(1)} ${units[index]}`;}

function HistoryView({gateway}:{gateway:ControlCentreGateway}) {
  const [history, setHistory] = useState<HistorySnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [signIn,setSignIn]=useState(false); const [token,setToken]=useState(""); const [authError,setAuthError]=useState("");
  const load=()=>gateway.getHistory("workspace-demo").then(value=>{setHistory(value);setSignIn(false);}).catch(error=>{if(error instanceof GatewayError&&error.status===401)setSignIn(true);else setAuthError(error instanceof Error?error.message:"History unavailable.");});
  useEffect(() => { void load(); }, [gateway]);
  async function authenticate(event:FormEvent){event.preventDefault();setAuthError("");try{await gateway.startAdminSession(token);setToken("");await load();}catch(error){setAuthError(error instanceof Error?error.message:"Sign-in failed.");}}
  async function restore(resourceId:string) { setPending(resourceId); setNotice(""); try { const result=await gateway.restoreResource("workspace-demo",resourceId); setHistory(await gateway.getHistory("workspace-demo")); setNotice(`Restored safely as revision ${result.revisionNumber}. The prior state remains preserved.`); } catch(error) { if(error instanceof GatewayError&&error.status===401)setSignIn(true);setNotice(error instanceof Error?error.message:"Restore failed."); } finally { setPending(null); } }
  if(signIn)return <><PageHeading title="History and recovery" subtitle="Privileged recovery actions require an administrator session."/><form className="card sign-in-card" onSubmit={event=>void authenticate(event)}><KeyRound size={24}/><h2>Administrator sign-in</h2><p>The bootstrap token is exchanged for a short-lived, HTTP-only session and is not saved by the Control Centre.</p><label>Administrator token<input type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} required/></label>{authError&&<div className="form-error" role="alert">{authError}</div>}<button className="button primary" type="submit">Open protected history</button></form></>;
  if(authError)return <div className="status-notice error" role="alert">{authError}</div>;
  if (!history) return <div className="loading">Loading protected history…</div>;
  return <><PageHeading title="History and recovery" subtitle="Immutable changes, deleted items and verified restoration points." action={<button className="button">Export audit</button>} />
    {notice && <div className="status-notice" role="status"><CircleCheckBig size={17}/>{notice}</div>}
    <article className="card recovery-banner"><div><strong>{history.recoverable.length} recoverable items</strong><small>Restoring creates a new revision; it never overwrites previous history.</small></div><span className="badge">90-day retention</span></article>
    <div className="two-columns history-columns"><article className="card panel"><h2>Recovery bin</h2>{history.recoverable.length===0?<div className="empty-state"><Archive size={22}/><strong>Recovery bin is clear</strong><small>No deleted items await action.</small></div>:history.recoverable.map(item=><div className="recovery-row" key={item.tombstoneId}><span><Trash2 size={16}/></span><div><strong>{item.resourceTitle??item.resourceId}</strong><small>{item.resourceType} · deleted by {item.deletedBy}<br/>Recover until {item.recoverUntil?new Date(item.recoverUntil).toLocaleDateString():"policy review"}</small></div><button className="button primary" disabled={pending===item.resourceId} onClick={()=>void restore(item.resourceId)}>{pending===item.resourceId?"Restoring…":"Restore"}</button></div>)}</article>
      <article className="card panel"><h2>Recent trust events</h2>{history.events.map(event=>{const Icon=event.action.includes("delete")?Trash2:event.action.includes("backup")?BadgeCheck:History;return <div className="timeline" key={event.id}><span><Icon size={16}/></span><div><strong>{event.action.replaceAll("."," ")}</strong><small>{event.subjectId} · {event.actorId}</small></div><time>{new Date(event.occurredAt).toLocaleDateString()}</time></div>;})}</article></div></>;
}

function AccessView() {
  const roles = [["BR", "Ben", "Foundation Studio", "Workspace admin"], ["SO", "Storage operations", "Service identity", "Infrastructure only"], ["RV", "Recovery verifier", "Service identity", "Restore validation"], ["IS", "Ivan’s trusted supporter", "Personal archive only", "Recovery assistance"]];
  return <><PageHeading title="Access control" subtitle="Administer infrastructure without automatically reading private content." action={<button className="button">+ Add administrator</button>} /><div className="metrics"><Metric label="Active administrators" value="5" note="Across separated duties" /><Metric label="Privileged sessions" value="0" note="No content access active" /><Metric label="Policy exceptions" value="0" note="Least privilege maintained" /></div><article className="card panel"><h2>Administrative roles</h2>{roles.map(([initials, name, note, role]) => <div className="role-row" key={name}><span className="avatar">{initials}</span><div><strong>{name}</strong><small>{note}</small></div><span>{role}</span><button className="text-button">Review <ChevronRight size={14} /></button></div>)}</article></>;
}

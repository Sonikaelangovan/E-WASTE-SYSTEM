const state = { user:null, categories:[], centers:[], pickups:[], users:[], dashboard:null, view:'overview', homeMarkup:'' };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nice = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
const day = (value) => value ? new Date(value.includes('T') ? value : value.replace(' ','T') + 'Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
const pill = (status) => `<span class="pill ${esc(status)}">${esc(nice(status))}</span>`;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', ...options,
    headers: options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function toast(message, error = false) {
  const box = $('#toast'); box.textContent = message; box.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.className = 'toast', 4200);
}
function openModal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
  $('#modal-panel, #modal input, #modal button')?.focus?.();
}
function closeModal() {
  $('#modal').classList.add('hidden'); $('#modal').setAttribute('aria-hidden','true');
  $('#modal-content').innerHTML = ''; document.body.style.overflow = '';
}
function field(label, name, type = 'text', options = '') {
  return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><input id="f-${esc(name)}" name="${esc(name)}" type="${esc(type)}" ${options} required></div>`;
}
function authModal(mode = 'login') {
  if (mode === 'register') return openModal(`<span class="kicker">JOIN THE CIRCULAR ECONOMY</span><h2>Create your account.</h2><p>Register to request pickups and see the full history of your e-waste.</p><form id="register-form"><div class="form-grid">${field('Full name','name','text','minlength="2" autocomplete="name"')}${field('Email address','email','email','autocomplete="email"')}${field('Password (12+ characters)','password','password','minlength="12" autocomplete="new-password"')}</div><div class="form-actions"><p>Already registered? <button class="link-button" type="button" data-action="login">Sign in</button></p><button class="button button-dark" type="submit">Create account ↗</button></div></form>`);
  openModal(`<span class="kicker">WELCOME BACK</span><h2>Sign in to EcoTrace.</h2><p>Access your pickup records, collection tasks or recycling workspace.</p><form id="login-form"><div class="form-grid">${field('Email address','email','email','autocomplete="email"')}${field('Password','password','password','autocomplete="current-password"')}</div><div class="form-actions"><p>New here? <button class="link-button" type="button" data-action="register">Create account</button></p><button class="button button-dark" type="submit">Sign in ↗</button></div></form>`);
}
function pickupModal() {
  if (!state.user) return authModal();
  if (state.user.role !== 'customer') return toast('Pickup booking is available for customer accounts.', true);
  const options = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  openModal(`<span class="kicker">SCHEDULE A COLLECTION</span><h2>What can we pick up?</h2><p>Provide a few details. You will receive a tracking code immediately after submitting.</p><form id="pickup-form"><div class="form-grid"><div class="field"><label for="f-category">Category</label><select id="f-category" name="categoryId" required><option value="">Select a category</option>${options}</select></div>${field('Item name','itemName','text','maxlength="100" placeholder="e.g. old laptop"')}${field('Quantity','quantity','number','min="1" max="100" value="1"')}${field('Estimated weight (kg)','estimatedWeightKg','number','min="0.1" max="1000" step="0.1" placeholder="2.5"')}<div class="field wide"><label for="f-address">Pickup address</label><textarea id="f-address" name="address" minlength="10" maxlength="300" required placeholder="House / street / city / PIN"></textarea></div>${field('Preferred date','preferredDate','date',`min="${new Date().toISOString().slice(0,10)}"`)}<div class="field wide"><label for="f-notes">Notes (optional)</label><textarea id="f-notes" name="notes" maxlength="500" placeholder="Access instructions or item details"></textarea></div></div><div class="form-actions"><p>No payment is collected in this demonstration.</p><button class="button button-dark" type="submit">Submit pickup request ↗</button></div></form>`);
}
function categoryIcon(icon) { return ({phone:'▯',laptop:'▤',appliance:'◫',battery:'▣',cable:'⌁',other:'♻'})[icon] || '▣'; }
function renderPublicData() {
  $('#category-grid').innerHTML = state.categories.map(c => `<article class="category-card"><div class="category-card-head"><span class="category-icon">${categoryIcon(c.icon)}</span><span>↗</span></div><div><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p></div></article>`).join('');
  $('#center-grid').innerHTML = state.centers.map(c => `<article class="center-card"><span class="center-icon">⌂</span><div><small>${esc(c.city.toUpperCase())} / COLLECTION NETWORK</small><h3>${esc(c.name)}</h3><p>${esc(c.address)}</p><p>${esc(c.phone)}</p></div></article>`).join('');
}
function setHeader() {
  $('#nav-account').textContent = state.user ? state.user.name : 'Sign in';
  $('#nav-primary').innerHTML = state.user ? 'My workspace <span aria-hidden="true">↗</span>' : 'Schedule a pickup <span aria-hidden="true">↗</span>';
  document.body.classList.toggle('work-mode', !!state.user);
}
function titleForRole() { return ({customer:'Your circular journey',collector:'Collection workspace',recycler:'Recycling workspace',admin:'Operations command center'})[state.user.role]; }
async function refreshWorkspace() {
  state.pickups = await api('/api/pickups');
  if (state.user.role === 'admin') {
    [state.dashboard,state.users] = await Promise.all([api('/api/admin/dashboard'),api('/api/admin/users')]);
  }
  renderWorkspace();
}
function showWorkspace() {
  setHeader();
  $('#home').innerHTML = `<div class="workspace"><div class="workspace-top"><div><span class="kicker">ECOTRACE PORTAL / ${esc(state.user.role.toUpperCase())}</span><h1>${esc(titleForRole())}</h1><p>Welcome back, ${esc(state.user.name)}. Every responsible action leaves a trace.</p></div><div class="user-badge"><strong>${esc(state.user.name)}</strong>${esc(state.user.email)}<br><button class="link-button" data-action="logout" type="button">Sign out</button></div></div><div class="workspace-layout"><aside class="workspace-sidebar" id="workspace-sidebar"></aside><div class="workspace-main" id="workspace-content"></div></div></div>`;
  refreshWorkspace().catch(e => toast(e.message,true));
}
function showHome() {
  state.user = null; state.pickups=[]; state.users=[]; state.dashboard=null;
  $('#home').innerHTML = state.homeMarkup;
  setHeader(); renderPublicData(); window.scrollTo({top:0,behavior:'smooth'});
}
function sideViews() {
  const common = [['overview','⌂ Overview'],['pickups','▤ Pickups'],['track','◎ Track a code']];
  if (state.user.role === 'customer') common.splice(2,0,['schedule','＋ New pickup']);
  if (state.user.role === 'admin') common.push(['people','♧ Team'],['audit','≡ Audit log']);
  common.push(['centers','↗ Centers']);
  return common;
}
function renderWorkspace() {
  $('#workspace-sidebar').innerHTML = sideViews().map(([key,label]) => `<button type="button" data-view="${key}" class="${state.view===key?'active':''}">${label}</button>`).join('');
  const content = $('#workspace-content');
  if (state.view === 'overview') return content.innerHTML = overviewView();
  if (state.view === 'pickups') return content.innerHTML = pickupsView();
  if (state.view === 'schedule') return pickupModal();
  if (state.view === 'track') return content.innerHTML = trackView();
  if (state.view === 'centers') return content.innerHTML = centersView();
  if (state.view === 'people') return content.innerHTML = peopleView();
  if (state.view === 'audit') return loadAudit();
}
function metrics() {
  if (state.user.role === 'admin' && state.dashboard) {
    const s = state.dashboard.summary;
    return [['Total requests',s.total || 0,'ALL TIME'],['Awaiting collection',s.awaiting_collection || 0,'ACTIVE QUEUE'],['In processing',s.processing || 0,'COLLECTION TO CENTER'],['Recycled weight',`${s.recycled_kg || 0} kg`,'VERIFIED PROCESSING']];
  }
  const total=state.pickups.length, active=state.pickups.filter(p=>!['recycled','cancelled'].includes(p.status)).length;
  return [['Total requests',total,'YOUR RECORDS'],['In progress',active,'ACTIVE JOURNEYS'],['Recycled',state.pickups.filter(p=>p.status==='recycled').length,'CLOSED LOOP'],['Awaiting action',state.pickups.filter(p=>state.user.role==='collector' ? ['assigned','accepted'].includes(p.status) : state.user.role==='recycler' ? ['collected','received'].includes(p.status) : p.status==='requested').length,'NEXT STEPS']];
}
function overviewView() {
  const rows=metrics().map(([label,value,sub])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('');
  const counts=state.user.role==='admin' ? state.dashboard.byStatus : Object.entries(state.pickups.reduce((x,p)=>(x[p.status]=(x[p.status]||0)+1,x),{})).map(([status,count])=>({status,count}));
  const max=Math.max(1,...counts.map(x=>x.count));
  return `<div class="work-heading"><div><h2>Overview</h2><p>One clear view of your e-waste journey.</p></div>${state.user.role==='customer'?'<button class="button button-dark" data-action="book" type="button">＋ Schedule pickup</button>':''}</div><div class="dashboard-hero"><div><h3>Every device has a next chapter.</h3><p>Keep the loop moving with traceable, recorded handoffs.</p></div><button class="button" data-view="pickups" type="button">View requests ↗</button></div><div class="metric-grid">${rows}</div><div class="panel"><h3>Recent pickups</h3>${pickupTable(state.pickups.slice(0,5))}</div><div class="panel"><h3>Status snapshot</h3><div class="status-bars">${counts.length?counts.map(x=>`<div class="status-line"><span>${esc(nice(x.status))}</span><div class="bar"><i style="width:${Math.round(x.count/max*100)}%"></i></div><strong>${x.count}</strong></div>`).join(''):'<p class="empty-state">No requests yet. New journeys will appear here.</p>'}</div></div>`;
}
function pickupTable(items) {
  if (!items.length) return `<div class="empty-state"><span>♻</span>No pickup requests yet.${state.user.role==='customer'?'<br><button class="link-button" data-action="book" type="button">Schedule your first pickup</button>':''}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Tracking code</th><th>Item</th><th>Status</th><th>Preferred</th><th></th></tr></thead><tbody>${items.map(p=>`<tr><td><strong>${esc(p.tracking_code)}</strong><small>${esc(p.category)}</small></td><td><strong>${esc(p.item_name)}</strong><small>${esc(p.quantity)} item(s) · ${esc(p.estimated_weight_kg)} kg est.</small></td><td>${pill(p.status)}</td><td>${esc(day(p.preferred_date))}</td><td><button class="row-button" data-action="detail" data-id="${p.id}" type="button">Details ↗</button></td></tr>`).join('')}</tbody></table></div>`;
}
function pickupsView() { return `<div class="work-heading"><div><h2>${state.user.role==='admin'?'All pickup requests':'My pickups'}</h2><p>${state.pickups.length} request(s) in your ${state.user.role==='recycler'?'processing queue':'workspace'}.</p></div>${state.user.role==='customer'?'<button class="button button-dark" data-action="book" type="button">＋ Schedule pickup</button>':''}</div><div class="panel">${pickupTable(state.pickups)}</div>`; }
function trackView() { return `<div class="work-heading"><div><h2>Track a code</h2><p>Public status, without private customer details.</p></div></div><div class="panel"><form id="track-form" class="track-form"><label for="track-code">ECOTRACE CODE</label><div><input id="track-code" name="code" placeholder="EWT-2026-XXXXXXXX" required><button class="button button-lime" type="submit">Track now →</button></div></form><div id="track-result"></div></div>`; }
function centersView() { return `<div class="work-heading"><div><h2>Collection network</h2><p>Demonstration hubs and recycling centers.</p></div></div><div class="center-grid">${state.centers.map(c=>`<article class="center-card"><span class="center-icon">⌂</span><div><small>${esc(c.city.toUpperCase())} / ACTIVE CENTER</small><h3>${esc(c.name)}</h3><p>${esc(c.address)}</p><p>${esc(c.phone)}</p></div></article>`).join('')}</div>`; }
function peopleView() {
  if (state.user.role!=='admin') return '';
  return `<div class="work-heading"><div><h2>People & roles</h2><p>Collectors and recyclers can be provisioned by an administrator.</p></div><button class="button button-dark" data-action="new-staff" type="button">＋ Add team member</button></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>${state.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${pill(u.role)}</td><td>${esc(day(u.created_at))}</td></tr>`).join('')}</tbody></table></div></div>`;
}
async function loadAudit() {
  const target=$('#workspace-content'); target.innerHTML='<div class="panel">Loading audit events…</div>';
  try { const rows=await api('/api/admin/audit'); target.innerHTML=`<div class="work-heading"><div><h2>Audit log</h2><p>Recent changes recorded with actor and time.</p></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Action</th><th>Actor</th><th>Record</th><th>Time</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.actor_name||'System')}</td><td>${esc(a.entity_type)} #${esc(a.entity_id)}</td><td>${esc(day(a.created_at))}</td></tr>`).join('')}</tbody></table></div></div>`; } catch(e){toast(e.message,true);}
}
function detailCell(label,value) { return `<div><small>${esc(label)}</small><strong>${esc(value ?? '—')}</strong></div>`; }
async function showDetail(id) {
  const p=await api(`/api/pickups/${id}`);
  let actions='';
  if (state.user.role==='customer' && p.status==='requested') actions=`<button class="button button-outline" data-action="cancel-pickup" data-id="${p.id}" type="button">Cancel request</button>`;
  if (state.user.role==='admin' && ['requested','assigned'].includes(p.status)) actions=`<form id="assign-form" data-id="${p.id}" class="modal-actions"><select name="collectorId" required><option value="">Choose collector</option>${state.users.filter(u=>u.role==='collector').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select><button class="button button-dark" type="submit">Assign collector ↗</button></form>`;
  if (state.user.role==='collector' && ['assigned','accepted'].includes(p.status)) actions=`<button class="button button-dark" data-action="collector-next" data-id="${p.id}" data-status="${p.status==='assigned'?'accepted':'collected'}" type="button">Mark ${p.status==='assigned'?'accepted':'collected'} ↗</button>`;
  if (state.user.role==='recycler' && p.status==='collected') actions=`<form id="receive-form" data-id="${p.id}" class="modal-actions"><select name="centerId" required><option value="">Choose center</option>${state.centers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="button button-dark" type="submit">Record arrival ↗</button></form>`;
  if (state.user.role==='recycler' && p.status==='received' && p.recycler_id===state.user.id) actions=`<form id="recycle-form" data-id="${p.id}" class="modal-actions"><input type="hidden" name="centerId" value="${p.center_id}"><input type="number" name="actualWeightKg" min="0.1" max="1000" step="0.1" placeholder="Actual weight kg" required><input type="text" name="method" maxlength="120" placeholder="Recycling method" required><button class="button button-dark" type="submit">Complete recycling ↗</button></form>`;
  openModal(`<span class="kicker">CHAIN OF CUSTODY</span><div class="detail-head"><div><h2>${esc(p.item_name)}</h2><span class="detail-code">${esc(p.tracking_code)}</span></div>${pill(p.status)}</div><div class="details-grid">${detailCell('Category',p.category)}${detailCell('Items',p.quantity)}${detailCell('Est. weight',`${p.estimated_weight_kg} kg`)}${detailCell('Actual weight',p.actual_weight_kg?`${p.actual_weight_kg} kg`:'Pending')}${detailCell('Preferred date',day(p.preferred_date))}${detailCell('Center',p.center_name)}${detailCell('Customer',p.customer_name)}${detailCell('Collector',p.collector_name)}${detailCell('Pickup address',p.address)}${detailCell('Notes',p.notes||'None')}</div>${p.certificate_no?`<div class="notice"><strong>Recycling record issued:</strong> ${esc(p.certificate_no)}<br>Method: ${esc(p.recycling_method)} · ${esc(day(p.issued_at))}. This is a project demonstration record, not a statutory certificate.</div>`:''}<h3>Traceability timeline</h3><div class="timeline">${p.timeline.map(t=>`<div class="timeline-item"><strong>${esc(nice(t.status))}</strong><small>${esc(day(t.created_at))} · ${esc(t.actor_name||'System')}</small><p>${esc(t.note)}</p></div>`).join('')}</div>${actions?`<div class="modal-actions">${actions}</div>`:''}`);
}
function staffModal(){openModal(`<span class="kicker">TEAM MANAGEMENT</span><h2>Add a team member.</h2><p>Only administrators can create collector and recycler accounts.</p><form id="staff-form"><div class="form-grid">${field('Full name','name','text','minlength="2"')}${field('Email','email','email')}${field('Temporary password (12+)','password','password','minlength="12"')}<div class="field"><label for="f-role">Role</label><select id="f-role" name="role" required><option value="collector">Collector</option><option value="recycler">Recycler</option></select></div></div><div class="form-actions"><p>Share the password privately with the team member.</p><button class="button button-dark" type="submit">Create account ↗</button></div></form>`);}
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
async function handleSubmit(event) {
  const form=event.target; if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault(); const input=formObject(form); const button=form.querySelector('[type="submit"]');
  if(button) button.disabled=true;
  try {
    if(form.id==='login-form') { const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify(input)}); state.user=result.user; state.view='overview'; closeModal(); showWorkspace(); toast(`Welcome, ${result.user.name}.`); }
    if(form.id==='register-form') { await api('/api/auth/register',{method:'POST',body:JSON.stringify(input)}); authModal('login'); toast('Account created. Please sign in.'); }
    if(form.id==='pickup-form') { const result=await api('/api/pickups',{method:'POST',body:JSON.stringify(input)}); closeModal(); state.view='pickups'; await refreshWorkspace(); toast(`Request created: ${result.tracking_code}`); await showDetail(result.id); }
    if(form.id==='track-form') { const result=await api(`/api/track?code=${encodeURIComponent(input.code.trim())}`); const target=$('#track-result'); const html=`<div class="public-result"><span class="kicker">TRACKING ${esc(result.tracking_code)}</span><h3>${esc(result.item_name)}</h3>${pill(result.status)}<p>${esc(result.category)} · ${esc(result.quantity)} item(s) · ${esc(result.actual_weight_kg||result.estimated_weight_kg)} kg</p>${result.certificate_no?`<p>Recycling record: <strong>${esc(result.certificate_no)}</strong></p>`:''}<div class="timeline">${result.timeline.map(t=>`<div class="timeline-item"><strong>${esc(nice(t.status))}</strong><small>${esc(day(t.created_at))}</small></div>`).join('')}</div></div>`; if(target) target.innerHTML=html; else openModal(`<span class="kicker">PUBLIC TRACE</span><h2>Journey found.</h2>${html}`); }
    if(form.id==='assign-form') { const id=form.dataset.id; await api(`/api/admin/pickups/${id}/assign`,{method:'PATCH',body:JSON.stringify(input)}); closeModal(); await refreshWorkspace(); toast('Collector assigned.'); }
    if(form.id==='receive-form') { const id=form.dataset.id; await api(`/api/recycler/pickups/${id}/status`,{method:'PATCH',body:JSON.stringify({...input,status:'received'})}); closeModal(); await refreshWorkspace(); toast('Center arrival recorded.'); }
    if(form.id==='recycle-form') { const id=form.dataset.id; await api(`/api/recycler/pickups/${id}/status`,{method:'PATCH',body:JSON.stringify({...input,status:'recycled'})}); closeModal(); await refreshWorkspace(); toast('Recycling recorded; certificate number issued.'); }
    if(form.id==='staff-form') { await api('/api/admin/users',{method:'POST',body:JSON.stringify(input)}); closeModal(); await refreshWorkspace(); toast('Team member created.'); }
  } catch(error) { toast(error.message,true); } finally { if(button) button.disabled=false; }
}
async function handleClick(event) {
  const button=event.target.closest('button'); if(!button) return;
  if(button.dataset.close) return closeModal();
  if(button.id==='menu-toggle'){ const menu=$('.main-nav'); menu.classList.toggle('open'); button.setAttribute('aria-expanded',menu.classList.contains('open')); return; }
  if(button.id==='nav-account'){ if(state.user) return showWorkspace(); return authModal(); }
  if(['nav-primary','hero-book','closing-book'].includes(button.id)) return state.user ? (state.user.role==='customer'?pickupModal():showWorkspace()) : pickupModal();
  const action=button.dataset.action;
  if(action==='login'||action==='register') return authModal(action);
  if(action==='book') return pickupModal();
  if(action==='new-staff') return staffModal();
  if(action==='logout') { try{await api('/api/auth/logout',{method:'POST'});closeModal();showHome();toast('Signed out.');}catch(e){toast(e.message,true);} return; }
  if(action==='detail') return showDetail(button.dataset.id).catch(e=>toast(e.message,true));
  if(action==='cancel-pickup'){try{await api(`/api/pickups/${button.dataset.id}`,{method:'DELETE'});closeModal();await refreshWorkspace();toast('Pickup cancelled.');}catch(e){toast(e.message,true);}return;}
  if(action==='collector-next'){try{await api(`/api/collector/pickups/${button.dataset.id}/status`,{method:'PATCH',body:JSON.stringify({status:button.dataset.status})});closeModal();await refreshWorkspace();toast('Collection status updated.');}catch(e){toast(e.message,true);}return;}
  if(button.dataset.view){state.view=button.dataset.view;renderWorkspace();}
}
async function init() {
  state.homeMarkup=$('#home').innerHTML;
  $('#year').textContent=new Date().getFullYear();
  document.addEventListener('submit',handleSubmit);
  document.addEventListener('click',handleClick);
  document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});
  try {
    [state.categories,state.centers] = await Promise.all([api('/api/categories'),api('/api/centers')]);
    renderPublicData();
    const current=await api('/api/auth/me');
    if(current.user){state.user=current.user;showWorkspace();} else setHeader();
  } catch(error){toast(`Unable to load portal: ${error.message}`,true);}
}
init();

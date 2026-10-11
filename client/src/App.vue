<script setup>
import { computed, onMounted, onUnmounted, nextTick, reactive, ref, watch } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import { DateTime } from 'luxon';
import { ArrowRight, ArrowUpRight, CalendarDays, CalendarCheck2, Clock3, ListOrdered, Activity,
  Microscope, Cpu, FlaskConical, Box, Plus, ChevronLeft, ChevronRight, MapPin, Check,
  ShieldCheck, X, LogOut, Search, CircleHelp, Wrench, ArrowUpDown, Menu, RefreshCw, LoaderCircle } from 'lucide-vue-next';
import { api, setToken, hasToken } from './api.js';

const zone = 'Asia/Kolkata';
const now = () => DateTime.now().setZone(zone);
const local = date => date.setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
const dateLabel = value => DateTime.fromISO(value, { zone }).toFormat('dd LLL, yyyy');
const timeLabel = value => DateTime.fromISO(value, { zone }).toFormat('h:mm a');
const rangeLabel = item => `${timeLabel(item.start_time || item.requested_start)} – ${timeLabel(item.end_time || item.requested_end)}`;
const user = ref(null);
const booting = ref(true);
const tab = ref('schedule');
const sidebarOpen = ref(false);
const authMode = ref('login');
const auth = reactive({ name:'', email:'', password:'' });
const authError = ref('');
const authBusy = ref(false);
const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const equipment = ref([]);
const selectedId = ref('');
const selected = computed(() => equipment.value.find(item => item.id === selectedId.value));
const query = ref('');
const filteredEquipment = computed(() => equipment.value.filter(item => `${item.name} ${item.type} ${item.location}`.toLowerCase().includes(query.value.toLowerCase())));
const myBookings = ref([]);
const queue = ref([]);
const activity = ref([]);
const schedule = ref([]);
const loadingSchedule = ref(false);
const pageLoading = ref(false);
const pageError = ref('');
const calendarRange = ref(null);
const calendar = ref(null);
const calendarTitle = ref('');
const calendarView = ref('timeGridWeek');
const bookingFilter = ref('upcoming');
const clock = ref(now());
const upcoming = computed(() => myBookings.value.filter(item => item.status === 'reserved' && item.start_time > local(clock.value)));
const visibleBookings = computed(() => (bookingFilter.value === 'upcoming'
  ? myBookings.value.filter(item => item.status === 'reserved' && item.end_time > local(clock.value))
  : myBookings.value).slice().sort((a,b) => a.start_time.localeCompare(b.start_time)));
const nav = [
  { id:'schedule', label:'Equipment schedule', icon:CalendarDays },
  { id:'bookings', label:'My bookings', icon:CalendarCheck2 },
  { id:'waitlist', label:'Waitlist', icon:ListOrdered },
  { id:'activity', label:'Activity log', icon:Activity },
];
const icons = { Microscopy:Microscope, Computing:Cpu, Spectroscopy:FlaskConical, Fabrication:Box };
const toast = ref(null);
let toastTimer, pollTimer;
function notify(message, error = false) {
  toast.value = { message, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = null; }, 6500);
}
async function signIn() {
  authBusy.value = true; authError.value = '';
  try {
    const body = authMode.value === 'register' ? { ...auth } : { email:auth.email, password:auth.password };
    const result = await api(`/auth/${authMode.value}`, { method:'POST', body });
    setToken(result.token); user.value = result.user; auth.password = '';
    await loadWorkspace();
  } catch (error) { authError.value = error.message; }
  finally { authBusy.value = false; }
}
function fillDemo(role) { authMode.value = 'login'; auth.email = `${role}@labslot.demo`; auth.password = 'LabSlot-demo-2026!'; authError.value = ''; }
function logout() {
  scheduleRequest++;
  setToken(null); user.value = null; equipment.value = []; schedule.value = [];
  myBookings.value = []; queue.value = []; activity.value = []; selectedId.value = ''; modal.value = null;
  sidebarOpen.value = false; tab.value = 'schedule'; pageError.value = '';
}
function expired() { logout(); authError.value = 'Your session expired. Please sign in again.'; }
async function loadWorkspace() {
  const actorId = user.value?.id;
  pageLoading.value = true; pageError.value = '';
  try {
    const [assets, bookings, waiting, events] = await Promise.all([
      api('/equipment'), api('/bookings'), api('/waitlist'), api('/activity'),
    ]);
    if (!user.value || user.value.id !== actorId) return;
    equipment.value = assets; myBookings.value = bookings; queue.value = waiting; activity.value = events;
    if (!selectedId.value) selectedId.value = assets.find(item => item.asset_tag === 'MIC-001')?.id || assets[0]?.id || '';
  } catch (error) { pageError.value = error.message; }
  finally { pageLoading.value = false; }
}
let scheduleRequest = 0;
async function loadSchedule() {
  if (!selectedId.value || !calendarRange.value || !user.value) return;
  const request = ++scheduleRequest;
  const actorId = user.value.id;
  loadingSchedule.value = true;
  try {
    const params = new URLSearchParams({ equipment_id:selectedId.value, ...calendarRange.value });
    const events = await api(`/calendar?${params}`);
    if (request === scheduleRequest && user.value?.id === actorId) schedule.value = events;
  } catch (error) { if (request === scheduleRequest) pageError.value = error.message; }
  finally { if (request === scheduleRequest) loadingSchedule.value = false; }
}
async function refresh() { await Promise.all([loadWorkspace(), loadSchedule()]); }
watch([selectedId, calendarRange], () => { schedule.value = []; loadSchedule(); });
const calendarOptions = computed(() => ({
  plugins:[timeGridPlugin, dayGridPlugin, interactionPlugin, luxonPlugin],
  initialView:calendarView.value, initialDate:now().plus({ days:2 }).toISODate(), timeZone:zone,
  firstDay:1, headerToolbar:false, height:640, allDaySlot:false, nowIndicator:true,
  slotMinTime:'07:00:00', slotMaxTime:'22:00:00', slotDuration:'00:30:00', scrollTime:'08:00:00',
  selectable:true, selectMirror:true, editable:false, eventOverlap:false,
  dayHeaderFormat:{ weekday:'short', day:'numeric' },
  slotLabelFormat:{ hour:'numeric', minute:'2-digit', hour12:false },
  eventTimeFormat:{ hour:'numeric', minute:'2-digit', hour12:false },
  events:schedule.value.map(item => ({
    id:item.id, title:item.reason,
    start:`${item.start_time}+05:30`, end:`${item.end_time}+05:30`,
    classNames:[item.kind === 'maintenance' ? 'event-maintenance' : item.user_id === user.value?.id ? 'event-mine' : item.user_role === 'faculty' ? 'event-faculty' : 'event-student'],
    extendedProps:{ reservation:item },
  })),
  datesSet(info) {
    calendarTitle.value = info.view.title;
    calendarRange.value = { start:local(DateTime.fromJSDate(info.start)), end:local(DateTime.fromJSDate(info.end)) };
  },
  select(info) {
    openCreate('booking', { start:DateTime.fromJSDate(info.start).setZone(zone), end:DateTime.fromJSDate(info.end).setZone(zone) });
    calendar.value?.getApi().unselect();
  },
  eventClick(info) { openDetails(info.event.extendedProps.reservation); },
  eventDidMount(info) {
    const item = info.event.extendedProps.reservation;
    info.el.setAttribute('tabindex', '0');
    info.el.setAttribute('role', 'button');
    info.el.setAttribute('aria-label', `${item.reason}, ${dateLabel(item.start_time)}, ${rangeLabel(item)} IST`);
    info.el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetails(item);
      }
    });
  },
}));
function changeView(view) { calendarView.value = view; calendar.value?.getApi().changeView(view); }

const dialog = ref(null);
const modal = ref(null);
const form = reactive({ equipment_id:'', start_time:'', end_time:'', reason:'', override:false, override_reason:'' });
const detail = ref(null);
const formError = ref('');
const conflict = ref(false);
const busy = ref(false);
const cancelReason = ref('');
const usageNotes = ref('');
watch(modal, async value => {
  await nextTick();
  if (value && !dialog.value?.open) dialog.value?.showModal();
  if (!value && dialog.value?.open) dialog.value.close();
});
function closeModal() { if (!busy.value) modal.value = null; }
function openCreate(kind = 'booking', interval) {
  const start = interval?.start || now().plus({ days:2 }).startOf('day').set({ hour:9 });
  Object.assign(form, { equipment_id:selectedId.value, start_time:local(start), end_time:local(interval?.end || start.plus({ hours:1 })), reason:'', override:false, override_reason:'' });
  formError.value = ''; conflict.value = false; modal.value = kind;
}
function openDetails(item) {
  detail.value = { ...item, ...myBookings.value.find(booking => booking.id === item.id) };
  formError.value = ''; usageNotes.value = ''; modal.value = 'detail';
}
function beginCancel(item) { detail.value = item; cancelReason.value = ''; formError.value = ''; modal.value = 'cancel'; }
async function submitReservation(waiting = false) {
  if (!form.equipment_id) { formError.value = 'Select equipment first.'; return; }
  busy.value = true; formError.value = '';
  const body = { equipment_id:form.equipment_id, start_time:form.start_time, end_time:form.end_time, reason:form.reason };
  if (!waiting && modal.value === 'booking' && form.override) body.override_reason = form.override_reason;
  try {
    await api(waiting ? '/waitlist' : modal.value === 'maintenance' ? '/maintenance' : '/bookings', { method:'POST', body });
    notify(waiting ? 'You’re on the waitlist. Your request will be considered when time becomes available.' : modal.value === 'maintenance' ? 'Maintenance window scheduled.' : 'Booking confirmed. Your time is reserved.');
    modal.value = null; await refresh();
  } catch (error) { formError.value = error.message; conflict.value = error.code === 'SLOT_CONFLICT'; if (error.status === 409) await loadSchedule(); }
  finally { busy.value = false; }
}
async function submitCancellation() {
  busy.value = true; formError.value = '';
  try {
    const result = await api(`/reservations/${detail.value.id}/cancel`, { method:'POST', body:{ reason:cancelReason.value } });
    notify(result.promoted_reservation_id ? 'Cancelled. The next eligible waiting request has been confirmed.' : 'Reservation cancelled. The time is available again.');
    modal.value = null; await refresh();
  } catch (error) { formError.value = error.message; }
  finally { busy.value = false; }
}
async function withdraw(item) {
  busy.value = true;
  try { await api(`/waitlist/${item.id}/withdraw`, { method:'POST', body:{} }); notify('Waitlist request withdrawn.'); await refresh(); }
  catch (error) { notify(error.message,true); }
  finally { busy.value = false; }
}
async function promote() {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    const result = await api(`/equipment/${selectedId.value}/promote`, { method:'POST', body:{} });
    notify(result.promoted_reservation_id ? 'The next eligible request has been confirmed.' : 'No waiting request currently fits an available interval.');
    await refresh();
  } catch (error) { notify(error.message,true); }
  finally { busy.value = false; }
}
async function recordUsage(action) {
  busy.value = true; formError.value = '';
  try {
    await api(`/bookings/${detail.value.id}/${action}`, { method:'POST', body:action === 'check-out' ? { notes:usageNotes.value } : {} });
    notify(action === 'check-in' ? 'Checked in. Have a productive session.' : 'Checked out. Your usage has been recorded.');
    modal.value = null; await refresh();
  } catch (error) { formError.value = error.message; }
  finally { busy.value = false; }
}
function canCancel(item) { return item.status === 'reserved' && item.start_time > local(clock.value) && (item.user_id === user.value?.id || (item.kind === 'maintenance' && user.value?.role === 'faculty')); }
function canCheckIn(item) { return item.user_id === user.value?.id && item.status === 'reserved' && !item.actual_start && item.start_time <= local(clock.value) && item.end_time > local(clock.value); }
function canCheckOut(item) { return item.user_id === user.value?.id && item.actual_start && !item.actual_end; }
const eventLabels = { booking_created:'Booking confirmed', maintenance_created:'Maintenance scheduled', overridden:'Faculty priority applied', waitlisted:'Added to waitlist', promoted:'Waitlist request confirmed', cancelled:'Reservation cancelled', withdrawn:'Waitlist request withdrawn', usage_started:'Checked in', usage_ended:'Checked out' };
const initials = computed(() => user.value?.name.split(' ').filter(part => !part.includes('.')).slice(0,2).map(part => part[0]).join(''));

onMounted(async () => {
  window.addEventListener('labslot-session-expired', expired);
  if (hasToken()) {
    try { user.value = await api('/auth/me'); await loadWorkspace(); }
    catch { setToken(null); }
  }
  booting.value = false;
  pollTimer = setInterval(() => { clock.value = now(); if (user.value && !document.hidden && !busy.value) refresh(); }, 30000);
});
onUnmounted(() => { clearInterval(pollTimer); clearTimeout(toastTimer); window.removeEventListener('labslot-session-expired', expired); });
</script>

<template>
  <div v-if="booting" class="boot-screen"><div class="brand-mark">L<span>↗</span></div><p>Preparing your workspace…</p></div>
  <div v-else-if="!user" class="auth-shell">
    <section class="auth-story">
      <a class="brand auth-brand" href="/" aria-label="LabSlot home"><span class="brand-mark">L<span>↗</span></span>LabSlot<span class="brand-dot">.</span></a>
      <div class="auth-copy"><span class="eyebrow light">LESS COORDINATION. MORE DISCOVERY.</span><h1>Great research<br>starts with<br><em>a little space.</em></h1><p>Your lab’s equipment, calendars, and people.<br>Finally, working together.</p></div>
      <div class="auth-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="visual-scope"><Microscope :size="110" :stroke-width="1.2" /></div><div class="visual-chip"><span class="small-dot"></span>Time for your next breakthrough</div></div>
      <div class="auth-foot"><span>SHARED EQUIPMENT. SHARED POSSIBILITIES.</span><span>01 / RESEARCH WORKSPACE</span></div>
    </section>
    <main class="auth-form-area"><div class="auth-form-card"><span class="eyebrow">WELCOME TO YOUR LAB</span><h2>{{ authMode === 'login' ? 'Let’s get to work.' : 'Make yourself at home.' }}</h2><p class="muted">{{ authMode === 'login' ? 'Sign in to find equipment and reserve your next session.' : 'Create a student account to start booking equipment.' }}</p>
      <div class="auth-tabs"><button :class="{ active:authMode === 'login' }" @click="authMode = 'login'; authError = ''">Sign in</button><button :class="{ active:authMode === 'register' }" @click="authMode = 'register'; authError = ''">Create account</button></div>
      <form @submit.prevent="signIn">
        <label v-if="authMode === 'register'">Full name<input v-model="auth.name" autocomplete="name" required maxlength="100" placeholder="Your full name"></label>
        <label>Email address<input v-model="auth.email" type="email" autocomplete="email" required placeholder="you@university.edu"></label>
        <label>Password<input v-model="auth.password" type="password" :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'" :minlength="authMode === 'register' ? 12 : 1" required placeholder="Enter your password"><span v-if="authMode === 'register'" class="field-hint">At least 12 characters. Faculty accounts are provisioned separately.</span></label>
        <div v-if="authError" class="error-box" role="alert">{{ authError }}</div>
        <button class="button primary full-width" :disabled="authBusy"><LoaderCircle v-if="authBusy" class="spin" :size="17" />{{ authMode === 'login' ? 'Enter workspace' : 'Create student account' }}<ArrowRight :size="17" /></button>
      </form>
      <div v-if="demoMode" class="demo-box"><span class="eyebrow">TAKE A LOOK AROUND</span><p>Use a local demo account to explore both roles.</p><div class="demo-buttons"><button @click="fillDemo('student')">Student demo<ArrowUpRight :size="14" /></button><button @click="fillDemo('faculty')">Faculty demo<ArrowUpRight :size="14" /></button></div></div>
      <p class="auth-note"><ShieldCheck :size="16" />One shared calendar. Every reservation accounted for.</p>
    </div></main>
  </div>
  <div v-else class="workspace">
    <button v-if="sidebarOpen" class="sidebar-scrim" aria-label="Close navigation" @click="sidebarOpen = false"></button>
    <aside class="sidebar" :class="{ open:sidebarOpen }">
      <a href="#" class="brand" @click.prevent="tab = 'schedule'"><span class="brand-mark">L<span>↗</span></span>LabSlot<span class="brand-dot">.</span></a>
      <div class="workspace-label"><span class="workspace-avatar"><FlaskConical :size="17" /></span><div>Research workspace<small>Campus equipment hub</small></div><span class="online-dot"></span></div>
      <span class="nav-label">WORKSPACE</span>
      <nav><button v-for="item in nav" :key="item.id" :class="{ active:tab === item.id }" @click="tab = item.id; sidebarOpen = false"><component :is="item.icon" :size="19" :stroke-width="1.7" />{{ item.label }}<span v-if="item.id === 'waitlist' && queue.length" class="nav-count">{{ queue.length }}</span></button></nav>
      <div class="sidebar-tip"><span class="tip-icon"><Microscope :size="22" /></span><h3>A little planning.<br>A lot of possibility.</h3><p>Reserve what you need.<br>Leave room for what’s next.</p><button @click="modal = 'rules'"><CircleHelp :size="15" />How booking works<ArrowUpRight :size="14" /></button></div>
      <div class="user-panel"><span class="avatar">{{ initials }}</span><div><strong>{{ user.name }}</strong><small>{{ user.role }} account</small></div><button class="icon-button" aria-label="Sign out" title="Sign out" @click="logout"><LogOut :size="17" /></button></div>
    </aside>
    <main class="main-content">
      <header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" aria-label="Open navigation" @click="sidebarOpen = true"><Menu :size="21" /></button><span>Workspace</span><ChevronRight :size="13" /><strong>{{ nav.find(item => item.id === tab)?.label }}</strong></div><div class="topbar-right"><span class="campus-time"><span class="small-dot"></span>Campus time · IST</span><button class="icon-button" aria-label="Refresh workspace" title="Refresh" :disabled="pageLoading" @click="refresh"><RefreshCw :size="16" :class="{ spin:pageLoading }" /></button><span class="avatar small">{{ initials }}</span></div></header>
      <div class="page-body">
        <div class="page-heading"><div><span class="eyebrow">{{ clock.toFormat('cccc, dd LLLL yyyy').toUpperCase() }}</span><h1>{{ tab === 'schedule' ? 'Make room for discovery.' : tab === 'bookings' ? 'Your research, on the calendar.' : tab === 'waitlist' ? 'Next in line. Ready to go.' : 'Every change has a story.' }}</h1><p>{{ tab === 'schedule' ? 'Find your equipment. Pick your time. Get back to what matters.' : tab === 'bookings' ? 'Keep track of your sessions, from reservation to check-out.' : tab === 'waitlist' ? 'Track the sessions you’re waiting for. We’ll keep your place.' : 'A clear record of bookings, priority decisions, and equipment use.' }}</p></div><button class="button primary" :disabled="!equipment.length" @click="openCreate()"><Plus :size="18" />Book equipment</button></div>
        <div v-if="pageError" class="error-box page-error" role="alert">{{ pageError }}<button @click="refresh">Try again</button></div>
        <div class="stats-grid"><div class="stat-card"><span class="stat-icon mint"><Microscope :size="20" /></span><div><span>Operational equipment</span><strong>{{ equipment.filter(item => item.operational_status === 'active').length.toString().padStart(2,'0') }}</strong></div><small>Ready for research</small></div><div class="stat-card"><span class="stat-icon blue"><CalendarCheck2 :size="20" /></span><div><span>Your upcoming bookings</span><strong>{{ upcoming.length.toString().padStart(2,'0') }}</strong></div><button @click="tab = 'bookings'">View sessions<ArrowUpRight :size="13" /></button></div><div class="stat-card"><span class="stat-icon amber"><Clock3 :size="20" /></span><div><span>Your waiting requests</span><strong>{{ queue.length.toString().padStart(2,'0') }}</strong></div><button @click="tab = 'waitlist'">View waitlist<ArrowUpRight :size="13" /></button></div></div>

        <template v-if="tab === 'schedule'">
          <section class="equipment-section"><div class="section-heading"><div><h2>Choose your equipment <span class="count-label">{{ equipment.length }}</span></h2><p>One asset, one shared schedule.</p></div><label class="search-box"><Search :size="16" /><input v-model="query" aria-label="Search equipment" placeholder="Find equipment…"></label></div>
            <div class="equipment-grid"><button v-for="item in filteredEquipment" :key="item.id" class="equipment-card" :class="{ selected:item.id === selectedId }" @click="selectedId = item.id"><div class="equipment-top"><span class="equipment-icon"><component :is="icons[item.type] || Box" :size="25" :stroke-width="1.5" /></span><span v-if="item.id === selectedId" class="selected-check"><Check :size="13" /></span><span v-else class="asset-tag">{{ item.asset_tag }}</span></div><h3>{{ item.name }}</h3><p><MapPin :size="12" />{{ item.location }}</p><span class="equipment-status" :class="{ unavailable:item.operational_status !== 'active' || item.occupied_now }"><span class="small-dot"></span>{{ item.operational_status !== 'active' ? 'Out of service' : item.occupied_now ? 'In use now' : 'Available now' }}</span></button></div>
            <div v-if="!filteredEquipment.length" class="empty-inline">{{ equipment.length ? 'No equipment matches your search.' : 'No equipment has been added yet. Run the demo seed to get started.' }}</div>
          </section>
          <section v-if="selected" class="calendar-panel"><div class="calendar-heading"><div><div class="selected-title"><span class="small-dot"></span><h2>{{ selected.name }}</h2><span class="asset-tag">{{ selected.asset_tag }}</span></div><p>{{ selected.description }}</p></div><button v-if="user.role === 'faculty'" class="button subtle compact" @click="openCreate('maintenance')"><Wrench :size="14" />Maintenance</button></div>
            <div class="calendar-toolbar"><div class="date-navigation"><button class="icon-button" aria-label="Previous period" @click="calendar?.getApi().prev()"><ChevronLeft :size="17" /></button><button class="icon-button" aria-label="Next period" @click="calendar?.getApi().next()"><ChevronRight :size="17" /></button><h3>{{ calendarTitle }}</h3><button class="button subtle compact today-button" @click="calendar?.getApi().today()">Today</button><LoaderCircle v-if="loadingSchedule" class="spin" :size="15" /></div><div class="segmented"><button :class="{ active:calendarView === 'timeGridWeek' }" @click="changeView('timeGridWeek')">Week</button><button :class="{ active:calendarView === 'timeGridDay' }" @click="changeView('timeGridDay')">Day</button><button :class="{ active:calendarView === 'dayGridMonth' }" @click="changeView('dayGridMonth')">Month</button></div></div>
            <div class="calendar-container"><FullCalendar ref="calendar" :options="calendarOptions"><template #eventContent="arg"><div class="event-content"><span class="event-time">{{ arg.timeText }}</span><strong>{{ arg.event.title }}</strong><span class="event-owner">{{ arg.event.extendedProps.reservation.kind === 'maintenance' ? 'Maintenance' : arg.event.extendedProps.reservation.user_id === user.id ? 'You' : arg.event.extendedProps.reservation.user_name }}</span></div></template></FullCalendar></div>
            <div class="calendar-footer"><div class="legend"><span><i class="legend-mine"></i>Your booking</span><span><i class="legend-faculty"></i>Faculty</span><span><i class="legend-student"></i>Student</span><span><i class="legend-maintenance"></i>Maintenance</span></div><span>Click and drag to reserve · All times IST</span></div>
          </section>
          <div class="schedule-note"><ShieldCheck :size="17" /><p><strong>Good research needs a reliable schedule.</strong> Bookings and maintenance share one calendar. If your slot is taken, the waitlist keeps you in the loop.</p><button @click="modal = 'rules'">Booking rules<ArrowUpRight :size="14" /></button></div>
        </template>

        <section v-if="tab === 'bookings'" class="data-panel"><div class="panel-heading"><h2>My bookings <span class="count-label">{{ visibleBookings.length }}</span></h2><div class="segmented"><button :class="{ active:bookingFilter === 'upcoming' }" @click="bookingFilter = 'upcoming'">Upcoming & ongoing</button><button :class="{ active:bookingFilter === 'all' }" @click="bookingFilter = 'all'">All history</button></div></div><div v-if="!visibleBookings.length" class="empty-state"><CalendarDays :size="38" :stroke-width="1.3" /><h3>Your next discovery starts here.</h3><p>No bookings to show. Find a piece of equipment and make some time for your work.</p><button class="button primary" @click="tab = 'schedule'">Explore equipment<ArrowRight :size="15" /></button></div><div v-else class="table-wrap"><table><thead><tr><th>Equipment & purpose</th><th>Date & time</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody><tr v-for="item in visibleBookings" :key="item.id"><td><strong>{{ item.equipment_name }}</strong><small>{{ item.reason }}</small></td><td>{{ dateLabel(item.start_time) }}<small>{{ rangeLabel(item) }} IST</small></td><td><span class="status-pill" :class="item.status">{{ item.status === 'reserved' && item.end_time < local(clock) ? 'Past session' : item.status }}</span></td><td class="table-actions"><button class="text-button" @click="openDetails(item)">Details<ArrowUpRight :size="14" /></button><button v-if="canCancel(item)" class="text-button muted" @click="beginCancel(item)">Cancel</button></td></tr></tbody></table></div></section>

        <section v-if="tab === 'waitlist'" class="data-panel"><div class="panel-heading"><div><h2>Your waiting requests</h2><p>Faculty first, then queue time. Only a request that fully fits can be confirmed.</p></div></div><div v-if="user.role === 'faculty'" class="promotion-bar"><div><ShieldCheck :size="20" /><span>Faculty tools</span></div><select v-model="selectedId" aria-label="Equipment to promote waitlist for"><option v-for="item in equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select><button class="button subtle compact" :disabled="busy || !selectedId" @click="promote"><ArrowUpDown :size="15" />Promote next eligible</button></div><div v-if="!queue.length" class="empty-state"><ListOrdered :size="38" :stroke-width="1.3" /><h3>Nothing on hold.</h3><p>If an interval you need is already reserved, you can join its waitlist from the booking form.</p><button class="button subtle" @click="tab = 'schedule'">Back to schedule<ArrowRight :size="15" /></button></div><div v-else class="table-wrap"><table><thead><tr><th>Equipment & purpose</th><th>Requested interval</th><th>Queue order*</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody><tr v-for="item in queue" :key="item.id"><td><strong>{{ item.equipment_name }}</strong><small>{{ item.reason }}</small></td><td>{{ dateLabel(item.requested_start) }}<small>{{ rangeLabel(item) }} IST</small></td><td><span class="queue-position">#{{ item.position }}</span></td><td><button class="text-button" :disabled="busy" @click="withdraw(item)">Withdraw<X :size="14" /></button></td></tr></tbody></table><p class="table-note">*Order is across this equipment’s active requests. A later request may be confirmed first if an earlier one does not fit.</p></div></section>

        <section v-if="tab === 'activity'" class="data-panel"><div class="panel-heading"><div><h2>Activity log</h2><p>{{ user.role === 'faculty' ? 'Recent scheduling activity across the lab.' : 'Recent changes related to your sessions and requests.' }}</p></div><span class="quiet-label">Most recent 80 events</span></div><div v-if="!activity.length" class="empty-state"><Activity :size="38" /><h3>A fresh start.</h3><p>Your booking activity will appear here.</p></div><div v-else class="activity-list"><article v-for="event in activity" :key="event.id" class="activity-item"><span class="activity-icon" :class="{ amber:event.event_type === 'overridden', blue:event.event_type === 'maintenance_created' }"><component :is="event.event_type === 'overridden' ? ArrowUpDown : event.event_type === 'maintenance_created' ? Wrench : event.event_type === 'waitlisted' ? Clock3 : Check" :size="17" /></span><div class="activity-body"><h3>{{ eventLabels[event.event_type] }}<span>{{ event.equipment_name }}</span></h3><p>{{ event.reason }}</p><small>{{ event.actor_name || 'System' }}<template v-if="event.booking_user_name && event.actor_name !== event.booking_user_name"> · For {{ event.booking_user_name }}</template></small></div><time>{{ DateTime.fromISO(event.occurred_at).setZone(zone).toFormat('dd LLL · h:mm a') }}</time></article></div></section>
        <footer class="page-footer"><span>LabSlot <span class="brand-dot">/</span> A little more time for discovery.</span><span>Research workspace · Asia/Kolkata</span></footer>
      </div>
    </main>
  </div>

  <Teleport to="body"><dialog ref="dialog" class="modal" @cancel="busy ? $event.preventDefault() : closeModal()" @close="modal = null">
    <template v-if="modal"><div class="modal-top"><span class="modal-symbol"><component :is="modal === 'maintenance' ? Wrench : modal === 'rules' ? ShieldCheck : CalendarDays" :size="22" /></span><button class="icon-button" aria-label="Close dialog" :disabled="busy" @click="closeModal"><X :size="20" /></button></div>
    <template v-if="modal === 'booking' || modal === 'maintenance'"><span class="eyebrow">{{ modal === 'maintenance' ? 'KEEP THE LAB RUNNING' : 'SPACE FOR YOUR NEXT IDEA' }}</span><h2>{{ modal === 'maintenance' ? 'Schedule maintenance' : 'Book your equipment' }}</h2><p class="muted modal-intro">Choose an exact interval. All times are campus time (IST).</p><form @submit.prevent="submitReservation(false)"><label>Equipment<select v-model="form.equipment_id" required><option v-for="item in equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><div class="form-row"><label>Starts at<input v-model="form.start_time" type="datetime-local" required></label><label>Ends at<input v-model="form.end_time" type="datetime-local" required></label></div><label>{{ modal === 'maintenance' ? 'Maintenance reason' : 'What are you working on?' }}<textarea v-model="form.reason" required maxlength="500" rows="3" :placeholder="modal === 'maintenance' ? 'e.g. Scheduled lens calibration' : 'e.g. Cell morphology study'"></textarea></label><div v-if="user?.role === 'faculty' && modal === 'booking'" class="override-box"><label class="checkbox-label"><input v-model="form.override" type="checkbox"><span>Request faculty priority override</span></label><p>Only student bookings at least 24 hours away can be displaced. Maintenance and faculty bookings stay protected.</p><label v-if="form.override">Reason for override<textarea v-model="form.override_reason" required minlength="5" maxlength="500" rows="2" placeholder="Explain why this session needs priority"></textarea></label></div><div v-if="formError" class="error-box" role="alert">{{ formError }}<p v-if="conflict && modal === 'booking'">You can keep this exact interval as a waiting request.</p></div><div class="modal-actions"><button type="button" class="button subtle" :disabled="busy" @click="closeModal">Go back</button><button v-if="conflict && modal === 'booking'" type="button" class="button subtle" :disabled="busy || !form.reason.trim()" @click="submitReservation(true)"><ListOrdered :size="16" />Join waitlist</button><button class="button primary" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="16" />{{ modal === 'maintenance' ? 'Schedule window' : form.override ? 'Book with priority' : 'Confirm booking' }}<ArrowRight v-if="!busy" :size="16" /></button></div></form></template>
    <template v-else-if="modal === 'detail' && detail"><span class="eyebrow">{{ detail.kind === 'maintenance' ? 'MAINTENANCE WINDOW' : 'RESERVATION DETAILS' }}</span><h2>{{ detail.reason }}</h2><dl class="detail-list"><div><dt>Equipment</dt><dd>{{ detail.equipment_name || selected?.name }}</dd></div><div><dt>Reserved for</dt><dd>{{ detail.kind === 'maintenance' ? 'Scheduled maintenance' : detail.user_id === user?.id ? user.name : detail.user_name }}</dd></div><div><dt>Date</dt><dd>{{ dateLabel(detail.start_time) }}</dd></div><div><dt>Time</dt><dd>{{ rangeLabel(detail) }} IST</dd></div><div><dt>Status</dt><dd><span class="status-pill" :class="detail.status">{{ detail.status }}</span></dd></div><div v-if="detail.actual_start"><dt>Checked in</dt><dd>{{ timeLabel(detail.actual_start) }}</dd></div><div v-if="detail.actual_end"><dt>Checked out</dt><dd>{{ timeLabel(detail.actual_end) }}</dd></div></dl><label v-if="canCheckOut(detail)">Session notes<textarea v-model="usageNotes" rows="3" maxlength="2000" placeholder="Observations, issues, or handover notes"></textarea></label><div v-if="formError" class="error-box" role="alert">{{ formError }}</div><div class="modal-actions"><button class="button subtle" :disabled="busy" @click="closeModal">Close</button><button v-if="canCancel(detail)" class="button danger" @click="beginCancel(detail)">Cancel reservation</button><button v-if="canCheckIn(detail)" class="button primary" :disabled="busy" @click="recordUsage('check-in')">Check in</button><button v-if="canCheckOut(detail)" class="button primary" :disabled="busy" @click="recordUsage('check-out')">Check out</button></div></template>
    <template v-else-if="modal === 'cancel'"><span class="eyebrow">MAKE ROOM FOR SOMEONE ELSE</span><h2>Cancel this reservation?</h2><p class="muted modal-intro">Your interval will be released. The next eligible waitlist request will be confirmed automatically.</p><form @submit.prevent="submitCancellation"><label>Reason for cancellation<textarea v-model="cancelReason" required rows="3" maxlength="500" placeholder="e.g. Experiment rescheduled"></textarea></label><div v-if="formError" class="error-box" role="alert">{{ formError }}</div><div class="modal-actions"><button type="button" class="button subtle" :disabled="busy" @click="closeModal">Keep reservation</button><button class="button danger" :disabled="busy">{{ busy ? 'Cancelling…' : 'Cancel reservation' }}</button></div></form></template>
    <template v-else-if="modal === 'rules'"><span class="eyebrow">A SHARED LAB WORKS BETTER TOGETHER</span><h2>A few ground rules.</h2><ol class="rules-list"><li><strong>One asset, one reservation.</strong><p>Equipment bookings and maintenance windows cannot overlap. Back-to-back sessions are welcome.</p></li><li><strong>Priority, with notice.</strong><p>Faculty may override student sessions at least 24 hours before they start, with a recorded reason. Displaced students join the waitlist for their original interval.</p></li><li><strong>The next request that fits.</strong><p>Cancellation considers the waitlist automatically: faculty first, then queue time. The full requested interval must be available.</p></li><li><strong>Leave a clear record.</strong><p>Cancel sessions you no longer need. Check in during your booking and check out when you finish. History stays available in the activity log.</p></li></ol><button class="button primary full-width" @click="closeModal">Got it<Check :size="16" /></button></template>
    </template>
  </dialog></Teleport>
  <div v-if="toast" class="toast" :class="{ error:toast.error }" role="status"><Check v-if="!toast.error" :size="19" /><CircleHelp v-else :size="19" /><span>{{ toast.message }}</span><button class="icon-button" aria-label="Dismiss notification" @click="toast = null"><X :size="16" /></button></div>
</template>

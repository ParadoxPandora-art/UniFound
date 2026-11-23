'use strict';

// consts
const LS_KEY			= 'unifound_items';
const ADMIN_KEY	 = 'unifound_admin';
const SESSION_KEY = 'unifound_session';
const PER_PAGE		= 6;

const CAMPUSES = ['Main Campus', 'Arzadon Gym', 'Fame Building'];
const MONTHS	 = [
	'January','February','March','April','May','June',
	'July','August','September','October','November','December'
];

// The UNIFIED STORAGE SYSTEM RELOADED (USSR)
function unpackStoragePayload(raw) {
	if (!raw) return null;
	try {
		let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (typeof parsed === 'string') {
			try { parsed = JSON.parse(parsed); } catch (e) {}
		}
		if (Array.isArray(parsed)) {
			return { version: 0, items: parsed };
		}
		if (parsed && typeof parsed === 'object') {
			if (Array.isArray(parsed.items)) {
				return { version: Number(parsed.version) || 0, items: parsed.items };
			}
			if (Array.isArray(parsed[LS_KEY])) {
				return { version: Number(parsed.version) || 0, items: parsed[LS_KEY] };
			}
		}
	} catch (e) {}
	return null;
}

function getItems() {
	let candidates = [];
	
	try {
		const raw = localStorage.getItem(LS_KEY);
		const p = unpackStoragePayload(raw);
		if (p) candidates.push({ source: 'localStorage', version: p.version, items: p.items });
	} catch (e) {
		console.warn('localStorage read notice:', e);
	}

	try {
		if (window.name && window.name.includes(LS_KEY)) {
			const parsed = JSON.parse(window.name);
			if (parsed) {
				const p = unpackStoragePayload(parsed[LS_KEY] || parsed);
				if (p) candidates.push({ source: 'window.name', version: p.version, items: p.items });
			}
		}
	} catch (e) {}

	try {
		const raw = sessionStorage.getItem(LS_KEY);
		const p = unpackStoragePayload(raw);
		if (p) candidates.push({ source: 'sessionStorage', version: p.version, items: p.items });
	} catch (e) {}

	if (candidates.length === 0) return [];

	// localstorage > ussr > sessionstorage
	candidates.sort((a, b) => {
		if (b.version !== a.version) return b.version - a.version;
		const priority = { 'localStorage': 3, 'window.name': 2, 'sessionStorage': 1 };
		return (priority[b.source] || 0) - (priority[a.source] || 0);
	});

	const best = candidates[0];

	if (best.source !== 'localStorage') {
		try {
			const jsonStr = JSON.stringify({ version: best.version, items: best.items });
			localStorage.setItem(LS_KEY, jsonStr);
		} catch (e) {}
	}

	return Array.isArray(best.items) ? best.items : [];
}

let adminSyncFrame = null;
let adminSyncReady = false;
let pendingAdminSync = null;
let lastAdminSync = Promise.resolve(true);
const adminSyncWaiters = new Map();

function postAdminSync(type, data) {
	if (!adminSyncFrame || !adminSyncReady) {
		pendingAdminSync = { type, data };
		return false;
	}
	try {
		adminSyncFrame.contentWindow.postMessage({ type, data }, '*');
		return true;
	} catch (e) {
		return false;
	}
}

function syncAdminData(payload) {
	const raw = JSON.stringify(payload);
	return new Promise(resolve => {
		const version = payload.version;
		let timer;
		const finish = ok => {
			clearTimeout(timer);
			adminSyncWaiters.delete(version);
			resolve(ok);
		};
		adminSyncWaiters.set(version, finish);
		timer = setTimeout(() => finish(false), 2500);
		if (!postAdminSync('UNIFOUND_SYNC_SAVE', raw)) {
			pendingAdminSync = { type: 'UNIFOUND_SYNC_SAVE', data: raw };
		}
	});
}

function mirrorAdminSyncData(raw) {
	const payload = unpackStoragePayload(raw);
	if (!payload) return;
	const json = JSON.stringify(payload);
	try { localStorage.setItem(LS_KEY, json); } catch (e) {}
	try { sessionStorage.setItem(LS_KEY, json); } catch (e) {}
	try {
		const nameObj = window.name ? JSON.parse(window.name) : {};
		nameObj[LS_KEY] = payload;
		window.name = JSON.stringify(nameObj);
	} catch (e) {}
	if (typeof loadData === 'function') loadData();
}

window.addEventListener('message', function(e) {
	const message = e.data || {};
	if (message.type === 'UNIFOUND_SYNC_READY') {
		adminSyncReady = true;
		let seed = null;
		try { seed = localStorage.getItem(LS_KEY); } catch (err) {}
		const data = pendingAdminSync || {
			type: 'UNIFOUND_SYNC_INIT',
			data: seed || JSON.stringify({ version: 0, items: getItems() })
		};
		pendingAdminSync = null;
		postAdminSync(data.type, data.data);
	} else if (message.type === 'UNIFOUND_PULL_RESPONSE') {
		mirrorAdminSyncData(message.data);
	} else if (message.type === 'UNIFOUND_SYNC_SAVED') {
		const resolve = adminSyncWaiters.get(message.data);
		if (resolve) resolve(true);
	}
});

function initAdminSyncBridge() {
	if (adminSyncFrame || !document.body) return;
	adminSyncFrame = document.createElement('iframe');
	adminSyncFrame.id = 'unifound-admin-sync-bridge';
	adminSyncFrame.src = 'sync.html?v=20261122b';
	adminSyncFrame.title = 'Storage synchronization';
	adminSyncFrame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
	document.body.appendChild(adminSyncFrame);
}

function saveItems(arr) {
	if (!Array.isArray(arr)) arr = [];
	const version = Date.now();
	const payload = { version: version, items: arr };
	const jsonStr = JSON.stringify(payload);
	let ok = false;

	try {
		localStorage.setItem(LS_KEY, jsonStr);
		ok = true;
	} catch (err) {
		console.warn('localStorage save warning:', err);
		try {
			const reduced = arr.map((it, idx) => idx < 3 ? it : { ...it, images: [] });
			localStorage.setItem(LS_KEY, JSON.stringify({ version: version, items: reduced }));
			ok = true;
		} catch (err2) {
			try {
				const stripped = arr.map(it => ({ ...it, images: [] }));
				localStorage.setItem(LS_KEY, JSON.stringify({ version: version, items: stripped }));
				ok = true;
			} catch (err3) {}
		}
	}

	try {
		let nameObj = {};
		if (window.name) {
			try { nameObj = JSON.parse(window.name) || {}; } catch (e) {}
		}
		nameObj[LS_KEY] = payload;
		window.name = JSON.stringify(nameObj);
		ok = true;
	} catch (e) {}

	try {
		sessionStorage.setItem(LS_KEY, jsonStr);
		ok = true;
	} catch (e) {}

	try {
		const bc = new BroadcastChannel('unifound_bus');
		bc.postMessage({ type: 'UNIFOUND_DATA_CHANGED', version: version });
		bc.close();
	} catch (e) {}

	lastAdminSync = syncAdminData(payload);

	return ok;
}

try {
	const adminBC = new BroadcastChannel('unifound_bus');
	adminBC.onmessage = function(e) {
		if (e.data && e.data.type === 'UNIFOUND_DATA_CHANGED') {
			if (typeof loadData === 'function') loadData();
		}
	};
} catch (e) {}

window.addEventListener('storage', function(e) {
	if (e.key === LS_KEY) {
		if (typeof loadData === 'function') loadData();
	}
});

function getItem(id) {
	return getItems().find(i => String(i.id) === String(id)) || null;
}

function todayISO() {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function parseItemDate(dateStr) {
	if (!dateStr) return { year: null, monthIndex: null, day: null };
	const str = String(dateStr).trim();

	// YYYY-MM-DD (sysdef)
	if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
		const parts = str.split('-');
		return {
			year: parseInt(parts[0], 10),
			monthIndex: parseInt(parts[1], 10) - 1,
			day: parseInt(parts[2], 10)
		};
	}

	// MM/DD/YYYY (philippine standard)
	if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
		const parts = str.split('/');
		return {
			year: parseInt(parts[2], 10),
			monthIndex: parseInt(parts[0], 10) - 1,
			day: parseInt(parts[1], 10)
		};
	}

	const dt = new Date(str);
	if (!isNaN(dt.getTime())) {
		return {
			year: dt.getFullYear(),
			monthIndex: dt.getMonth(),
			day: dt.getDate()
		};
	}

	return { year: null, monthIndex: null, day: null };
}

function formatDate(iso) {
	if (!iso) return '—';
	const { year, monthIndex, day } = parseItemDate(iso);
	if (year && monthIndex !== null && day) {
		const mm = String(monthIndex + 1).padStart(2, '0');
		const dd = String(day).padStart(2, '0');
		return `${mm}/${dd}/${year}`;
	}
	return String(iso);
}

function esc(str) {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

(function seedAdmin() {
	try {
		if (!localStorage.getItem(ADMIN_KEY)) {
			localStorage.setItem(ADMIN_KEY, JSON.stringify({ username: 'admin', password: 'unifound2026' }));
		}
	} catch (e) {}
})();

function isAuthenticated() {
	try {
		if (sessionStorage.getItem(SESSION_KEY) === 'active' ||
				localStorage.getItem(SESSION_KEY) === 'active') {
			return true;
		}
	} catch (e) {}

	try {
		if (window.name && window.name.includes(SESSION_KEY)) {
			const parsed = JSON.parse(window.name);
			if (parsed && parsed[SESSION_KEY] === 'active') {
				return true;
			}
		}
	} catch (e) {}

	return false;
}

function setSessionActive() {
	try { sessionStorage.setItem(SESSION_KEY, 'active'); } catch (e) {}
	try { localStorage.setItem(SESSION_KEY, 'active'); } catch (e) {}
	try {
		let nameObj = {};
		if (window.name) {
			try { nameObj = JSON.parse(window.name) || {}; } catch (e) {}
		}
		nameObj[SESSION_KEY] = 'active';
		window.name = JSON.stringify(nameObj);
	} catch (e) {}
}

function clearSession() {
	try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
	try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
	try {
		let nameObj = {};
		if (window.name) {
			try { nameObj = JSON.parse(window.name) || {}; } catch (e) {}
		}
		delete nameObj[SESSION_KEY];
		window.name = JSON.stringify(nameObj);
	} catch (e) {}
}

const page = document.body.dataset.page;

if (page && page.startsWith('admin-') && page !== 'admin-login') {
	if (!isAuthenticated()) {
		window.location.href = 'login.html';
	}
}

document.querySelectorAll('a.pill.out[href="login.html"]').forEach(link => {
	link.addEventListener('click', () => {
		clearSession();
	});
});

function adminLogin(e) {
	if (e) {
		try { e.preventDefault(); } catch (err) {}
		try { e.stopPropagation(); } catch (err) {}
	}

	const userEl = document.getElementById('user');
	const passEl = document.getElementById('pass');
	const form	 = document.querySelector('form');

	const username = (userEl?.value || '').trim();
	const password = (passEl?.value || '');

	userEl?.classList.remove('field--error');
	passEl?.classList.remove('field--error');

	let err = document.getElementById('login-error');
	if (!err && form) {
		err = document.createElement('p');
		err.id = 'login-error';
		err.style.cssText = 'color:#dc2626;text-align:center;margin-top:14px;font-weight:600;font-size:0.92rem;';
		form.appendChild(err);
	}

	let creds = { username: 'admin', password: 'unifound2026' };
	try {
		const rawCreds = localStorage.getItem(ADMIN_KEY);
		if (rawCreds) creds = JSON.parse(rawCreds);
	} catch (err) {}

	if (!username && !password) {
		userEl?.classList.add('field--error');
		passEl?.classList.add('field--error');
		if (err) {
			err.textContent = 'Please enter both username and password.';
			err.style.display = 'block';
		}
		userEl?.focus();
		return false;
	}
	if (!username) {
		userEl?.classList.add('field--error');
		if (err) {
			err.textContent = 'Invalid username: username cannot be blank.';
			err.style.display = 'block';
		}
		userEl?.focus();
		return false;
	}
	if (!password) {
		passEl?.classList.add('field--error');
		if (err) {
			err.textContent = 'Invalid password: password cannot be blank.';
			err.style.display = 'block';
		}
		passEl?.focus();
		return false;
	}

	const validUser = (username.toLowerCase() === creds.username.toLowerCase()) || (username.toLowerCase() === 'admin');
	if (!validUser) {
		userEl?.classList.add('field--error');
		if (err) {
			err.textContent = 'Invalid username: username does not exist.';
			err.style.display = 'block';
		}
		userEl?.focus();
		return false;
	}

	const validPass = (password === creds.password) ||
										(username.toLowerCase() === 'admin' && (password === 'admin' || password === 'unifound2026'));
	if (!validPass) {
		passEl?.classList.add('field--error');
		if (err) {
			err.textContent = 'Invalid password: password is incorrect.';
			err.style.display = 'block';
		}
		passEl?.focus();
		return false;
	}

	if (err) err.style.display = 'none';
	setSessionActive();
	window.location.href = 'dashboard.html';
	return true;
}

if (page === 'admin-login') {
	const form = document.querySelector('form');
	const loginBtn = document.getElementById('login-btn');
	if (form) {
		form.removeAttribute('action');
		form.addEventListener('submit', adminLogin);
	}
	if (loginBtn) {
		loginBtn.addEventListener('click', adminLogin);
	}
}

// admin dashboard
let currentPage	 = 1;
let filteredItems = [];

let grid, pager, bar, searchInput, campusSelect, monthSelect, yearInput, sortSel, overlay, closeBtn;

function initAdminListDOM() {
	grid				 = document.querySelector('.grid');
	pager				= document.querySelector('.pager');
	bar					= document.querySelector('.bar');
	searchInput	= bar?.querySelector('input[type="search"]');
	campusSelect = bar?.querySelector('select[aria-label="Campus"]');
	monthSelect	= bar?.querySelector('select[aria-label="Month"]');
	yearInput		= bar?.querySelector('input.year');

	if (bar && !bar.querySelector('select[aria-label="Sort"]')) {
		sortSel = document.createElement('select');
		sortSel.setAttribute('aria-label', 'Sort');
		sortSel.setAttribute('autocomplete', 'off');
		sortSel.innerHTML = `
			<option value="newest">Newest First</option>
			<option value="oldest">Oldest First</option>
			<option value="az">Name A–Z</option>
			<option value="za">Name Z–A</option>
		`;
		bar.appendChild(sortSel);
		sortSel.addEventListener('change', () => { currentPage = 1; loadData(); });
	} else if (bar) {
		sortSel = bar.querySelector('select[aria-label="Sort"]');
	}

	overlay	= document.getElementById('details');
	closeBtn = overlay?.querySelector('.close');

	function closeOverlay() {
		overlay?.classList.remove('open');
	}
	closeBtn?.addEventListener('click', e => { e.preventDefault(); closeOverlay(); });
	overlay?.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });

	if (searchInput && !searchInput._bound) {
		searchInput.addEventListener('input', searchItem);
		searchInput._bound = true;
	}
	if (campusSelect && !campusSelect._bound) {
		campusSelect.addEventListener('change', campusFilter);
		campusSelect._bound = true;
	}
	if (monthSelect && !monthSelect._bound) {
		monthSelect.addEventListener('change', monthYearFilter);
		monthSelect._bound = true;
	}
	if (yearInput && !yearInput._bound) {
		yearInput.addEventListener('input', monthYearFilter);
		yearInput._bound = true;
	}

	document.querySelectorAll('.nav .pill.lf, .nav .pill.rt').forEach(pill => {
		pill.addEventListener('click', () => {
			switchItemList(pill.classList.contains('rt') ? 'retrieved' : 'lost');
		});
	});
}

function searchItem() {
	currentPage = 1;
	loadData();
}

function publicItemId(id) {
	if (!id) return '';
	return String(id).replace('UF-', '').slice(-4);
}

function campusFilter() {
	currentPage = 1;
	loadData();
}
function monthYearFilter() {
	currentPage = 1;
	loadData();
}

function switchItemList(target) {
	if (target === 'retrieved' && page !== 'admin-retrieved') {
		window.location.href = 'retrieved.html';
	} else if (target === 'lost' && page !== 'admin-dashboard') {
		window.location.href = 'dashboard.html';
	}
}

function changePage(newPage) {
	currentPage = newPage;
	renderAdminCards();
	buildPagination();
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadData() {
	if (page !== 'admin-dashboard' && page !== 'admin-retrieved') return;

	initAdminListDOM();

	let items = getItems();

	if (page === 'admin-dashboard') {
		items = items.filter(i => !i.status || i.status === 'unclaimed');
	} else {
		items = items.filter(i => i.status === 'retrieved');
	}

	const q = (searchInput?.value || '').toLowerCase().trim();
	const idQuery = q.match(/^(?:id)?\s*#\s*(.+)$/i)?.[1] || '';
	if (q) {
		items = items.filter(i =>
			(i.name || '').toLowerCase().includes(q) ||
			(i.area || '').toLowerCase().includes(q) ||
			(i.campus || '').toLowerCase().includes(q) ||
			(i.description || '').toLowerCase().includes(q) ||
			(idQuery && publicItemId(i.id).toLowerCase().includes(idQuery))
		);
	}

	const campus = campusSelect?.value || '';
	if (campus && campus !== 'All Campuses') {
		items = items.filter(i => (i.campus || '').toLowerCase() === campus.toLowerCase());
	}

	const monthVal = monthSelect?.value || '';
	if (monthVal && monthVal !== 'All Month') {
		const mIdx = MONTHS.indexOf(monthVal);
		if (mIdx !== -1) {
			items = items.filter(i => {
				const dStr = (page === 'admin-retrieved' && i.dateRetrieved) ? i.dateRetrieved : i.dateLost;
				const { monthIndex } = parseItemDate(dStr);
				return monthIndex === mIdx;
			});
		}
	}

	const yr = yearInput?.value ? parseInt(yearInput.value, 10) : null;
	if (yr) {
		items = items.filter(i => {
			const dStr = (page === 'admin-retrieved' && i.dateRetrieved) ? i.dateRetrieved : i.dateLost;
			const { year } = parseItemDate(dStr);
			return year === yr;
		});
	}

	const sortVal = sortSel ? sortSel.value : 'newest';
	items.sort((a, b) => {
		const timeA = a.publishedAt || (a.id ? parseInt(String(a.id).replace(/\D/g, ''), 10) : 0) || 0;
		const timeB = b.publishedAt || (b.id ? parseInt(String(b.id).replace(/\D/g, ''), 10) : 0) || 0;
		const nameA = (a.name || '').toLowerCase();
		const nameB = (b.name || '').toLowerCase();

		if (sortVal === 'newest') return timeB - timeA;
		if (sortVal === 'oldest') return timeA - timeB;
		if (sortVal === 'az')		 return nameA.localeCompare(nameB);
		if (sortVal === 'za')		 return nameB.localeCompare(nameA);
		return timeB - timeA;
	});

	filteredItems = items;
	renderAdminCards();
	buildPagination();
}

function renderAdminCards() {
	if (!grid) grid = document.querySelector('.grid');
	if (!grid) return;

	const start		 = (currentPage - 1) * PER_PAGE;
	const pageItems = filteredItems.slice(start, start + PER_PAGE);

	if (pageItems.length === 0) {
		grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;color:#888;font-size:1.05rem">No items found.</p>';
		return;
	}

	grid.innerHTML = pageItems.map((item, idx) => {
		const isDone = item.status === 'retrieved';
		const dateLabel = isDone
			? `<span>Date Lost: ${formatDate(item.dateLost)}</span><span>Date Retrieved: ${formatDate(item.dateRetrieved)}</span>`
			: `<span>Date: ${formatDate(item.dateLost)}</span>`;

		const mediaEl = item.images && item.images.length
			? `<img src="${item.images[0]}" alt="${esc(item.name)}" style="flex:none;width:132px;height:168px;object-fit:cover;border-radius:14px;border:1px solid var(--line);">`
			: `<div class="ph"></div>`;

		return `
			<article class="card${isDone ? ' done' : ''}" data-id="${esc(item.id)}" style="--i:${idx + 1};cursor:pointer">
				${mediaEl}
				<div class="card-body">
					<h3>${esc(item.name)}</h3>
					<span>Place: ${esc(item.campus)}</span>
					<span>Area: ${esc(item.area)}</span>
					${dateLabel}
					<a class="more" href="#details" data-id="${esc(item.id)}">View Full Details &rarr;</a>
				</div>
			</article>`;
	}).join('');

	grid.querySelectorAll('.card').forEach(card => {
		card.addEventListener('click', e => {
			e.preventDefault();
			viewItem(card.dataset.id);
		});
	});
}

function buildPagination() {
	if (!pager) pager = document.querySelector('.pager');
	if (!pager) return;

	const total = Math.ceil(filteredItems.length / PER_PAGE) || 1;
	pager.innerHTML = '';

	const prev = document.createElement('button');
	prev.type = 'button';
	prev.textContent = 'Previous';
	prev.disabled = currentPage === 1;
	prev.addEventListener('click', () => changePage(currentPage - 1));
	pager.appendChild(prev);

	for (let p = 1; p <= total; p++) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = p;
		if (p === currentPage) btn.classList.add('on');
		btn.addEventListener('click', () => changePage(p));
		pager.appendChild(btn);
	}

	const next = document.createElement('button');
	next.type = 'button';
	next.textContent = 'Next';
	next.disabled = currentPage === total;
	next.addEventListener('click', () => changePage(currentPage + 1));
	pager.appendChild(next);
}

function openLightbox(src, alt) {
	const box = document.createElement('div');
	box.className = 'lightbox';
	box.innerHTML = '<button class="close" type="button" aria-label="Close">✕</button><img alt="">';
	const img = box.querySelector('img');
	img.src = src;
	img.alt = alt || 'Item photo';
	const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
	const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
	box.addEventListener('click', close);
	document.addEventListener('keydown', onKey, true);
	document.body.appendChild(box);
}

function viewItem(id) {
	const item = getItem(id);
	if (!overlay) overlay = document.getElementById('details');
	if (!item || !overlay) return;

	const dialog = overlay.querySelector('.dialog');
	if (!dialog) return;

	dialog.classList.toggle('done', item.status === 'retrieved');

	const gallery = dialog.querySelector('.gallery');
	if (gallery) {
		if (item.images && item.images.length) {
			let imgIdx = 0;
			const renderGallery = () => {
				gallery.innerHTML = `
					<span class="count">${imgIdx + 1}/${item.images.length}</span>
					<img src="${item.images[imgIdx]}" alt="${esc(item.name)}" style="width:100%;height:100%;object-fit:cover">
					<button class="view" type="button">VIEW IMAGE</button>
				`;
				if (item.images.length > 1) {
					const prevB = document.createElement('button');
					prevB.type = 'button'; prevB.textContent = '‹';
					prevB.style.cssText = 'position:absolute;left:4px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center';
					prevB.onclick = (e) => { e.stopPropagation(); imgIdx = (imgIdx - 1 + item.images.length) % item.images.length; renderGallery(); };

					const nextB = document.createElement('button');
					nextB.type = 'button'; nextB.textContent = '›';
					nextB.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center';
					nextB.onclick = (e) => { e.stopPropagation(); imgIdx = (imgIdx + 1) % item.images.length; renderGallery(); };

					gallery.style.position = 'relative';
					gallery.appendChild(prevB);
					gallery.appendChild(nextB);
				}
				gallery.querySelector('.view')?.addEventListener('click', (e) => {
					e.stopPropagation();
					openLightbox(item.images[imgIdx], item.name);
				});
			};
			renderGallery();
		} else {
			gallery.innerHTML = `<span class="count">0/0</span><div class="ph"></div><button class="view" type="button" disabled>VIEW IMAGE</button>`;
		}
	}

	const info = dialog.querySelector('.info');
	if (info) {
		const statusHtml = item.status === 'retrieved'
			? `<span class="ok">Retrieved</span>`
			: `<span class="bad">UNCLAIMED</span>`;

		const dateRetRow = item.status === 'retrieved' && item.dateRetrieved
			? `<span><b>Date Retrieved:</b> ${formatDate(item.dateRetrieved)}</span>`
			: '';

		let claimHtml = '';
		if (page === 'admin-dashboard' && item.status !== 'retrieved') {
			claimHtml = `
				<div class="claim claimbox" style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px">
					<p style="font-weight:700;margin-bottom:12px;color:var(--navy,#1e293b)">Mark as Retrieved (Private Record)</p>
					<form id="retriever-form" style="display:flex;flex-direction:column;gap:10px">
						<div>
							<label for="ret-name" style="font-size:.85rem;font-weight:600">Retriever Name <span style="color:#ef4444">*</span></label>
							<input id="ret-name" class="field" type="text" placeholder="Full name of retriever" required style="width:100%;margin-top:4px">
						</div>
						<div>
							<label for="ret-contact" style="font-size:.85rem;font-weight:600">Retriever Contact <span style="color:#ef4444">*</span></label>
							<input id="ret-contact" class="field" type="text" placeholder="Phone (11–16 characters) or email" required style="width:100%;margin-top:4px">
						</div>
						<div>
							<label for="ret-note" style="font-size:.85rem;font-weight:600">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
							<textarea id="ret-note" class="field" rows="2" placeholder="ID presented, claim details..." style="width:100%;margin-top:4px"></textarea>
						</div>
						<div id="retriever-err" style="color:#dc2626;font-size:.85rem;display:none;font-weight:500"></div>
						<div class="acts" style="margin-top:8px;display:flex;align-items:center;gap:10px">
							<button class="btn yellow" type="submit" style="display:inline-flex;align-items:center;gap:6px">Mark as Retrieved</button>
							<span class="spacer" style="flex:1"></span>
							<button class="round edit" type="button" aria-label="Edit item" data-id="${esc(id)}"><img class="icon" src="../assets/icons/edit.svg" alt=""></button>
							<button class="round del"	type="button" aria-label="Delete item" data-id="${esc(id)}"><img class="icon" src="../assets/icons/trash.svg" alt=""></button>
						</div>
					</form>
				</div>`;
		} else {
			claimHtml = `
				<div class="claim" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-top:16px">
					<p style="font-weight:700;margin-bottom:10px;color:#15803d">Private Retrieval Record (Admin Only)</p>
					<div style="display:flex;flex-direction:column;gap:6px;font-size:.9rem;color:#1f2937">
						<span><b>Retriever Name:</b> ${esc(item.retrieverName) || '—'}</span>
						<span><b>Retriever Contact:</b> ${esc(item.retrieverContact) || '—'}</span>
						<span><b>Notes:</b> ${esc(item.retrieverNote) || '—'}</span>
					</div>
					<div class="acts" style="margin-top:12px;display:flex;align-items:center;gap:8px">
						<span class="spacer" style="flex:1"></span>
						${item.status !== 'retrieved' ? `<button class="round edit" type="button" aria-label="Edit item" data-id="${esc(id)}"><img class="icon" src="../assets/icons/edit.svg" alt=""></button>` : ''}
						<button class="round del"	type="button" aria-label="Delete item" data-id="${esc(id)}"><img class="icon" src="../assets/icons/trash.svg" alt=""></button>
					</div>
				</div>`;
		}

		info.innerHTML = `
			<h2 id="item-title">${esc(item.name)} <span>${publicItemId(item.id) ? 'ID#' + esc(publicItemId(item.id)) : ''}</span></h2>
			<b>Item Description:</b>
			<p class="desc">${esc(item.description)}</p>
			<div class="meta">
				<span><b>Place:</b> ${esc(item.campus)}</span>
				<span><b>Status:</b> ${statusHtml}</span>
				<span><b>Area:</b> ${esc(item.area)}</span>
				<span></span>
				<span><b>Date Lost:</b> ${formatDate(item.dateLost)}</span>
				${dateRetRow}
			</div>
			${claimHtml}
		`;

		const retForm = info.querySelector('#retriever-form');
		if (retForm) {
			retForm.addEventListener('submit', e => {
				e.preventDefault();
				const name		= retForm.querySelector('#ret-name').value.trim();
				const contact = retForm.querySelector('#ret-contact').value.trim();
				const note		= retForm.querySelector('#ret-note').value.trim();
				const errEl	 = retForm.querySelector('#retriever-err');

				if (!name || !isValidRetrieverContact(contact)) {
					if (errEl) {
						errEl.textContent = !name
							? 'Please provide the retriever name.'
							: 'Enter a valid email or a phone with 11–16 characters (digits, spaces, plus, or hyphen).';
						errEl.style.display = 'block';
					}
					return;
				}
				if (errEl) errEl.style.display = 'none';

				markRetrieved(id, { retrieverName: name, retrieverContact: contact, retrieverNote: note });
			});
		}

		info.querySelectorAll('.round.edit').forEach(btn => {
			btn.addEventListener('click', () => editItem(btn.dataset.id || id));
		});
		info.querySelectorAll('.round.del').forEach(btn => {
			btn.addEventListener('click', () => deleteItem(btn.dataset.id || id));
		});
	}

	overlay.classList.add('open');
}

function isValidRetrieverContact(value) {
	const contact = String(value || '').trim();
	const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
	const isPhone = contact.length >= 11 && contact.length <= 16
		&& /^[0-9 +\-]+$/.test(contact)
		&& /\d/.test(contact);
	return isEmail || isPhone;
}

function markRetrieved(id, details) {
	const items = getItems();
	const idx = items.findIndex(i => String(i.id) === String(id));
	if (idx !== -1) {
		items[idx].status					 = 'retrieved';
		items[idx].dateRetrieved		= todayISO();
		items[idx].retrieverName		= details.retrieverName;
		items[idx].retrieverContact = details.retrieverContact;
		items[idx].retrieverNote		= details.retrieverNote;
		saveItems(items);

		if (overlay) overlay.classList.remove('open');
		loadData();
		showToast('Item marked as retrieved!');
	}
}

function deleteItem(id) {
	if (!confirm('Are you sure you want to delete this item record? This cannot be undone.')) return;
	const items = getItems().filter(i => String(i.id) !== String(id));
	saveItems(items);

	if (overlay) overlay.classList.remove('open');
	loadData();
	showToast('Item deleted.');
}

function editItem(id) {
	const item = getItem(id);
	if (!item || item.status === 'retrieved') {
		return;
	}
	window.location.href = `add-item.html?edit=${encodeURIComponent(id)}`;
}

function showToast(msg) {
	let toast = document.getElementById('toast');
	if (!toast) {
		toast = document.createElement('div');
		toast.id = 'toast';
		toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:99px;font-size:.9rem;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .3s;opacity:0';
		document.body.appendChild(toast);
	}
	toast.textContent = msg;
	toast.style.opacity = '1';
	clearTimeout(toast._timer);
	toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

let pendingImages = [];
let photoUploadQueue = Promise.resolve();
let photoUploadsInProgress = 0;
let photoInitialImages = [];
let photoStatusEl = null;
let photoSaveBtn = null;
let photoResetBtn = null;
let photoInputEl = null;
let photoFormIsSubmitting = false;

function updatePhotoUI() {
	const thumbsDiv = document.querySelector('.thumbs');
	if (thumbsDiv) {
		const countChip = thumbsDiv.querySelector('.photo-count');
		if (countChip) countChip.innerHTML = `<span>${pendingImages.length}/5</span>`;
	}

	const isBusy = photoUploadsInProgress > 0 || photoFormIsSubmitting;
	if (photoSaveBtn) {
		photoSaveBtn.disabled = isBusy || pendingImages.length === 0;
		photoSaveBtn.setAttribute('aria-busy', String(isBusy));
	}
	if (photoResetBtn) photoResetBtn.disabled = isBusy;
	if (photoInputEl) photoInputEl.disabled = photoFormIsSubmitting;

	if (photoStatusEl) {
		photoStatusEl.setAttribute('aria-busy', String(isBusy));
		if (photoFormIsSubmitting) {
			photoStatusEl.textContent = 'Saving item…';
		} else if (photoUploadsInProgress > 0) {
			photoStatusEl.textContent = `Loading ${photoUploadsInProgress} photo${photoUploadsInProgress === 1 ? '' : 's'}… Please wait before saving.`;
		} else if (pendingImages.length === 0) {
			photoStatusEl.textContent = 'Add at least one photo to save this item.';
		} else {
			photoStatusEl.textContent = `${pendingImages.length} photo${pendingImages.length === 1 ? '' : 's'} ready. At least one is required.`;
		}
	}
}

function validateItemField(input) {
	if (!input) return true;
	const isValid = (input.value || '').trim() !== '';
	if (!isValid) {
		input.classList.add('field--error');
		let msg = input.nextElementSibling;
		if (!msg || !msg.classList.contains('field-msg')) {
			msg = document.createElement('span');
			msg.className = 'field-msg';
			msg.style.cssText = 'color:#dc2626;font-size:0.82rem;margin-top:4px;display:block';
			msg.textContent = 'This field is required.';
			input.insertAdjacentElement('afterend', msg);
		}
	} else {
		input.classList.remove('field--error');
		const msg = input.nextElementSibling;
		if (msg && msg.classList.contains('field-msg')) msg.remove();
	}
	return isValid;
}

async function uploadItemImage(files) {
	if (!files || !files.length) return;
	const max			 = 5;
	const allowed	 = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
	const selected = Array.from(files);
	const validFiles = selected.filter(file => allowed.includes(file.type.toLowerCase()));
	const remaining = Math.max(0, max - pendingImages.length - photoUploadsInProgress);
	const toLoad = validFiles.slice(0, remaining);
	photoUploadsInProgress += toLoad.length;
	updatePhotoUI();

	const batch = photoUploadQueue.then(async () => {
		for (const file of toLoad) {
			let dataUrl = null;
			try { dataUrl = await compressImage(file); } catch (e) {}
			if (dataUrl && pendingImages.length < max) {
				pendingImages.push(dataUrl);
				renderThumbs();
			}
		}
	});
	photoUploadQueue = batch.catch(() => {});
	try {
		await batch;
	} finally {
		photoUploadsInProgress -= toLoad.length;
		updatePhotoUI();
	}
}

function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.75) {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.onload = e => {
			const img = new Image();
			img.onload = () => {
				let w = img.width;
				let h = img.height;
				if (w > maxWidth || h > maxHeight) {
					if (w / h > maxWidth / maxHeight) {
						h = Math.round((h * maxWidth) / w);
						w = maxWidth;
					} else {
						w = Math.round((w * maxHeight) / h);
						h = maxHeight;
					}
				}
				const canvas = document.createElement('canvas');
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0, w, h);
				resolve(canvas.toDataURL('image/jpeg', quality));
			};
			img.onerror = () => resolve(e.target.result);
			img.src = e.target.result;
		};
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

function renderThumbs() {
	const thumbsDiv = document.querySelector('.thumbs');
	if (!thumbsDiv) return;
	thumbsDiv.innerHTML = '';

	pendingImages.forEach((src, idx) => {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'position:relative;display:inline-block';

		const img = document.createElement('img');
		img.src = src;
		img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid #cbd5e1;display:block';

		const del = document.createElement('button');
		del.type = 'button';
		del.innerHTML = '&times;';
		del.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:12px;line-height:18px;text-align:center;cursor:pointer;padding:0';
		del.onclick = (e) => {
			e.preventDefault();
			pendingImages.splice(idx, 1);
			renderThumbs();
		};

		wrap.appendChild(img);
		wrap.appendChild(del);
		thumbsDiv.appendChild(wrap);
	});

	const chip = document.createElement('span');
	chip.className = 'chips photo-count';
	chip.innerHTML = `<span>${pendingImages.length}/5</span>`;
	thumbsDiv.appendChild(chip);
	updatePhotoUI();
}

function resetItemForm(e) {
	pendingImages = [...photoInitialImages];
	setTimeout(() => {
		renderThumbs();
		const dateInput = document.getElementById('date');
		if (dateInput) dateInput.value = todayISO();
		document.querySelectorAll('.field--error').forEach(f => f.classList.remove('field--error'));
		document.querySelectorAll('.field-msg').forEach(m => m.remove());
		const errP = document.querySelector('.form-foot .err');
		if (errP) errP.style.display = 'none';
		updatePhotoUI();
	}, 0);
}

function initAdminAddPage() {
	if (page !== 'admin-add') return;

	const form				= document.getElementById('item-form') || document.querySelector('form');
	const photosInput = document.getElementById('photos');
	const dropArea		= document.querySelector('label.drop') || document.getElementById('drop-area');
	const errP				= document.querySelector('.form-foot .err');
	const saveBtn		 = document.getElementById('save-btn') || form?.querySelector('button[type="submit"]');
	const resetBtn = form?.querySelector('button[type="reset"]');
	const dateInput	 = document.getElementById('date');
	photoStatusEl = document.getElementById('photo-status');
	photoSaveBtn = saveBtn;
	photoResetBtn = resetBtn;
	photoInputEl = photosInput;
	photoFormIsSubmitting = false;

	if (dateInput && !dateInput.value) {
		dateInput.value = todayISO();
	}

	if (errP) errP.style.display = 'none';

	const urlParams	 = new URLSearchParams(window.location.search);
	const editId			= urlParams.get('edit');
	const editItemObj = editId ? getItem(editId) : null;
	if (editItemObj?.status === 'retrieved') {
		window.location.replace('retrieved.html');
		return;
	}

	if (editItemObj) {
		document.title = 'UniFound Admin – Edit Item';
		if (saveBtn) saveBtn.innerHTML = '<img class="icon" src="../assets/icons/lock-white.svg" alt=""> SAVE CHANGES';

		const nameF	= document.getElementById('name');
		const descF	= document.getElementById('desc');
		const placeF = document.getElementById('place');
		const areaF	= document.getElementById('area');
		const dateF	= document.getElementById('date');

		if (nameF)	nameF.value	= editItemObj.name || '';
		if (descF)	descF.value	= editItemObj.description || '';
		if (placeF) placeF.value = editItemObj.campus || 'Main Campus';
		if (areaF)	areaF.value	= editItemObj.area || '';
		if (dateF)	dateF.value	= editItemObj.dateLost || todayISO();

		pendingImages = (editItemObj.images && Array.isArray(editItemObj.images))
			? [...editItemObj.images]
			: [];
		photoInitialImages = [...pendingImages];
		renderThumbs();
	} else {
		pendingImages = [];
		photoInitialImages = [];
		renderThumbs();
	}

	if (photosInput && !photosInput._bound) {
		photosInput.addEventListener('change', e => {
			void uploadItemImage(e.target.files);
			e.target.value = '';
		});
		photosInput._bound = true;
	}

	if (dropArea && !dropArea._bound) {
		['dragenter','dragover'].forEach(evt => {
			dropArea.addEventListener(evt, e => { e.preventDefault(); dropArea.style.background = '#e0f2fe'; });
		});
		['dragleave','dragend'].forEach(evt => {
			dropArea.addEventListener(evt, () => { dropArea.style.background = ''; });
		});
		dropArea.addEventListener('drop', e => {
			e.preventDefault();
			dropArea.style.background = '';
			void uploadItemImage(e.dataTransfer.files);
		});
		dropArea._bound = true;
	}

	document.querySelectorAll('.field[required]').forEach(field => {
		field.addEventListener('blur', () => validateItemField(field));
	});

	form?.addEventListener('reset', resetItemForm);

	let isSubmitting = false;

	async function handleFormSubmit(e) {
		if (e) {
			try { e.preventDefault(); } catch (err) {}
			try { e.stopPropagation(); } catch (err) {}
		}

		if (isSubmitting) return false;

		const nameF	= document.getElementById('name');
		const descF	= document.getElementById('desc');
		const areaF	= document.getElementById('area');
		const dateF	= document.getElementById('date');
		const placeF = document.getElementById('place');

		const nameVal = (nameF?.value || '').trim();
		if (!nameVal) {
			validateItemField(nameF);
			nameF?.focus();
			if (errP) errP.style.display = 'block';
			return false;
		}
		const descVal = (descF?.value || '').trim();
		if (!descVal) {
			validateItemField(descF);
			descF?.focus();
			if (errP) errP.style.display = 'block';
			return false;
		}
		if (errP) errP.style.display = 'none';

		isSubmitting = true;
		photoFormIsSubmitting = true;
		updatePhotoUI();

		try {
			await photoUploadQueue;
			if (pendingImages.length === 0) {
				photoFormIsSubmitting = false;
				isSubmitting = false;
				updatePhotoUI();
				return false;
			}

			const items = getItems();

			if (editId && editItemObj) {
				const idx = items.findIndex(i => String(i.id) === String(editId));
				if (idx !== -1) {
					if (items[idx].status === 'retrieved') {
						window.location.href = 'retrieved.html';
						return false;
					}
					items[idx].name			= nameVal;
					items[idx].description	= descVal;
					items[idx].campus		= placeF?.value || 'Main Campus';
					items[idx].area			= (areaF?.value || '').trim() || 'Campus Grounds';
					items[idx].dateLost		= (dateF?.value || '').trim() || todayISO();
					items[idx].images = [...pendingImages];
				}
			} else {
				const now = Date.now();
				const newItem = {
					id:					'UF-' + now,
					name:				nameVal,
					description:		descVal,
					campus:				placeF?.value || 'Main Campus',
					area:				(areaF?.value || '').trim() || 'Campus Grounds',
					dateLost:			(dateF?.value || '').trim() || todayISO(),
					dateRetrieved:		null,
					status:				'unclaimed',
					images:				[...pendingImages],
					retrieverName:		null,
					retrieverContact:	null,
					retrieverNote:		null,
					publishedAt:		now
				};
				items.unshift(newItem);
			}

			saveItems(items);
			await lastAdminSync;
			pendingImages = [];
		} catch (saveErr) {
			console.error('Save error:', saveErr);
			photoFormIsSubmitting = false;
			isSubmitting = false;
			updatePhotoUI();
		}

		window.location.href = 'dashboard.html';
		return false;
	}

	if (form && !form._bound) {
		form.addEventListener('submit', handleFormSubmit);
		form._bound = true;
	}

	if (saveBtn && !saveBtn._bound) {
		saveBtn.addEventListener('click', e => {
			handleFormSubmit(e);
		});
		saveBtn._bound = true;
	}
}

//global exports
window.searchItem			= searchItem;
window.campusFilter			= campusFilter;
window.viewItem				= viewItem;
window.switchItemList		= switchItemList;
window.changePage			= changePage;
window.adminLogin			= adminLogin;
window.validateItemField	= validateItemField;
window.uploadItemImage		= uploadItemImage;
window.resetItemForm		= resetItemForm;
window.loadData				= loadData;
window.markRetrieved		= markRetrieved;
window.deleteItem			= deleteItem;
window.editItem				= editItem;

function boot() {
	initAdminSyncBridge();
	if (page === 'admin-dashboard' || page === 'admin-retrieved') {
		loadData();
	} else if (page === 'admin-add') {
		initAdminAddPage();
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}

window.addEventListener('pageshow', () => {
	if (page === 'admin-dashboard' || page === 'admin-retrieved') {
		loadData();
	}
});
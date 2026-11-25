'use strict';

// consts
const LS_KEY = 'unifound_items';
const ADMIN_KEY = 'unifound_admin';
const SESSION_KEY = 'unifound_session';
const PER_PAGE = 12;
const MAX_PHOTOS = 5;
const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];
const LIST_SELECTORS = {
	grid: '.grid',
	pager: '.pager',
	bar: '.bar',
	search: '.bar input[type="search"]',
	campus: '.bar select[aria-label="Campus"]',
	month: '.bar select[aria-label="Month"]',
	year: '.bar input.year',
	sort: '.bar select[aria-label="Sort"]',
	overlay: '#details',
	close: '#details .close'
};
const NAV_BTN_CSS = 'position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center;';
const BRIDGE_CSS = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';

const page = document.body.dataset.page;
const isListPage = page === 'admin-dashboard' || page === 'admin-retrieved';
const isRetrievedPage = page === 'admin-retrieved';
const els = {};

// admin dashboard
let currentPage = 1;
let filteredItems = [];
let listReady = false;

let syncFrame = null;
let syncReady = false;
let pendingSync = null;
let lastSync = Promise.resolve(true);
const syncWaiters = new Map();

let pendingImages = [];
let initialImages = [];
let uploading = 0;
let submitting = false;
let uploadQueue = Promise.resolve();

// The UNIFIED STORAGE SYSTEM RELOADED (USSR)
function unpack(raw) {
	try {
		let p = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (typeof p === 'string') p = JSON.parse(p);
		const items = [p, p?.items, p?.[LS_KEY]].find(Array.isArray);
		return items ? { version: items === p ? 0 : Number(p.version) || 0, items } : null;
	} catch {
		return null;
	}
}

function setName(key, value) {
	try {
		let store = {};
		try { store = JSON.parse(window.name) || {}; } catch {}
		if (value === undefined) delete store[key];
		else store[key] = value;
		window.name = JSON.stringify(store);
	} catch {}
}

function getItems() {
	// localstorage > ussr > sessionstorage
	const best = [
		() => localStorage.getItem(LS_KEY),
		() => {
			const named = window.name.includes(LS_KEY) && JSON.parse(window.name);
			return named && (named[LS_KEY] || named);
		},
		() => sessionStorage.getItem(LS_KEY)
	]
		.map((read, rank) => {
			try {
				const p = unpack(read());
				return p && { ...p, rank };
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.sort((a, b) => b.version - a.version || a.rank - b.rank)[0];

	if (!best) return [];
	if (best.rank) {
		try { localStorage.setItem(LS_KEY, JSON.stringify({ version: best.version, items: best.items })); } catch {}
	}
	return best.items;
}

function getItem(id) {
	return getItems().find(i => String(i.id) === String(id)) || null;
}

function post(type, data) {
	if (syncReady) {
		try {
			syncFrame.contentWindow.postMessage({ type, data }, '*');
			return;
		} catch {}
	}
	pendingSync = { type, data };
}

function syncAdminData(payload) {
	return new Promise(resolve => {
		const done = ok => {
			clearTimeout(timer);
			syncWaiters.delete(payload.version);
			resolve(ok);
		};
		const timer = setTimeout(() => done(false), 2500);
		syncWaiters.set(payload.version, done);
		post('UNIFOUND_SYNC_SAVE', JSON.stringify(payload));
	});
}

function saveItems(arr) {
	const items = Array.isArray(arr) ? arr : [];
	const version = Date.now();
	const payload = { version, items };
	const json = JSON.stringify(payload);

	const attempts = [
		json,
		JSON.stringify({ version, items: items.map((it, idx) => idx < 3 ? it : { ...it, images: [] }) }),
		JSON.stringify({ version, items: items.map(it => ({ ...it, images: [] })) })
	];
	for (const attempt of attempts) {
		try {
			localStorage.setItem(LS_KEY, attempt);
			break;
		} catch {}
	}

	setName(LS_KEY, payload);
	try { sessionStorage.setItem(LS_KEY, json); } catch {}

	try {
		const bc = new BroadcastChannel('unifound_bus');
		bc.postMessage({ type: 'UNIFOUND_DATA_CHANGED', version });
		bc.close();
	} catch {}

	lastSync = syncAdminData(payload);
}

window.addEventListener('message', e => {
	const { type, data } = e.data || {};

	if (type === 'UNIFOUND_SYNC_READY') {
		syncReady = true;
		let seed = null;
		try { seed = localStorage.getItem(LS_KEY); } catch {}
		const next = pendingSync || {
			type: 'UNIFOUND_SYNC_INIT',
			data: seed || JSON.stringify({ version: 0, items: getItems() })
		};
		pendingSync = null;
		post(next.type, next.data);
	} else if (type === 'UNIFOUND_PULL_RESPONSE') {
		const payload = unpack(data);
		if (!payload) return;
		const json = JSON.stringify(payload);
		try { localStorage.setItem(LS_KEY, json); } catch {}
		try { sessionStorage.setItem(LS_KEY, json); } catch {}
		setName(LS_KEY, payload);
		loadData();
	} else if (type === 'UNIFOUND_SYNC_SAVED') {
		syncWaiters.get(data)?.(true);
	}
});

try {
	new BroadcastChannel('unifound_bus').onmessage = e => {
		if (e.data?.type === 'UNIFOUND_DATA_CHANGED') loadData();
	};
} catch {}

window.addEventListener('storage', e => {
	if (e.key === LS_KEY) loadData();
});

const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function parseItemDate(value) {
	const s = String(value || '').trim();
	// YYYY-MM-DD (sysdef)
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) return { year: +m[1], monthIndex: m[2] - 1, day: +m[3] };
	// MM/DD/YYYY (philippine standard)
	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (m) return { year: +m[3], monthIndex: m[1] - 1, day: +m[2] };
	const d = new Date(s);
	return isNaN(d.getTime())
		? { year: null, monthIndex: null, day: null }
		: { year: d.getFullYear(), monthIndex: d.getMonth(), day: d.getDate() };
}

function formatDate(value) {
	if (!value) return '—';
	const { year, monthIndex, day } = parseItemDate(value);
	return year && monthIndex !== null && day
		? `${String(monthIndex + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
		: esc(value);
}

function esc(value) {
	return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function shortId(id) {
	return String(id || '').replace('UF-', '').slice(-4);
}

try {
	if (!localStorage.getItem(ADMIN_KEY)) {
		localStorage.setItem(ADMIN_KEY, JSON.stringify({ username: 'admin', password: 'unifound2026' }));
	}
} catch {}

function isAuthenticated() {
	try {
		if (sessionStorage.getItem(SESSION_KEY) === 'active' || localStorage.getItem(SESSION_KEY) === 'active') return true;
	} catch {}
	try {
		return JSON.parse(window.name)?.[SESSION_KEY] === 'active';
	} catch {
		return false;
	}
}

function setSession(active) {
	try { active ? sessionStorage.setItem(SESSION_KEY, 'active') : sessionStorage.removeItem(SESSION_KEY); } catch {}
	try { active ? localStorage.setItem(SESSION_KEY, 'active') : localStorage.removeItem(SESSION_KEY); } catch {}
	setName(SESSION_KEY, active ? 'active' : undefined);
}

if (page?.startsWith('admin-') && page !== 'admin-login' && !isAuthenticated()) {
	window.location.href = 'login.html';
}

document.querySelectorAll('a.pill.out[href="login.html"]').forEach(link => {
	link.addEventListener('click', () => setSession(false));
});

function adminLogin(e) {
	e?.preventDefault?.();
	e?.stopPropagation?.();

	const userEl = document.getElementById('user');
	const passEl = document.getElementById('pass');
	const form = document.querySelector('form');
	const username = (userEl?.value || '').trim();
	const password = passEl?.value || '';
	const lower = username.toLowerCase();

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
	try { creds = JSON.parse(localStorage.getItem(ADMIN_KEY)) || creds; } catch {}

	let problem = null;
	if (!username && !password) problem = ['Please enter both username and password.', [userEl, passEl]];
	else if (!username) problem = ['Invalid username: username cannot be blank.', [userEl]];
	else if (!password) problem = ['Invalid password: password cannot be blank.', [passEl]];
	else if (lower !== creds.username.toLowerCase() && lower !== 'admin') problem = ['Invalid username: username does not exist.', [userEl]];
	else if (password !== creds.password && !(lower === 'admin' && ['admin', 'unifound2026'].includes(password))) problem = ['Invalid password: password is incorrect.', [passEl]];

	if (problem) {
		const [message, fields] = problem;
		fields.forEach(f => f?.classList.add('field--error'));
		if (err) {
			err.textContent = message;
			err.style.display = 'block';
		}
		fields[0]?.focus();
		return false;
	}

	if (err) err.style.display = 'none';
	setSession(true);
	window.location.href = 'dashboard.html';
	return true;
}

if (page === 'admin-login') {
	const form = document.querySelector('form');
	form?.removeAttribute('action');
	form?.addEventListener('submit', adminLogin);
	document.getElementById('login-btn')?.addEventListener('click', adminLogin);
}

function searchItem() {
	currentPage = 1;
	loadData();
}

function switchItemList(target) {
	if (target === 'retrieved' && page !== 'admin-retrieved') window.location.href = 'retrieved.html';
	else if (target === 'lost' && page !== 'admin-dashboard') window.location.href = 'dashboard.html';
}

function changePage(newPage) {
	currentPage = newPage;
	render();
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadData() {
	if (!isListPage) return;

	if (!listReady) {
		listReady = true;
		for (const [key, selector] of Object.entries(LIST_SELECTORS)) els[key] = document.querySelector(selector);

		if (els.bar && !els.sort) {
			els.sort = document.createElement('select');
			els.sort.setAttribute('aria-label', 'Sort');
			els.sort.setAttribute('autocomplete', 'off');
			els.sort.innerHTML = [
				'<option value="newest">Newest First</option>',
				'<option value="oldest">Oldest First</option>',
				'<option value="az">Name A–Z</option>',
				'<option value="za">Name Z–A</option>'
			].join('');
			els.bar.appendChild(els.sort);
		}

		[[els.search, 'input'], [els.campus, 'change'], [els.month, 'change'], [els.year, 'input'], [els.sort, 'change']]
			.forEach(([el, type]) => el?.addEventListener(type, searchItem));

		document.querySelectorAll('.nav .pill.lf, .nav .pill.rt').forEach(pill => {
			pill.addEventListener('click', () => switchItemList(pill.classList.contains('rt') ? 'retrieved' : 'lost'));
		});

		els.grid?.addEventListener('click', e => {
			const card = e.target.closest('.card');
			if (!card) return;
			e.preventDefault();
			viewItem(card.dataset.id);
		});

		els.pager?.addEventListener('click', e => {
			const btn = e.target.closest('button[data-page]');
			if (btn) changePage(Number(btn.dataset.page));
		});

		els.close?.addEventListener('click', e => {
			e.preventDefault();
			els.overlay.classList.remove('open');
		});
		els.overlay?.addEventListener('click', e => {
			if (e.target === els.overlay) els.overlay.classList.remove('open');
		});
		document.addEventListener('keydown', e => {
			if (e.key === 'Escape') els.overlay?.classList.remove('open');
		});
	}

	const keyword = (els.search?.value || '').toLowerCase().trim();
	const idQuery = keyword.match(/^(?:id)?\s*#\s*(.+)$/i)?.[1] || '';
	const campus = (els.campus?.value || '').toLowerCase();
	const monthIndex = MONTHS.indexOf(els.month?.value);
	const year = els.year?.value ? parseInt(els.year.value, 10) : null;
	const byCampus = campus && campus !== 'all campuses';

	const items = getItems().filter(item => {
		if (isRetrievedPage ? item.status !== 'retrieved' : item.status && item.status !== 'unclaimed') return false;

		if (keyword && !(
			[item.name, item.area, item.campus, item.description].some(v => (v || '').toLowerCase().includes(keyword)) ||
			(idQuery && shortId(item.id).toLowerCase().includes(idQuery))
		)) return false;

		if (byCampus && (item.campus || '').toLowerCase() !== campus) return false;

		if (monthIndex !== -1 || year) {
			const d = parseItemDate(isRetrievedPage && item.dateRetrieved ? item.dateRetrieved : item.dateLost);
			if (monthIndex !== -1 && d.monthIndex !== monthIndex) return false;
			if (year && d.year !== year) return false;
		}
		return true;
	});

	const time = i => i.publishedAt || parseInt(String(i.id ?? '').replace(/\D/g, ''), 10) || 0;
	const name = i => (i.name || '').toLowerCase();
	const sorter = {
		oldest: (a, b) => time(a) - time(b),
		az: (a, b) => name(a).localeCompare(name(b)),
		za: (a, b) => name(b).localeCompare(name(a))
	}[els.sort?.value] || ((a, b) => time(b) - time(a));

	filteredItems = items.sort(sorter);
	currentPage = Math.min(currentPage, Math.max(1, Math.ceil(filteredItems.length / PER_PAGE)));
	render();
}

function render() {
	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PER_PAGE));

	if (els.grid) {
		const start = (currentPage - 1) * PER_PAGE;
		const pageItems = filteredItems.slice(start, start + PER_PAGE);

		els.grid.innerHTML = pageItems.length
			? pageItems.map((item, idx) => {
				const done = item.status === 'retrieved';
				return `
			<article class="card${done ? ' done' : ''}" data-id="${esc(item.id)}" style="--i:${idx + 1};cursor:pointer">
				${item.images?.length
					? `<img src="${esc(item.images[0])}" alt="${esc(item.name)}" style="flex:none;width:132px;height:168px;object-fit:cover;border-radius:14px;border:1px solid var(--line);">`
					: '<div class="ph"></div>'}
				<div class="card-body">
					<h3>${esc(item.name)}</h3>
					<span>Place: ${esc(item.campus)}</span>
					<span>Area: ${esc(item.area)}</span>
					${done
						? `<span>Date Lost: ${formatDate(item.dateLost)}</span><span>Date Retrieved: ${formatDate(item.dateRetrieved)}</span>`
						: `<span>Date: ${formatDate(item.dateLost)}</span>`}
					<a class="more" href="#details" data-id="${esc(item.id)}">View Full Details &rarr;</a>
				</div>
			</article>`;
			}).join('')
			: '<p style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;color:#888;font-size:1.05rem">No items found.</p>';
	}

	if (els.pager) {
		const btn = (label, target, attrs = '') => `<button type="button" data-page="${target}"${attrs}>${label}</button>`;
		els.pager.innerHTML =
			btn('Previous', currentPage - 1, currentPage === 1 ? ' disabled' : '') +
			Array.from({ length: totalPages }, (_, k) => btn(k + 1, k + 1, k + 1 === currentPage ? ' class="on"' : '')).join('') +
			btn('Next', currentPage + 1, currentPage === totalPages ? ' disabled' : '');
	}
}

function popup(className, html, onClick) {
	const box = document.createElement('div');
	box.className = className;
	box.innerHTML = html;
	const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
	const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
	box.addEventListener('click', e => onClick(e, close));
	document.addEventListener('keydown', onKey, true);
	document.body.appendChild(box);
	return box;
}

function viewItem(id) {
	const item = getItem(id);
	const dialog = els.overlay?.querySelector('.dialog');
	if (!item || !dialog) return;

	const done = item.status === 'retrieved';
	dialog.classList.toggle('done', done);

	const gallery = dialog.querySelector('.gallery');
	if (gallery) {
		const images = item.images || [];
		let idx = 0;

		const paint = () => {
			if (!images.length) {
				gallery.innerHTML = '<span class="count">0/0</span><div class="ph"></div><button class="view" type="button" disabled>VIEW IMAGE</button>';
				return;
			}

			gallery.innerHTML = `
					<span class="count">${idx + 1}/${images.length}</span>
					<img src="${esc(images[idx])}" alt="${esc(item.name)}" style="width:100%;height:100%;object-fit:cover">
					<button class="view" type="button">VIEW IMAGE</button>
				`;

			if (images.length > 1) {
				gallery.style.position = 'relative';
				[['‹', 'left', -1], ['›', 'right', 1]].forEach(([label, side, step]) => {
					const b = document.createElement('button');
					b.type = 'button';
					b.textContent = label;
					b.style.cssText = `${NAV_BTN_CSS}${side}:4px;`;
					b.onclick = e => {
						e.stopPropagation();
						idx = (idx + step + images.length) % images.length;
						paint();
					};
					gallery.appendChild(b);
				});
			}

			gallery.querySelector('.view').addEventListener('click', e => {
				e.stopPropagation();
				const box = popup('lightbox', '<button class="close" type="button" aria-label="Close">✕</button><img alt="">', (ev, close) => close());
				Object.assign(box.querySelector('img'), { src: images[idx], alt: item.name || 'Item photo' });
			});
		};
		paint();
	}

	const info = dialog.querySelector('.info');
	if (info) {
		const code = shortId(item.id);
		const iconBtn = (cls, label, icon) =>
			`<button class="round ${cls}" type="button" aria-label="${label}" data-id="${esc(id)}"><img class="icon" src="../assets/icons/${icon}.svg" alt=""></button>`;

		const claimHtml = page === 'admin-dashboard' && !done
			? `
				<div class="claim claimbox" style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px">
					<p style="font-weight:700;margin-bottom:12px;color:var(--navy,#1e293b)">Mark as Retrieved (Private Record)</p>
					<form id="retriever-form" style="display:flex;flex-direction:column;gap:10px">
						<div>
							<label for="ret-name" style="font-size:.85rem;font-weight:600">Retriever Name <span style="color:#ef4444">*</span></label>
							<input id="ret-name" class="field" type="text" placeholder="Full name of retriever" required style="width:100%;margin-top:4px">
						</div>
						<div>
							<label for="ret-contact" style="font-size:.85rem;font-weight:600">Retriever Contact <span style="color:#ef4444">*</span></label>
							<input id="ret-contact" class="field" type="text" placeholder="Phone or email" required style="width:100%;margin-top:4px">
						</div>
						<div>
							<label for="ret-note" style="font-size:.85rem;font-weight:600">Notes <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
							<textarea id="ret-note" class="field" rows="2" placeholder="ID presented, claim details..." style="width:100%;margin-top:4px"></textarea>
						</div>
						<div id="retriever-err" style="color:#dc2626;font-size:.85rem;display:none;font-weight:500"></div>
						<div class="acts" style="margin-top:8px;display:flex;align-items:center;gap:10px">
							<button class="btn yellow" type="submit" style="display:inline-flex;align-items:center;gap:6px">Mark as Retrieved</button>
							<span class="spacer" style="flex:1"></span>
							${iconBtn('edit', 'Edit item', 'edit')}
							${iconBtn('del', 'Delete item', 'trash')}
						</div>
					</form>
				</div>`
			: `
				<div class="claim" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-top:16px">
					<p style="font-weight:700;margin-bottom:10px;color:#15803d">Private Retrieval Record (Admin Only)</p>
					<div style="display:flex;flex-direction:column;gap:6px;font-size:.9rem;color:#1f2937">
						<span><b>Retriever Name:</b> ${esc(item.retrieverName) || '—'}</span>
						<span><b>Retriever Contact:</b> ${esc(item.retrieverContact) || '—'}</span>
						<span><b>Notes:</b> ${esc(item.retrieverNote) || '—'}</span>
					</div>
					<div class="acts" style="margin-top:12px;display:flex;align-items:center;gap:8px">
						<span class="spacer" style="flex:1"></span>
						${done ? '' : iconBtn('edit', 'Edit item', 'edit')}
						${iconBtn('del', 'Delete item', 'trash')}
					</div>
				</div>`;

		info.innerHTML = `
			<h2 id="item-title">${esc(item.name)} <span>${code ? 'ID#' + esc(code) : ''}</span></h2>
			<b>Item Description:</b>
			<p class="desc">${esc(item.description)}</p>
			<div class="meta">
				<span><b>Place:</b> ${esc(item.campus)}</span>
				<span><b>Status:</b> ${done ? '<span class="ok">Retrieved</span>' : '<span class="bad">UNCLAIMED</span>'}</span>
				<span><b>Area:</b> ${esc(item.area)}</span>
				<span></span>
				<span><b>Date Lost:</b> ${formatDate(item.dateLost)}</span>
				${done && item.dateRetrieved ? `<span><b>Date Retrieved:</b> ${formatDate(item.dateRetrieved)}</span>` : ''}
			</div>
			${claimHtml}
		`;

		info.onclick = e => {
			const btn = e.target.closest('.round.edit, .round.del');
			if (btn) (btn.classList.contains('edit') ? editItem : deleteItem)(btn.dataset.id || id);
		};

		const retForm = info.querySelector('#retriever-form');
		retForm?.addEventListener('submit', e => {
			e.preventDefault();
			const val = selector => retForm.querySelector(selector).value.trim();
			const retrieverName = val('#ret-name');
			const retrieverContact = val('#ret-contact');
			const retrieverNote = val('#ret-note');
			const errEl = retForm.querySelector('#retriever-err');

			const validContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(retrieverContact) ||
				(retrieverContact.length >= 11 && retrieverContact.length <= 16 && /^[0-9 +\-]+$/.test(retrieverContact) && /\d/.test(retrieverContact));

			if (!retrieverName || !validContact) {
				errEl.textContent = !retrieverName
					? 'Please provide the retriever name.'
					: 'Enter a valid email or a phone with 11–16 characters (digits, spaces, plus, or hyphen).';
				errEl.style.display = 'block';
				return;
			}
			errEl.style.display = 'none';

			markRetrieved(id, { retrieverName, retrieverContact, retrieverNote });
		});
	}

	els.overlay.classList.add('open');
}

function markRetrieved(id, details) {
	const items = getItems();
	const item = items.find(i => String(i.id) === String(id));
	if (!item) return;

	Object.assign(item, {
		status: 'retrieved',
		dateRetrieved: todayISO(),
		retrieverName: details.retrieverName,
		retrieverContact: details.retrieverContact,
		retrieverNote: details.retrieverNote
	});
	saveItems(items);

	els.overlay?.classList.remove('open');
	loadData();
	showToast('Item marked as retrieved!');
}

function deleteItem(id) {
	const box = popup('confirm-overlay', `
		<div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
			<h2 id="confirm-title">Delete this item?</h2>
			<p id="confirm-text">Are you sure you want to delete this item record? This cannot be undone.</p>
			<div class="confirm-actions">
				<button class="btn grey" type="button" data-act="cancel">Cancel</button>
				<button class="btn danger" type="button" data-act="confirm">Delete</button>
			</div>
		</div>`, (e, close) => {
		const act = e.target.dataset.act;
		if (e.target === box || act === 'cancel') {
			close();
		} else if (act === 'confirm') {
			close();
			saveItems(getItems().filter(i => String(i.id) !== String(id)));
			els.overlay?.classList.remove('open');
			loadData();
			showToast('Item deleted.');
		}
	});
	box.querySelector('[data-act="cancel"]').focus();
}

function editItem(id) {
	const item = getItem(id);
	if (!item || item.status === 'retrieved') return;
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

function renderThumbs() {
	if (els.thumbs) {
		els.thumbs.innerHTML = pendingImages.map((src, i) =>
			`<div style="position:relative;display:inline-block"><img src="${esc(src)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid #cbd5e1;display:block"><button type="button" data-i="${i}" style="position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:12px;line-height:18px;text-align:center;cursor:pointer;padding:0">&times;</button></div>`
		).join('') + `<span class="chips photo-count"><span>${pendingImages.length}/${MAX_PHOTOS}</span></span>`;
	}

	const busy = uploading > 0 || submitting;
	if (els.saveBtn) {
		els.saveBtn.disabled = busy || pendingImages.length === 0;
		els.saveBtn.setAttribute('aria-busy', String(busy));
	}
	if (els.resetBtn) els.resetBtn.disabled = busy;
	if (els.photos) els.photos.disabled = submitting;

	if (els.status) {
		const n = pendingImages.length;
		els.status.setAttribute('aria-busy', String(busy));
		els.status.textContent = submitting
			? 'Saving item…'
			: uploading > 0
				? `Loading ${uploading} photo${uploading === 1 ? '' : 's'}… Please wait before saving.`
				: n === 0
					? 'Add at least one photo to save this item.'
					: `${n} photo${n === 1 ? '' : 's'} ready. At least one is required.`;
	}
}

function validateItemField(input) {
	if (!input) return true;
	const valid = (input.value || '').trim() !== '';
	input.classList.toggle('field--error', !valid);

	let msg = input.nextElementSibling;
	if (!msg?.classList.contains('field-msg')) msg = null;

	if (valid) {
		msg?.remove();
	} else if (!msg) {
		msg = document.createElement('span');
		msg.className = 'field-msg';
		msg.style.cssText = 'color:#dc2626;font-size:0.82rem;margin-top:4px;display:block';
		msg.textContent = 'This field is required.';
		input.insertAdjacentElement('afterend', msg);
	}
	return valid;
}

function compressImage(file, max = 800, quality = 0.75) {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.onerror = () => resolve(null);
		reader.onload = () => {
			const img = new Image();
			img.onerror = () => resolve(reader.result);
			img.onload = () => {
				try {
					const scale = Math.min(1, max / img.width, max / img.height);
					const canvas = document.createElement('canvas');
					canvas.width = Math.round(img.width * scale);
					canvas.height = Math.round(img.height * scale);
					canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL('image/jpeg', quality));
				} catch {
					resolve(reader.result);
				}
			};
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	});
}

async function uploadItemImage(files) {
	const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
	const room = Math.max(0, MAX_PHOTOS - pendingImages.length - uploading);
	const toLoad = Array.from(files || [])
		.filter(file => allowed.includes(file.type.toLowerCase()))
		.slice(0, room);
	if (!toLoad.length) return;

	uploading += toLoad.length;
	renderThumbs();

	const batch = uploadQueue.then(async () => {
		for (const file of toLoad) {
			const dataUrl = await compressImage(file).catch(() => null);
			if (dataUrl && pendingImages.length < MAX_PHOTOS) {
				pendingImages.push(dataUrl);
				renderThumbs();
			}
		}
	});
	uploadQueue = batch.catch(() => {});

	try {
		await batch;
	} finally {
		uploading -= toLoad.length;
		renderThumbs();
	}
}

function resetItemForm() {
	pendingImages = [...initialImages];
	setTimeout(() => {
		const dateInput = document.getElementById('date');
		if (dateInput) dateInput.value = todayISO();
		document.querySelectorAll('.field--error').forEach(f => f.classList.remove('field--error'));
		document.querySelectorAll('.field-msg').forEach(m => m.remove());
		if (els.errP) els.errP.style.display = 'none';
		renderThumbs();
	}, 0);
}

function initAdminAddPage() {
	const form = document.getElementById('item-form') || document.querySelector('form');
	const drop = document.querySelector('label.drop') || document.getElementById('drop-area');
	const field = Object.fromEntries(['name', 'desc', 'place', 'area', 'date'].map(id => [id, document.getElementById(id)]));

	Object.assign(els, {
		thumbs: document.querySelector('.thumbs'),
		photos: document.getElementById('photos'),
		status: document.getElementById('photo-status'),
		errP: document.querySelector('.form-foot .err'),
		saveBtn: document.getElementById('save-btn') || form?.querySelector('button[type="submit"]'),
		resetBtn: form?.querySelector('button[type="reset"]')
	});
	submitting = false;

	if (field.date && !field.date.value) field.date.value = todayISO();
	if (els.errP) els.errP.style.display = 'none';

	const editId = new URLSearchParams(window.location.search).get('edit');
	const editing = editId ? getItem(editId) : null;
	if (editing?.status === 'retrieved') {
		window.location.replace('retrieved.html');
		return;
	}

	if (editing) {
		document.title = 'UniFound Admin – Edit Item';
		if (els.saveBtn) els.saveBtn.innerHTML = '<img class="icon" src="../assets/icons/lock-white.svg" alt=""> SAVE CHANGES';

		Object.entries({
			name: editing.name || '',
			desc: editing.description || '',
			place: editing.campus || 'Main Campus',
			area: editing.area || '',
			date: editing.dateLost || todayISO()
		}).forEach(([key, value]) => { if (field[key]) field[key].value = value; });

		pendingImages = Array.isArray(editing.images) ? [...editing.images] : [];
	} else {
		pendingImages = [];
	}
	initialImages = [...pendingImages];
	renderThumbs();

	els.thumbs?.addEventListener('click', e => {
		const btn = e.target.closest('button[data-i]');
		if (!btn) return;
		e.preventDefault();
		pendingImages.splice(Number(btn.dataset.i), 1);
		renderThumbs();
	});

	els.photos?.addEventListener('change', e => {
		void uploadItemImage(e.target.files);
		e.target.value = '';
	});

	if (drop) {
		['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => {
			e.preventDefault();
			drop.style.background = '#e0f2fe';
		}));
		['dragleave', 'dragend'].forEach(type => drop.addEventListener(type, () => { drop.style.background = ''; }));
		drop.addEventListener('drop', e => {
			e.preventDefault();
			drop.style.background = '';
			void uploadItemImage(e.dataTransfer.files);
		});
	}

	document.querySelectorAll('.field[required]').forEach(f => f.addEventListener('blur', () => validateItemField(f)));
	form?.addEventListener('reset', resetItemForm);

	const submit = async e => {
		e?.preventDefault?.();
		e?.stopPropagation?.();
		if (submitting) return false;

		for (const f of [field.name, field.desc]) {
			if (!(f?.value || '').trim()) {
				validateItemField(f);
				f?.focus();
				if (els.errP) els.errP.style.display = 'block';
				return false;
			}
		}
		if (els.errP) els.errP.style.display = 'none';

		submitting = true;
		renderThumbs();

		try {
			await uploadQueue;
			if (pendingImages.length === 0) {
				submitting = false;
				renderThumbs();
				return false;
			}

			const items = getItems();
			const values = {
				name: field.name.value.trim(),
				description: field.desc.value.trim(),
				campus: field.place?.value || 'Main Campus',
				area: (field.area?.value || '').trim() || 'Campus Grounds',
				dateLost: (field.date?.value || '').trim() || todayISO(),
				images: [...pendingImages]
			};

			if (editing) {
				const target = items.find(i => String(i.id) === String(editId));
				if (target?.status === 'retrieved') {
					window.location.href = 'retrieved.html';
					return false;
				}
				if (target) Object.assign(target, values);
			} else {
				const now = Date.now();
				items.unshift({
					id: 'UF-' + now,
					...values,
					dateRetrieved: null,
					status: 'unclaimed',
					retrieverName: null,
					retrieverContact: null,
					retrieverNote: null,
					publishedAt: now
				});
			}

			saveItems(items);
			await lastSync;
			pendingImages = [];
		} catch (err) {
			console.error('Save error:', err);
			submitting = false;
			renderThumbs();
		}

		window.location.href = 'dashboard.html';
		return false;
	};

	form?.addEventListener('submit', submit);
	els.saveBtn?.addEventListener('click', submit);
}

// global exports
Object.assign(window, {
	searchItem,
	campusFilter: searchItem,
	viewItem,
	switchItemList,
	changePage,
	adminLogin,
	validateItemField,
	uploadItemImage,
	resetItemForm,
	loadData,
	markRetrieved,
	deleteItem,
	editItem
});

function boot() {
	syncFrame = Object.assign(document.createElement('iframe'), {
		id: 'unifound-admin-sync-bridge',
		src: 'sync.html?v=20261122b',
		title: 'Storage synchronization'
	});
	syncFrame.style.cssText = BRIDGE_CSS;
	document.body.appendChild(syncFrame);

	if (isListPage) loadData();
	else if (page === 'admin-add') initAdminAddPage();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}

window.addEventListener('pageshow', e => {
	if (e.persisted) loadData();
});
'use strict';

const STORAGE_KEY = 'unifound_items';
const PER_PAGE = 6;
const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];
const SORT_OPTIONS = ['Newest First', 'Oldest First', 'Name A–Z', 'Name Z–A'];
const SELECTORS = {
	grid: '.grid',
	pager: '.pager',
	bar: '.bar',
	search: 'input[type="search"]',
	campus: 'select[aria-label="Campus"]',
	month: 'select[aria-label="Month"]',
	year: 'input.year',
	sort: 'select[aria-label="Sort"]',
	overlay: '#details'
};
const NAV_BTN_CSS = 'position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center;';
const BRIDGE_CSS = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';

const els = {};
let allStored = [];
let allItems = [];
let filteredItems = [];
let currentPage = 1;
let isRetrieved = false;
let ready = false;
let linkedItemId = new URLSearchParams(window.location.search).get('item');

function unpack(raw) {
	try {
		let p = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (typeof p === 'string') p = JSON.parse(p);
		const items = [p, p?.items, p?.[STORAGE_KEY]].find(Array.isArray);
		return items ? { version: items === p ? 0 : Number(p.version) || 0, items } : null;
	} catch {
		return null;
	}
}

function persist(version, items) {
	const payload = { version, items };
	const json = JSON.stringify(payload);
	try { localStorage.setItem(STORAGE_KEY, json); } catch {}
	try { sessionStorage.setItem(STORAGE_KEY, json); } catch {}
	try {
		let store = {};
		try { store = JSON.parse(window.name) || {}; } catch {}
		store[STORAGE_KEY] = payload;
		window.name = JSON.stringify(store);
	} catch {}
}

function readStorage() {
	const best = [
		() => localStorage.getItem(STORAGE_KEY),
		() => {
			const named = window.name.includes(STORAGE_KEY) && JSON.parse(window.name);
			return named && (named[STORAGE_KEY] || named);
		},
		() => sessionStorage.getItem(STORAGE_KEY)
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
	if (best.rank) persist(best.version, best.items);
	return best.items;
}

function parseItemDate(value) {
	const s = String(value || '').trim();
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) return { year: +m[1], monthIndex: m[2] - 1, day: +m[3] };
	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (m) return { year: +m[3], monthIndex: m[1] - 1, day: +m[2] };
	const d = new Date(s);
	return isNaN(d.getTime())
		? { year: null, monthIndex: null, day: null }
		: { year: d.getFullYear(), monthIndex: d.getMonth(), day: d.getDate() };
}

function fmtDate(value) {
	if (!value) return '—';
	const { year, monthIndex, day } = parseItemDate(value);
	return year && monthIndex !== null && day
		? `${String(monthIndex + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
		: esc(value);
}

function shortId(id) {
	return String(id || '').replace('UF-', '').slice(-4);
}

function esc(value) {
	return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function applyFilters() {
	const keyword = els.search?.value.trim().toLowerCase() || '';
	const idQuery = keyword.match(/^(?:id)?\s*#\s*(.+)$/i)?.[1] || '';
	const campus = (els.campus?.value || '').toLowerCase();
	const monthIndex = MONTH_NAMES.indexOf(els.month?.value);
	const year = parseInt(els.year?.value.trim(), 10);
	const byCampus = campus && campus !== 'all campuses';
	const byDate = monthIndex !== -1 || !isNaN(year);

	const result = allItems.filter(item => {
		if (keyword && !(
			[item.name, item.area, item.campus, item.description].some(v => (v || '').toLowerCase().includes(keyword)) ||
			(idQuery && shortId(item.id).toLowerCase().includes(idQuery))
		)) return false;

		if (byCampus && (item.campus || '').toLowerCase() !== campus) return false;

		if (byDate) {
			const d = parseItemDate(isRetrieved && item.dateRetrieved ? item.dateRetrieved : item.dateLost);
			if (monthIndex !== -1 && d.monthIndex !== monthIndex) return false;
			if (!isNaN(year) && d.year !== year) return false;
		}
		return true;
	});

	const time = i => i.publishedAt || parseInt(String(i.id ?? '').replace(/\D/g, ''), 10) || 0;
	const name = i => (i.name || '').toLowerCase();
	const sorter = {
		'Oldest First': (a, b) => time(a) - time(b),
		'Name A–Z': (a, b) => name(a).localeCompare(name(b)),
		'Name Z–A': (a, b) => name(b).localeCompare(name(a))
	}[els.sort?.value] || ((a, b) => time(b) - time(a));

	return result.sort(sorter);
}

function rerender() {
	filteredItems = applyFilters();
	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PER_PAGE));
	if (currentPage > totalPages) currentPage = 1;
	const start = (currentPage - 1) * PER_PAGE;

	//card grids
	if (els.grid) {
		els.grid.innerHTML = filteredItems.length
			? filteredItems.slice(start, start + PER_PAGE).map((item, i) => [
				`<article class="card${isRetrieved ? ' done' : ''}" data-id="${esc(item.id)}" style="--i:${i + 1};cursor:pointer">`,
				item.images?.length
					? `<img src="${esc(item.images[0])}" alt="${esc(item.name || 'Item photo')}" style="flex:none;width:132px;height:168px;object-fit:cover;border-radius:14px;border:1px solid var(--line);">`
					: '<div class="ph"></div>',
				'<div class="card-body">',
				`<h3>${esc((item.name || '').toUpperCase())}</h3>`,
				`<span>Place: ${esc(item.campus || 'Main Campus')}</span>`,
				`<span>Area: ${esc(item.area || '—')}</span>`,
				`<span>Date Lost: ${fmtDate(item.dateLost)}</span>`,
				isRetrieved && item.dateRetrieved ? `<span>Date Retrieved: ${fmtDate(item.dateRetrieved)}</span>` : '',
				`<a class="more" href="?item=${encodeURIComponent(item.id)}#details">View Full Details &rarr;</a>`,
				'</div></article>'
			].join('')).join('')
			: '<p style="grid-column:1/-1;padding:40px 0;text-align:center;color:var(--muted);font-size:1.1rem;">No items found.</p>';
	}

	// pagination
	if (els.pager) {
		const btn = (label, page, attrs = '') => `<button type="button" data-page="${page}"${attrs}>${label}</button>`;
		els.pager.innerHTML =
			btn('Previous', currentPage - 1, currentPage === 1 ? ' class="disabled" disabled' : '') +
			Array.from({ length: totalPages }, (_, k) => btn(k + 1, k + 1, k + 1 === currentPage ? ' class="on"' : '')).join('') +
			btn('Next', currentPage + 1, currentPage === totalPages ? ' class="disabled" disabled' : '');
	}
}

// events
function searchItem() {
	currentPage = 1;
	rerender();
}

function switchItemList(target) {
	if (target !== document.body.dataset.page) {
		window.location.href = target === 'retrieved' ? 'retrieved.html' : 'index.html';
	}
}

function changePage(pageNum) {
	if (pageNum < 1 || pageNum > Math.max(1, Math.ceil(filteredItems.length / PER_PAGE))) return;
	currentPage = pageNum;
	rerender();
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function viewItem(id) {
	const item = allStored.find(i => String(i.id) === String(id));
	const overlay = els.overlay;
	if (!item || !overlay) return;

	const done = item.status === 'retrieved';
	const code = shortId(item.id);

	const title = document.getElementById('item-title');
	if (title) title.innerHTML = `${esc(item.name)} <span>${code ? 'ID#' + esc(code) : ''}</span>`;

	const desc = overlay.querySelector('.desc');
	if (desc) desc.textContent = item.description || '';

	const meta = overlay.querySelector('.meta');
	if (meta) {
		meta.innerHTML = [
			`<span><b>Place:</b> ${esc(item.campus || 'Main Campus')}</span>`,
			`<span><b>Status:</b> ${done ? '<span class="ok">RETRIEVED</span>' : '<span class="bad">UNCLAIMED</span>'}</span>`,
			`<span><b>Area:</b> ${esc(item.area || '—')}</span>`,
			done && item.dateRetrieved ? `<span><b>Date Retrieved:</b> ${fmtDate(item.dateRetrieved)}</span>` : '<span></span>',
			`<span><b>Date Lost:</b> ${fmtDate(item.dateLost)}</span>`
		].join('');
	}

	const gallery = overlay.querySelector('.gallery');
	if (gallery) {
		const count = gallery.querySelector('.count');
		const viewBtn = gallery.querySelector('.view');
		const images = item.images || [];
		let active = 0;

		gallery.querySelectorAll('img, .ph, .gallery-nav').forEach(el => el.remove());

		const media = document.createElement(images.length ? 'img' : 'div');
		if (images.length) {
			media.src = images[0];
			media.alt = item.name || 'Item photo';
			media.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
		} else {
			media.className = 'ph';
		}
		gallery.insertBefore(media, count);

		if (count) count.textContent = images.length ? `1/${images.length}` : '';
		if (viewBtn) {
			viewBtn.style.display = images.length ? '' : 'none';
			viewBtn.disabled = false;
			viewBtn.onclick = () => openLightbox(images[active], item.name);
		}

		if (images.length > 1) {
			gallery.style.position = 'relative';
			[['‹', 'left', -1], ['›', 'right', 1]].forEach(([label, side, step]) => {
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'gallery-nav';
				b.textContent = label;
				b.style.cssText = `${NAV_BTN_CSS}${side}:4px;`;
				b.onclick = e => {
					e.stopPropagation();
					active = (active + step + images.length) % images.length;
					media.src = images[active];
					if (count) count.textContent = `${active + 1}/${images.length}`;
				};
				gallery.appendChild(b);
			});
		}
	}

	overlay.querySelector('.dialog')?.classList.toggle('done', done);
	overlay.classList.add('open');
}

function openLightbox(src, alt) {
	const box = document.createElement('div');
	box.className = 'lightbox';
	box.innerHTML = '<button class="close" type="button" aria-label="Close">✕</button><img alt="">';
	Object.assign(box.querySelector('img'), { src, alt: alt || 'Item photo' });
	const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
	const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
	box.addEventListener('click', close);
	document.addEventListener('keydown', onKey, true);
	document.body.appendChild(box);
}

function setData(items) {
	allStored = items;
	allItems = items.filter(i => isRetrieved ? i.status === 'retrieved' : !i.status || i.status === 'unclaimed');
	rerender();

	const linked = linkedItemId && items.find(i => String(i.id) === String(linkedItemId));
	if (linked) {
		linkedItemId = null;
		viewItem(linked.id);
	}
}

// init checkpoint
function loadData() {
	isRetrieved = document.body.dataset.page === 'retrieved';

	if (!ready) {
		ready = true;
		for (const [key, selector] of Object.entries(SELECTORS)) els[key] = document.querySelector(selector);

		if (els.bar && !els.sort) {
			els.sort = document.createElement('select');
			els.sort.setAttribute('aria-label', 'Sort');
			els.sort.setAttribute('autocomplete', 'off');
			els.sort.innerHTML = SORT_OPTIONS.map(o => `<option>${o}</option>`).join('');
			els.bar.appendChild(els.sort);
		}

		[[els.search, 'input'], [els.campus, 'change'], [els.month, 'change'], [els.year, 'input']]
			.forEach(([el, type]) => el?.addEventListener(type, searchItem));
		els.sort?.addEventListener('change', rerender);

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

		els.overlay?.addEventListener('click', e => {
			if (e.target === els.overlay || e.target.closest('.close')) {
				e.preventDefault();
				els.overlay.classList.remove('open');
			}
		});

		document.addEventListener('keydown', e => {
			if (e.key === 'Escape') els.overlay?.classList.remove('open');
		});
	}

	let bridge = document.getElementById('unifound-sync-bridge');
	const pull = () => {
		try { bridge.contentWindow.postMessage({ type: 'UNIFOUND_PULL_REQUEST' }, '*'); } catch {}
	};
	if (bridge) {
		pull();
	} else {
		bridge = Object.assign(document.createElement('iframe'), {
			id: 'unifound-sync-bridge',
			src: 'admin/sync.html?v=20261122b',
			onload: pull
		});
		bridge.style.cssText = BRIDGE_CSS;
		document.body.appendChild(bridge);
	}

	setData(readStorage());
}

window.addEventListener('message', e => {
	if (e.data?.type !== 'UNIFOUND_PULL_RESPONSE') return;
	const p = unpack(e.data.data) || { version: 0, items: [] };
	persist(p.version, p.items);
	setData(p.items);
});

try {
	new BroadcastChannel('unifound_bus').onmessage = e => {
		if (e.data?.type === 'UNIFOUND_DATA_CHANGED') loadData();
	};
} catch {}

window.addEventListener('storage', e => {
	if (e.key === STORAGE_KEY) loadData();
});

//global exports 2
Object.assign(window, { searchItem, campusFilter: searchItem, viewItem, switchItemList, changePage, loadData });

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', loadData);
} else {
	loadData();
}

window.addEventListener('pageshow', e => {
	if (e.persisted) loadData();
});
'use strict';

const STORAGE_KEY = 'unifound_items';
const PER_PAGE		= 6;
const MONTH_NAMES = [
	'January','February','March','April','May','June',
	'July','August','September','October','November','December'
];

let allItems			= [];
let filteredItems = [];
let currentPage	 = 1;
let linkedItemId	= new URLSearchParams(window.location.search).get('item');

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
			if (Array.isArray(parsed[STORAGE_KEY])) {
				return { version: Number(parsed.version) || 0, items: parsed[STORAGE_KEY] };
			}
		}
	} catch (e) {}
	return null;
}

function readStorage() {
	let candidates = [];

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const p = unpackStoragePayload(raw);
		if (p) candidates.push({ source: 'localStorage', version: p.version, items: p.items });
	} catch (e) {
		console.warn('localStorage read notice:', e);
	}

	try {
		if (window.name && window.name.includes(STORAGE_KEY)) {
			const parsed = JSON.parse(window.name);
			if (parsed) {
				const p = unpackStoragePayload(parsed[STORAGE_KEY] || parsed);
				if (p) candidates.push({ source: 'window.name', version: p.version, items: p.items });
			}
		}
	} catch (e) {}

	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		const p = unpackStoragePayload(raw);
		if (p) candidates.push({ source: 'sessionStorage', version: p.version, items: p.items });
	} catch (e) {}

	if (candidates.length === 0) return [];

	candidates.sort((a, b) => {
		if (b.version !== a.version) return b.version - a.version;
		const priority = { 'localStorage': 3, 'window.name': 2, 'sessionStorage': 1 };
		return (priority[b.source] || 0) - (priority[a.source] || 0);
	});

	const best = candidates[0];

	if (best.source !== 'localStorage') {
		try {
			const jsonStr = JSON.stringify({ version: best.version, items: best.items });
			localStorage.setItem(STORAGE_KEY, jsonStr);
		} catch (e) {}
	}

	return Array.isArray(best.items) ? best.items : [];
}

function parseItemDate(dateStr) {
	if (!dateStr) return { year: null, monthIndex: null, day: null };
	const str = String(dateStr).trim();

	if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
		const parts = str.split('-');
		return {
			year: parseInt(parts[0], 10),
			monthIndex: parseInt(parts[1], 10) - 1,
			day: parseInt(parts[2], 10)
		};
	}

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

function fmtDate(iso) {
	if (!iso) return '—';
	const { year, monthIndex, day } = parseItemDate(iso);
	if (year && monthIndex !== null && day) {
		const mm = String(monthIndex + 1).padStart(2, '0');
		const dd = String(day).padStart(2, '0');
		return `${mm}/${dd}/${year}`;
	}
	return String(iso);
}

function shortId(id) {
	if (!id) return '';
	return String(id).replace('UF-', '').slice(-4);
}

function esc(value) {
	if (value === null || value === undefined) return '';
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function getFilters() {
	const searchInput	= document.querySelector('input[type="search"]');
	const campusSel		= document.querySelector('select[aria-label="Campus"]');
	const monthSel		= document.querySelector('select[aria-label="Month"]');
	const yearInput		= document.querySelector('input.year');
	const sortSel		= document.querySelector('select[aria-label="Sort"]');

	return {
		keyword	: (searchInput	? searchInput.value.trim().toLowerCase()	: ''),
		campus	: (campusSel	? campusSel.value							: 'All Campuses'),
		month	: (monthSel		? monthSel.value							: 'All Month'),
		year	: (yearInput	? yearInput.value.trim()					: ''),
		sort	: (sortSel		? sortSel.value								: 'Newest First'),
	};
}

function applyFilters() {
	const { keyword, campus, month, year, sort } = getFilters();

	let result = allItems.slice();

	if (keyword) {
		const idQuery = keyword.match(/^(?:id)?\s*#\s*(.+)$/i)?.[1] || '';
		result = result.filter(item =>
			(item.name || '').toLowerCase().includes(keyword) ||
			(item.area || '').toLowerCase().includes(keyword) ||
			(item.campus || '').toLowerCase().includes(keyword) ||
			(item.description || '').toLowerCase().includes(keyword) ||
			(idQuery && shortId(item.id).toLowerCase().includes(idQuery))
		);
	}

	if (campus && campus !== 'All Campuses') {
		result = result.filter(item => (item.campus || '').toLowerCase() === campus.toLowerCase());
	}

	const isRetrieved = document.body.dataset.page === 'retrieved';

	if (month && month !== 'All Month') {
		const monthIndex = MONTH_NAMES.indexOf(month);
		if (monthIndex !== -1) {
			result = result.filter(item => {
				const dStr = (isRetrieved && item.dateRetrieved) ? item.dateRetrieved : item.dateLost;
				const { monthIndex: m } = parseItemDate(dStr);
				return m === monthIndex;
			});
		}
	}

	if (year) {
		const yr = parseInt(year, 10);
		if (!isNaN(yr)) {
			result = result.filter(item => {
				const dStr = (isRetrieved && item.dateRetrieved) ? item.dateRetrieved : item.dateLost;
				const { year: y } = parseItemDate(dStr);
				return y === yr;
			});
		}
	}

	result.sort((a, b) => {
		const timeA = a.publishedAt || (a.id ? parseInt(String(a.id).replace(/\D/g, ''), 10) : 0) || 0;
		const timeB = b.publishedAt || (b.id ? parseInt(String(b.id).replace(/\D/g, ''), 10) : 0) || 0;
		const nameA = (a.name || '').toLowerCase();
		const nameB = (b.name || '').toLowerCase();

		switch (sort) {
			case 'Oldest First':	return timeA - timeB;
			case 'Name A–Z':		return nameA.localeCompare(nameB);
			case 'Name Z–A':		return nameB.localeCompare(nameA);
			case 'Newest First':
			default:				return timeB - timeA;
		}
	});

	return result;
}

//card grids
function renderCards(items) {
	const grid = document.querySelector('.grid');
	if (!grid) return;

	grid.innerHTML = '';

	if (items.length === 0) {
		const empty = document.createElement('p');
		empty.style.cssText = 'grid-column:1/-1;padding:40px 0;text-align:center;color:var(--muted);font-size:1.1rem;';
		empty.textContent = 'No items found.';
		grid.appendChild(empty);
		return;
	}

	const isRetrieved = document.body.dataset.page === 'retrieved';

	items.forEach((item, index) => {
		const article = document.createElement('article');
		article.className = 'card' + (isRetrieved ? ' done' : '');
		article.style.setProperty('--i', String(index + 1));
		article.style.cursor = 'pointer';

		let mediaEl;
		if (item.images && item.images.length > 0) {
			mediaEl = document.createElement('img');
			mediaEl.src = item.images[0];
			mediaEl.alt = item.name || 'Item photo';
			mediaEl.style.cssText = 'flex:none;width:132px;height:168px;object-fit:cover;border-radius:14px;border:1px solid var(--line);';
		} else {
			mediaEl = document.createElement('div');
			mediaEl.className = 'ph';
		}

		const body = document.createElement('div');
		body.className = 'card-body';

		const h3 = document.createElement('h3');
		h3.textContent = (item.name || '').toUpperCase();

		const spanPlace = document.createElement('span');
		spanPlace.textContent = `Place: ${item.campus || 'Main Campus'}`;

		const spanArea = document.createElement('span');
		spanArea.textContent = `Area: ${item.area || '—'}`;

		const spanDate = document.createElement('span');
		spanDate.textContent = `Date Lost: ${fmtDate(item.dateLost)}`;

		body.appendChild(h3);
		body.appendChild(spanPlace);
		body.appendChild(spanArea);
		body.appendChild(spanDate);

		if (isRetrieved && item.dateRetrieved) {
			const spanRet = document.createElement('span');
			spanRet.textContent = `Date Retrieved: ${fmtDate(item.dateRetrieved)}`;
			body.appendChild(spanRet);
		}

		const more = document.createElement('a');
		more.className = 'more';
		more.dataset.itemId = String(item.id);
		more.href = `?item=${encodeURIComponent(item.id)}#details`;
		more.innerHTML = 'View Full Details &rarr;';
		more.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			viewItem(e.currentTarget.dataset.itemId, item);
		});
		body.appendChild(more);

		article.appendChild(mediaEl);
		article.appendChild(body);

		article.addEventListener('click', (e) => {
			e.preventDefault();
			viewItem(item.id, item);
		});

		grid.appendChild(article);
	});
}

// pagination
function buildPager(total) {
	const pager = document.querySelector('.pager');
	if (!pager) return;

	const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
	pager.innerHTML = '';

	const makeBtn = (label, pageNum, disabled, active) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = label;
		if (active)	 btn.classList.add('on');
		if (disabled) { btn.classList.add('disabled'); btn.disabled = true; }
		if (!disabled) btn.addEventListener('click', () => changePage(pageNum));
		return btn;
	};

	pager.appendChild(makeBtn('Previous', currentPage - 1, currentPage === 1, false));

	for (let p = 1; p <= totalPages; p++) {
		pager.appendChild(makeBtn(String(p), p, false, p === currentPage));
	}

	pager.appendChild(makeBtn('Next', currentPage + 1, currentPage === totalPages, false));
}

function rerender() {
	filteredItems = applyFilters();

	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PER_PAGE));
	if (currentPage > totalPages) currentPage = 1;

	const start = (currentPage - 1) * PER_PAGE;
	const pageSlice = filteredItems.slice(start, start + PER_PAGE);

	renderCards(pageSlice);
	buildPager(filteredItems.length);
}

// events
function searchItem() {
	currentPage = 1;
	rerender();
}
function campusFilter() {
	currentPage = 1;
	rerender();
}
function monthYearFilter() {
	currentPage = 1;
	rerender();
}
function switchItemList(target) {
	const pageType = document.body.dataset.page;
	if (target === 'retrieved' && pageType !== 'retrieved') {
		window.location.href = 'retrieved.html';
	} else if (target === 'lost' && pageType !== 'lost') {
		window.location.href = 'index.html';
	}
}
function changePage(pageNum) {
	const totalPages = Math.max(1, Math.ceil(filteredItems.length / PER_PAGE));
	if (pageNum < 1 || pageNum > totalPages) return;
	currentPage = pageNum;
	rerender();
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function viewItem(id, itemData) {
	const item = (itemData && String(itemData.id) === String(id) ? itemData : null)
		|| allItems.find(i => String(i.id) === String(id))
		|| filteredItems.find(i => String(i.id) === String(id))
		|| readStorage().find(i => String(i.id) === String(id));
	if (!item) return;

	const overlay = document.getElementById('details');
	if (!overlay) return;

	const isRetrieved = (item.status === 'retrieved');

	const titleEl = document.getElementById('item-title');
	if (titleEl) {
		const sId = shortId(item.id);
		titleEl.innerHTML = `${esc(item.name)} <span>${sId ? 'ID#' + esc(sId) : ''}</span>`;
	}

	const descEl = overlay.querySelector('.desc');
	if (descEl) descEl.textContent = item.description || '';

	const metaEl = overlay.querySelector('.meta');
	if (metaEl) {
		const statusHtml = isRetrieved
			? '<span class="ok">RETRIEVED</span>'
			: '<span class="bad">UNCLAIMED</span>';

		const dateRetrievedRow = (isRetrieved && item.dateRetrieved)
			? `<span><b>Date Retrieved:</b> ${fmtDate(item.dateRetrieved)}</span>`
			: '<span></span>';

		metaEl.innerHTML = `
			<span><b>Place:</b> ${esc(item.campus || 'Main Campus')}</span>
			<span><b>Status:</b> ${statusHtml}</span>
			<span><b>Area:</b> ${esc(item.area || '—')}</span>
			${dateRetrievedRow}
			<span><b>Date Lost:</b> ${fmtDate(item.dateLost)}</span>
		`;
	}

	const galleryEl = overlay.querySelector('.gallery');
	if (galleryEl) {
		const countEl = galleryEl.querySelector('.count');
		const viewBtn = galleryEl.querySelector('.view');
		galleryEl.querySelectorAll('img').forEach(el => el.remove());
		const oldPh = galleryEl.querySelector('.ph');
		if (oldPh) oldPh.remove();

		const images = item.images || [];

		if (images.length > 0) {
			if (countEl) countEl.textContent = `1/${images.length}`;
			let activeIndex = 0;

			const imgEl = document.createElement('img');
			imgEl.src = images[0];
			imgEl.alt = item.name || 'Item photo';
			imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
			galleryEl.insertBefore(imgEl, countEl);

			if (viewBtn) {
				viewBtn.style.display = '';
				viewBtn.disabled = false;
				viewBtn.onclick = () => openLightbox(images[activeIndex], item.name);
			}

			if (images.length > 1) {
				const prevB = document.createElement('button');
				prevB.type = 'button'; prevB.textContent = '‹';
				prevB.style.cssText = 'position:absolute;left:4px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center';
				prevB.onclick = (e) => {
					e.stopPropagation();
					activeIndex = (activeIndex - 1 + images.length) % images.length;
					imgEl.src = images[activeIndex];
					if (countEl) countEl.textContent = `${activeIndex + 1}/${images.length}`;
				};

				const nextB = document.createElement('button');
				nextB.type = 'button'; nextB.textContent = '›';
				nextB.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center';
				nextB.onclick = (e) => {
					e.stopPropagation();
					activeIndex = (activeIndex + 1) % images.length;
					imgEl.src = images[activeIndex];
					if (countEl) countEl.textContent = `${activeIndex + 1}/${images.length}`;
				};

				galleryEl.style.position = 'relative';
				galleryEl.appendChild(prevB);
				galleryEl.appendChild(nextB);
			}
		} else {
			const ph = document.createElement('div');
			ph.className = 'ph';
			galleryEl.insertBefore(ph, countEl);

			if (countEl) countEl.textContent = '';
			if (viewBtn)	viewBtn.style.display = 'none';
		}
	}

	const dialogEl = overlay.querySelector('.dialog');
	if (dialogEl) dialogEl.classList.toggle('done', isRetrieved);

	overlay.classList.add('open');

	const escHandler = (e) => {
		if (e.key === 'Escape') {
			closeOverlay();
			document.removeEventListener('keydown', escHandler);
		}
	};
	document.addEventListener('keydown', escHandler);
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

function closeOverlay() {
	const overlay = document.getElementById('details');
	if (overlay) overlay.classList.remove('open');
}


function injectSortSelect() {
	const bar = document.querySelector('.bar');
	if (!bar || bar.querySelector('select[aria-label="Sort"]')) return;

	const sel = document.createElement('select');
	sel.setAttribute('aria-label', 'Sort');
	sel.setAttribute('autocomplete', 'off');
	['Newest First', 'Oldest First', 'Name A–Z', 'Name Z–A'].forEach(opt => {
		const o = document.createElement('option');
		o.textContent = opt;
		sel.appendChild(o);
	});
	sel.value = 'Newest First';
	sel.addEventListener('change', rerender);
	bar.appendChild(sel);
}

function applySyncedData(raw) {
	const p = unpackStoragePayload(raw);
	const items = p && Array.isArray(p.items) ? p.items : [];
	const version = p ? p.version : 0;

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: version, items: items }));
	} catch (e) {}

	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: version, items: items }));
	} catch (e) {}

	try {
		let nameObj = {};
		if (window.name) {
			try { nameObj = JSON.parse(window.name) || {}; } catch (e) {}
		}
		nameObj[STORAGE_KEY] = { version: version, items: items };
		window.name = JSON.stringify(nameObj);
	} catch (e) {}

	const pageType = document.body.dataset.page;
	allItems = pageType === 'retrieved'
		? items.filter(i => i.status === 'retrieved')
		: items.filter(i => !i.status || i.status === 'unclaimed');

	rerender();
	openLinkedItem();
}

function openLinkedItem() {
	if (!linkedItemId) return;
	const item = readStorage().find(i => String(i.id) === String(linkedItemId));
	if (!item) return;
	linkedItemId = null;
	viewItem(item.id, item);
}

window.addEventListener('message', function(e) {
	if (e.data && e.data.type === 'UNIFOUND_PULL_RESPONSE') {
		applySyncedData(e.data.data);
	}
});

function mountSyncBridge() {
	if (document.getElementById('unifound-sync-bridge')) {
		const existing = document.getElementById('unifound-sync-bridge');
		try {
			existing.contentWindow.postMessage({ type: 'UNIFOUND_PULL_REQUEST' }, '*');
		} catch (e) {}
		return;
	}

	const ifr = document.createElement('iframe');
	ifr.id = 'unifound-sync-bridge';
	ifr.src = 'admin/sync.html?v=20261122b';
	ifr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
	ifr.onload = function() {
		try {
			ifr.contentWindow.postMessage({ type: 'UNIFOUND_PULL_REQUEST' }, '*');
		} catch (e) {}
	};

	const attach = () => {
		if (!document.getElementById('unifound-sync-bridge') && document.body) {
			document.body.appendChild(ifr);
		}
	};

	if (document.body) {
		attach();
	} else {
		document.addEventListener('DOMContentLoaded', attach);
	}
}

try {
	const publicBC = new BroadcastChannel('unifound_bus');
	publicBC.onmessage = function(e) {
		if (e.data && e.data.type === 'UNIFOUND_DATA_CHANGED') {
			if (typeof loadData === 'function') loadData();
		}
	};
} catch (e) {}

window.addEventListener('storage', function(e) {
	if (e.key === STORAGE_KEY) {
		if (typeof loadData === 'function') loadData();
	}
});

// init checkpoint
function loadData() {
	mountSyncBridge();
	const allStored = readStorage();

	const pageType = document.body.dataset.page;
	allItems = pageType === 'retrieved'
		? allStored.filter(i => i.status === 'retrieved')
		: allStored.filter(i => !i.status || i.status === 'unclaimed');

	injectSortSelect();

	const searchInput = document.querySelector('input[type="search"]');
	if (searchInput && !searchInput._bound) {
		searchInput.addEventListener('input', searchItem);
		searchInput._bound = true;
	}

	const campusSel = document.querySelector('select[aria-label="Campus"]');
	if (campusSel && !campusSel._bound) {
		campusSel.addEventListener('change', campusFilter);
		campusSel._bound = true;
	}

	const monthSel = document.querySelector('select[aria-label="Month"]');
	if (monthSel && !monthSel._bound) {
		monthSel.addEventListener('change', monthYearFilter);
		monthSel._bound = true;
	}

	const yearInput = document.querySelector('input.year');
	if (yearInput && !yearInput._bound) {
		yearInput.addEventListener('input', monthYearFilter);
		yearInput._bound = true;
	}

	document.querySelectorAll('.nav .pill.lf, .nav .pill.rt').forEach(pill => {
		if (!pill._bound) {
			pill.addEventListener('click', () => {
				switchItemList(pill.classList.contains('rt') ? 'retrieved' : 'lost');
			});
			pill._bound = true;
		}
	});

	const closeBtn = document.querySelector('.close');
	if (closeBtn && !closeBtn._bound) {
		closeBtn.addEventListener('click', (e) => {
			e.preventDefault();
			closeOverlay();
		});
		closeBtn._bound = true;
	}

	const overlay = document.getElementById('details');
	if (overlay && !overlay._bound) {
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeOverlay();
		});
		overlay._bound = true;
	}

	rerender();
	openLinkedItem();
}

//global exports 2
window.searchItem		= searchItem;
window.campusFilter		= campusFilter;
window.viewItem			= viewItem;
window.switchItemList	= switchItemList;
window.changePage		= changePage;
window.loadData			= loadData;

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', loadData);
} else {
	loadData();
}

window.addEventListener('pageshow', loadData);

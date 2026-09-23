// ==========================================
// WARUNG HANES - KASIR + LOGIN + RETUR (BLUE THEME)
// ==========================================

const DEFAULT_PRODUCTS = [
    { id: 'PRD-1', name: 'Minyak Goreng Bimoli 1L', category: 'Sembako', price: 18000, stock: 30, icon: '🛢️' },
    { id: 'PRD-2', name: 'Beras Ramos Super 5kg', category: 'Sembako', price: 72000, stock: 15, icon: '🍚' },
    { id: 'PRD-3', name: 'Telur Ayam Negeri 1kg', category: 'Sembako', price: 28000, stock: 25, icon: '🥚' },
    { id: 'PRD-4', name: 'Indomie Goreng Spesial', category: 'Makanan', price: 3500, stock: 120, icon: '🍜' },
    { id: 'PRD-5', name: 'Indomie Ayam Bawang', category: 'Makanan', price: 3500, stock: 90, icon: '🍜' },
    { id: 'PRD-6', name: 'Kopi Kapal Api Mix (10 Bungkus)', category: 'Minuman', price: 15000, stock: 20, icon: '☕' },
    { id: 'PRD-7', name: 'Teh Poci Celup Box', category: 'Minuman', price: 8000, stock: 25, icon: '☕' },
    { id: 'PRD-8', name: 'Aqua Botol 600ml', category: 'Minuman', price: 4000, stock: 60, icon: '🥤' },
    { id: 'PRD-9', name: 'Gula Pasir Gulaku 1kg', category: 'Sembako', price: 17500, stock: 40, icon: '🧂' },
    { id: 'PRD-10', name: 'Sabun Cuci Rinso Anti Noda 700g', category: 'Kebersihan', price: 19500, stock: 18, icon: '🧼' },
    { id: 'PRD-11', name: 'Biskuit Roma Kelapa 300g', category: 'Makanan', price: 10500, stock: 22, icon: '🍪' },
    { id: 'PRD-12', name: 'Garam Dapur Cap Kapal 250g', category: 'Bumbu', price: 3000, stock: 50, icon: '🧂' }
];

const DEFAULT_USERS = [
    { username: 'admin', password: 'admin123', name: 'Admin', role: 'admin', roleLabel: 'Pemilik' },
    { username: 'kasir', password: 'kasir123', name: 'Kasir', role: 'kasir', roleLabel: 'Kasir' }
];

let products = [];
let cart = [];
let transactions = [];
let returns = [];
let users = [];
let currentUser = null;
let selectedCategory = 'Semua';
let selectedPaymentMethod = 'tunai';
let currentReceiptTransaction = null;

// Retur state
let selectedReturnTxId = null;
let returnQtyMap = {}; // productId -> qty diretur

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkSession();
    renderCategoryPills();
    renderProducts();
    renderCart();
    renderInventoryTable();
    renderTransactionHistory();
    renderReturnSearch();
    renderReturnHistory();
    renderReports();
    syncFromCloud(); // tarik & gabungkan data cloud di background
});

// ---------- STORAGE ----------
function loadData() {
    try {
        const sp = localStorage.getItem('hanes_products');
        products = sp ? JSON.parse(sp) : [...DEFAULT_PRODUCTS];
        const st = localStorage.getItem('hanes_transactions');
        transactions = st ? JSON.parse(st) : [];
        const sr = localStorage.getItem('hanes_returns');
        returns = sr ? JSON.parse(sr) : [];
        const su = localStorage.getItem('hanes_users');
        users = su ? JSON.parse(su) : [...DEFAULT_USERS];
        const ss = localStorage.getItem('hanes_session');
        currentUser = ss ? JSON.parse(ss) : null;
    } catch (e) {
        products = [...DEFAULT_PRODUCTS]; transactions = []; returns = []; users = [...DEFAULT_USERS]; currentUser = null;
    }
}

function saveData() {
    localStorage.setItem('hanes_products', JSON.stringify(products));
    localStorage.setItem('hanes_transactions', JSON.stringify(transactions));
    localStorage.setItem('hanes_returns', JSON.stringify(returns));
    localStorage.setItem('hanes_users', JSON.stringify(users));
}

// ---------- CLOUD SYNC (FIRESTORE) ----------
// localStorage tetap dipakai sebagai cache offline agar aplikasi cepat & tahan offline.
// Firestore dipakai sebagai database cloud agar data sama di semua perangkat.
// Setiap tulis ke cloud bersifat fire-and-forget: gagal = tetap jalan lokal.
let cloudState = 'local'; // local | online | error

function setCloudStatus(mode) {
    cloudState = mode;
    const el = document.getElementById('cloud-status');
    if (!el) return;
    if (mode === 'online') { el.textContent = '☁️ Database: tersambung (cloud)'; el.className = 'font-bold text-blue-700'; }
    else if (mode === 'error') { el.textContent = '☁️ Database: lokal (cloud gagal dijangkau)'; el.className = 'font-bold text-amber-600'; }
    else { el.textContent = '☁️ Database: lokal'; el.className = ''; }
}

function cloudDb() {
    try {
        if (typeof firebase === 'undefined' || !window.HANES_FIREBASE_CONFIG) return null;
        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(window.HANES_FIREBASE_CONFIG);
        }
        return firebase.firestore();
    } catch (e) {
        return null;
    }
}

function mergeById(localArr, cloudArr) {
    const map = {};
    (localArr || []).forEach(o => { if (o && o.id) map[o.id] = o; });
    (cloudArr || []).forEach(o => { if (o && o.id) map[o.id] = o; }); // cloud menang bila id sama
    return Object.values(map).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function sanitizeProduct(p) {
    return { id: p.id, name: p.name || '', category: p.category || 'Lain-lain', icon: p.icon || '📦', price: Number(p.price) || 0, stock: Number(p.stock) || 0, image: p.image || '' };
}

// Items transaksi/retur disimpan ke cloud TANPA gambar (hemat ukuran dokumen).
function stripImages(items) {
    return (items || []).map(i => ({ id: i.id, name: i.name, icon: i.icon || '', price: i.price, qty: i.qty }));
}

function renderAll() {
    renderProducts(); renderInventoryTable(); renderTransactionHistory();
    renderReturnSearch(); renderReturnHistory(); renderReports();
}

// Tarik data dari cloud saat aplikasi dibuka; seed cloud bila masih kosong.
async function syncFromCloud() {
    const db = cloudDb();
    if (!db) { setCloudStatus('local'); return; }
    try {
        const [pSnap, tSnap, rSnap] = await Promise.all([
            db.collection('products').get(),
            db.collection('transactions').orderBy('date', 'desc').limit(200).get(),
            db.collection('returns').orderBy('date', 'desc').limit(200).get()
        ]);
        const cloudProducts = pSnap.docs.map(d => d.data());
        const cloudTx = tSnap.docs.map(d => d.data());
        const cloudRet = rSnap.docs.map(d => d.data());

        const batch = db.batch();
        let needCommit = false;
        if (cloudProducts.length > 0) {
            products = cloudProducts;
        } else if (products.length > 0) {
            products.forEach(p => batch.set(db.collection('products').doc(p.id), sanitizeProduct(p)));
            needCommit = true;
        }
        if (cloudTx.length > 0 || cloudRet.length > 0) {
            transactions = mergeById(transactions, cloudTx);
            returns = mergeById(returns, cloudRet);
        } else {
            transactions.forEach(tx => batch.set(db.collection('transactions').doc(tx.id), cloudTxPayload(tx)));
            returns.forEach(r => batch.set(db.collection('returns').doc(r.id), cloudReturnPayload(r)));
            if (transactions.length > 0 || returns.length > 0) needCommit = true;
        }
        if (needCommit) await batch.commit();

        saveData(); // simpan hasil gabungan ke localStorage
        renderAll();
        setCloudStatus('online');
    } catch (e) {
        console.warn('Sinkron cloud gagal, memakai data lokal:', e);
        setCloudStatus('error');
    }
}

function cloudTxPayload(tx) {
    return { id: tx.id, date: tx.date, customer: tx.customer || '', note: tx.note || '', items: stripImages(tx.items), subtotal: tx.subtotal, discount: tx.discount, total: tx.total, paymentMethod: tx.paymentMethod, cashGiven: tx.cashGiven, cashChange: tx.cashChange, cashier: tx.cashier || '' };
}

function cloudReturnPayload(r) {
    return { id: r.id, date: r.date, originalTxId: r.originalTxId, originalCustomer: r.originalCustomer || '', items: stripImages(r.items), totalRefund: r.totalRefund, reason: r.reason || '', cashier: r.cashier || '' };
}

function cloudUpsertProducts(list) {
    try {
        const db = cloudDb();
        if (!db || !list || list.length === 0) return;
        const batch = db.batch();
        list.forEach(p => { if (p && p.id) batch.set(db.collection('products').doc(p.id), sanitizeProduct(p)); });
        batch.commit().then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan: lokal tetap tersimpan */ }
}

function cloudDeleteDoc(collectionName, docId) {
    try {
        const db = cloudDb();
        if (!db || !docId) return;
        db.collection(collectionName).doc(docId).delete()
            .then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan */ }
}

function cloudClearCollection(collectionName) {
    try {
        const db = cloudDb();
        if (!db) return;
        db.collection(collectionName).get().then(snap => {
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            return batch.commit();
        }).then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan */ }
}

function cloudAddTransaction(tx) {
    try {
        const db = cloudDb();
        if (!db) return;
        db.collection('transactions').doc(tx.id).set(cloudTxPayload(tx))
            .then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan */ }
}

function cloudAddReturn(ret) {
    try {
        const db = cloudDb();
        if (!db) return;
        db.collection('returns').doc(ret.id).set(cloudReturnPayload(ret))
            .then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan */ }
}

function cloudReplaceProducts(list) {
    try {
        const db = cloudDb();
        if (!db) return;
        db.collection('products').get().then(snap => {
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            (list || []).forEach(p => { if (p && p.id) batch.set(db.collection('products').doc(p.id), sanitizeProduct(p)); });
            return batch.commit();
        }).then(() => setCloudStatus('online')).catch(() => setCloudStatus('error'));
    } catch (e) { /* abaikan */ }
}

function formatRupiah(amount) {
    return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
}

// ---------- GAMBAR PRODUK ----------
function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
}

// Ukuran standar gambar produk: 1080 x 1090 px
const PRODUCT_IMG_W = 1080;
const PRODUCT_IMG_H = 1090;

function productVisual(p, boxClass) {
    const cls = boxClass || 'w-12 h-12';
    if (p && p.image) {
        return `<img src="${p.image}" alt="${escapeAttr(p.name)}" width="1080" height="1090" class="${cls} rounded-xl object-cover border border-slate-200 bg-white shrink-0" style="aspect-ratio:1080/1090;" loading="lazy" onerror="this.outerHTML='<span class=\\'text-2xl\\'>${(p && p.icon) || '📦'}</span>'">`;
    }
    return `<span class="text-2xl">${(p && p.icon) || '📦'}</span>`;
}

function resizeImageTo1080x1090(imgSrc, callback) {
    const img = new Image();
    img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = PRODUCT_IMG_W;
        canvas.height = PRODUCT_IMG_H;
        const ctx = canvas.getContext('2d');
        // Cover-crop: isi penuh 1080x1090 tanpa distorsi
        const scale = Math.max(PRODUCT_IMG_W / img.width, PRODUCT_IMG_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const dx = (PRODUCT_IMG_W - w) / 2;
        const dy = (PRODUCT_IMG_H - h) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, PRODUCT_IMG_W, PRODUCT_IMG_H);
        ctx.drawImage(img, dx, dy, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function() { alert('Gagal membaca gambar!'); };
    img.src = imgSrc;
}

function handleProductImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('File harus berupa gambar!'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Ukuran file max 5MB!'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        resizeImageTo1080x1090(e.target.result, function(resized) {
            const urlInput = document.getElementById('prod-image');
            if (urlInput) urlInput.value = resized;
            previewProductImageUrl();
        });
    };
    reader.readAsDataURL(file);
}

function previewProductImageUrl() {
    const url = document.getElementById('prod-image')?.value.trim() || '';
    const prev = document.getElementById('prod-image-preview');
    if (!prev) return;
    if (url) { prev.src = url; prev.classList.remove('hidden'); }
    else { prev.src = ''; prev.classList.add('hidden'); }
}

function clearProductImage() {
    const urlInput = document.getElementById('prod-image');
    const fileInput = document.getElementById('prod-image-file');
    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';
    previewProductImageUrl();
}

// ---------- AUTH / LOGIN ----------
function checkSession() {
    const loginScreen = document.getElementById('login-screen');
    if (!currentUser) {
        if (loginScreen) loginScreen.classList.remove('hidden');
    } else {
        if (loginScreen) loginScreen.classList.add('hidden');
        updateUserBadge();
        applyRoleAccess();
    }
}

function updateUserBadge() {
    if (!currentUser) return;
    const initial = (currentUser.name || currentUser.username || 'U').charAt(0).toUpperCase();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('user-avatar', initial);
    set('user-display-name', currentUser.name || currentUser.username);
    set('user-display-role', currentUser.roleLabel || currentUser.role);
    set('user-display-name-mobile', currentUser.name || currentUser.username);
    set('user-display-role-mobile', currentUser.roleLabel || currentUser.role);
}

function applyRoleAccess() {
    // Kasir tidak boleh akses Kelola Stok & Laporan
    const isKasir = currentUser && currentUser.role === 'kasir';
    ['tab-stok', 'tab-laporan'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (isKasir) {
            btn.classList.add('opacity-40');
            btn.title = 'Hanya untuk Pemilik/Admin';
        } else {
            btn.classList.remove('opacity-40');
            btn.title = '';
        }
    });
}

function handleLogin(event) {
    event.preventDefault();
    const u = document.getElementById('login-username').value.trim().toLowerCase();
    const p = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');

    const found = users.find(x => x.username.toLowerCase() === u && x.password === p);
    if (!found) {
        if (errEl) {
            errEl.textContent = 'Username atau password salah! Coba admin / admin123';
            errEl.classList.remove('hidden');
        }
        return;
    }
    currentUser = { username: found.username, name: found.name, role: found.role, roleLabel: found.roleLabel };
    localStorage.setItem('hanes_session', JSON.stringify(currentUser));
    if (errEl) errEl.classList.add('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('login-password').value = '';
    updateUserBadge();
    applyRoleAccess();
    switchTab('kasir');
}

function logout() {
    if (!confirm('Yakin ingin keluar dari aplikasi?')) return;
    currentUser = null;
    localStorage.removeItem('hanes_session');
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.classList.remove('hidden');
}

// ---------- NAV ----------
function switchTab(tabId) {
    // Proteksi role: kasir tidak bisa buka stok & laporan
    if (currentUser && currentUser.role === 'kasir' && (tabId === 'stok' || tabId === 'laporan')) {
        alert('Akses ditolak! Menu ini hanya untuk Pemilik/Admin.');
        return;
    }
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const targetSec = document.getElementById(`sec-${tabId}`);
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetSec) targetSec.classList.remove('hidden');
    if (targetTab) targetTab.classList.add('active');
    if (tabId === 'stok') renderInventoryTable();
    if (tabId === 'transaksi') renderTransactionHistory();
    if (tabId === 'laporan') renderReports();
    if (tabId === 'retur') { renderReturnSearch(); renderReturnHistory(); }
}

// ---------- KATALOG ----------
function renderCategoryPills() {
    const categories = ['Semua', 'Sembako', 'Makanan', 'Minuman', 'Bumbu', 'Kebersihan', 'Lain-lain'];
    const container = document.getElementById('category-pills');
    if (!container) return;
    container.innerHTML = categories.map(cat => `
        <button onclick="filterCategory('${cat}')" class="cat-pill px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border border-slate-200 ${selectedCategory === cat ? 'active' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${cat}</button>
    `).join('');
}

function filterCategory(category) {
    selectedCategory = category;
    renderCategoryPills();
    renderProducts();
}

function renderProducts() {
    const grid = document.getElementById('product-grid');
    const searchInput = document.getElementById('search-product')?.value.toLowerCase() || '';
    if (!grid) return;
    const filtered = products.filter(p => {
        const matchesCat = selectedCategory === 'Semua' || p.category === selectedCategory;
        const matchesSearch = p.name.toLowerCase().includes(searchInput);
        return matchesCat && matchesSearch;
    });
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400"><i class="fa-solid fa-box-open text-4xl mb-2"></i><p class="text-sm font-semibold">Produk tidak ditemukan</p></div>`;
        return;
    }
    grid.innerHTML = filtered.map(p => {
        const isOut = p.stock <= 0;
        return `
            <div class="product-card bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                    <div class="w-full mb-2 rounded-xl overflow-hidden bg-slate-100 border border-slate-100 flex items-center justify-center" style="aspect-ratio:1080/1090;">
                        ${p.image ? `<img src="${p.image}" alt="${escapeAttr(p.name)}" width="1080" height="1090" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'text-3xl\\'>${p.icon || '📦'}</span>'">` : `<span class="text-4xl">${p.icon || '📦'}</span>`}
                    </div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">${p.category}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${isOut ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-800'}">Stok: ${p.stock}</span>
                    </div>
                    <h3 class="font-bold text-slate-800 text-xs sm:text-sm line-clamp-2">${p.name}</h3>
                    <p class="text-[11px] text-slate-400 mt-0.5">${p.category}</p>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span class="font-extrabold text-blue-600 text-sm">${formatRupiah(p.price)}</span>
                    <button onclick="addToCart('${p.id}')" ${isOut ? 'disabled' : ''} class="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-xs transition shadow-sm"><i class="fa-solid fa-plus"></i></button>
                </div>
            </div>`;
    }).join('');
}

// ---------- KERANJANG ----------
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock <= 0) return;
    const ex = cart.findIndex(i => i.id === productId);
    if (ex > -1) {
        if (cart[ex].qty < product.stock) cart[ex].qty += 1;
        else alert(`Stok produk "${product.name}" terbatas (${product.stock} pcs)!`);
    } else cart.push({ ...product, qty: 1 });
    renderCart();
}

function updateCartQty(productId, delta) {
    const item = cart.find(i => i.id === productId);
    const product = products.find(p => p.id === productId);
    if (!item || !product) return;
    const nq = item.qty + delta;
    if (nq <= 0) removeFromCart(productId);
    else if (nq <= product.stock) { item.qty = nq; renderCart(); }
    else alert(`Stok maksimal terlampaui (${product.stock} pcs)!`);
}

function removeFromCart(productId) { cart = cart.filter(i => i.id !== productId); renderCart(); }

function clearCart() {
    if (cart.length === 0) return;
    if (confirm('Kosongkan keranjang?')) { cart = []; renderCart(); }
}

function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;
    if (cart.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-slate-400"><i class="fa-solid fa-basket-shopping text-3xl mb-2 text-slate-300"></i><p class="text-xs font-semibold">Keranjang belanja kosong</p></div>`;
    } else {
        container.innerHTML = cart.map(item => `
            <div class="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                <div class="flex items-center gap-2 flex-1 pr-2 min-w-0">
                    ${item.image ? `<img src="${item.image}" width="1080" height="1090" class="w-9 rounded-lg object-cover border border-slate-200 bg-white shrink-0" style="aspect-ratio:1080/1090;" loading="lazy">` : `<span class="text-xl shrink-0">${item.icon || '📦'}</span>`}
                    <div class="min-w-0">
                        <p class="font-bold text-slate-800 text-xs line-clamp-1">${item.name}</p>
                        <p class="text-[11px] text-blue-600 font-bold">${formatRupiah(item.price * item.qty)}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200">
                    <button onclick="updateCartQty('${item.id}', -1)" class="w-5 h-5 text-slate-500 hover:text-rose-600 font-bold text-xs">-</button>
                    <span class="text-xs font-extrabold px-1">${item.qty}</span>
                    <button onclick="updateCartQty('${item.id}', 1)" class="w-5 h-5 text-slate-500 hover:text-blue-600 font-bold text-xs">+</button>
                </div>
            </div>`).join('');
    }
    updateCartSummary();
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active'));
    const ab = document.getElementById(`pay-${method}`);
    if (ab) ab.classList.add('active');
    const cs = document.getElementById('cash-payment-section');
    if (cs) cs.classList.toggle('hidden', method !== 'tunai');
}

function updateCartSummary() {
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = Number(document.getElementById('cart-discount')?.value || 0);
    const total = Math.max(0, subtotal - disc);
    const se = document.getElementById('cart-subtotal');
    const de = document.getElementById('cart-discount-display');
    const te = document.getElementById('cart-total');
    if (se) se.textContent = formatRupiah(subtotal);
    if (de) de.textContent = `- ${formatRupiah(disc)}`;
    if (te) te.textContent = formatRupiah(total);
    calculateChange();
}

function calculateChange() {
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = Number(document.getElementById('cart-discount')?.value || 0);
    const total = Math.max(0, subtotal - disc);
    const given = Number(document.getElementById('cash-given')?.value || 0);
    const ch = given - total;
    const el = document.getElementById('cash-change');
    if (el) {
        if (ch >= 0) { el.textContent = formatRupiah(ch); el.className = "text-sm text-blue-700 font-bold"; }
        else { el.textContent = "Kurang " + formatRupiah(Math.abs(ch)); el.className = "text-xs text-rose-600 font-bold"; }
    }
}

function setCashGiven(a) { const i = document.getElementById('cash-given'); if (i) { i.value = a; calculateChange(); } }
function setExactCash() {
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = Number(document.getElementById('cart-discount')?.value || 0);
    setCashGiven(Math.max(0, subtotal - disc));
}

// ---------- CHECKOUT ----------
function processCheckout() {
    if (!currentUser) { alert('Silakan login dulu!'); return; }
    if (cart.length === 0) { alert('Keranjang masih kosong!'); return; }
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const discount = Number(document.getElementById('cart-discount')?.value || 0);
    const total = Math.max(0, subtotal - discount);
    const cashGiven = Number(document.getElementById('cash-given')?.value || 0);
    if (selectedPaymentMethod === 'tunai' && cashGiven < total) { alert('Uang tunai kurang!'); return; }
    const customerName = document.getElementById('customer-name')?.value.trim() || 'Umum';
    const note = document.getElementById('order-note')?.value.trim() || '';
    const orderId = 'ORD-' + Date.now().toString().slice(-6);
    const tx = {
        id: orderId, date: new Date().toISOString(), customer: customerName, note,
        items: [...cart], subtotal, discount, total,
        paymentMethod: selectedPaymentMethod,
        cashGiven: selectedPaymentMethod === 'tunai' ? cashGiven : total,
        cashChange: selectedPaymentMethod === 'tunai' ? (cashGiven - total) : 0,
        cashier: currentUser.name || currentUser.username
    };
    cart.forEach(item => {
        const pr = products.find(p => p.id === item.id);
        if (pr) pr.stock = Math.max(0, pr.stock - item.qty);
    });
    transactions.unshift(tx);
    saveData();
    cloudAddTransaction(tx);
    cloudUpsertProducts(cart.map(item => products.find(p => p.id === item.id)).filter(Boolean));
    cart = [];
    document.getElementById('customer-name').value = '';
    document.getElementById('order-note').value = '';
    document.getElementById('cart-discount').value = '0';
    document.getElementById('cash-given').value = '';
    renderCart(); renderProducts(); renderInventoryTable(); renderTransactionHistory(); renderReports();
    showReceiptModal(tx);
}

// ---------- STRUK ----------
function showReceiptModal(tx) {
    currentReceiptTransaction = tx;
    document.getElementById('rec-id').textContent = '#' + tx.id;
    document.getElementById('rec-date').textContent = new Date(tx.date).toLocaleString('id-ID');
    document.getElementById('rec-customer').textContent = tx.customer;
    document.getElementById('rec-method').textContent = (tx.paymentMethod || '').toUpperCase();
    const rc = document.getElementById('rec-cashier');
    if (rc) rc.textContent = tx.cashier || (currentUser ? currentUser.name : '-');
    document.getElementById('rec-items').innerHTML = tx.items.map(i => `
        <div><div class="flex justify-between font-bold"><span>${i.name}</span><span>${formatRupiah(i.price * i.qty)}</span></div>
        <div class="text-[10px] text-slate-500">${i.qty} x ${formatRupiah(i.price)}</div></div>`).join('');
    document.getElementById('rec-subtotal').textContent = formatRupiah(tx.subtotal);
    document.getElementById('rec-discount').textContent = `- ${formatRupiah(tx.discount)}`;
    document.getElementById('rec-total').textContent = formatRupiah(tx.total);
    const showCash = tx.paymentMethod === 'tunai';
    document.getElementById('rec-cash-row').style.display = showCash ? 'flex' : 'none';
    document.getElementById('rec-change-row').style.display = showCash ? 'flex' : 'none';
    if (showCash) {
        document.getElementById('rec-cash').textContent = formatRupiah(tx.cashGiven);
        document.getElementById('rec-change').textContent = formatRupiah(tx.cashChange);
    }
    document.getElementById('receipt-modal').classList.remove('hidden');
}
function closeReceiptModal() { document.getElementById('receipt-modal').classList.add('hidden'); }
function printReceipt() { window.print(); }
function shareReceiptWhatsApp() {
    if (!currentReceiptTransaction) return;
    const tx = currentReceiptTransaction;
    let text = `*STRUK WARUNG HANES*\nNo: #${tx.id}\nTgl: ${new Date(tx.date).toLocaleString('id-ID')}\nKasir: ${tx.cashier || '-'}\n--------------------------\n`;
    tx.items.forEach(i => { text += `${i.name}\n${i.qty}x @ ${formatRupiah(i.price)} = ${formatRupiah(i.price * i.qty)}\n`; });
    text += `--------------------------\nTotal: *${formatRupiah(tx.total)}*\nTerima kasih!`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- RIWAYAT TRANSAKSI ----------
function renderTransactionHistory() {
    const tb = document.getElementById('transaction-history-table');
    if (!tb) return;
    if (transactions.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 font-semibold">Belum ada riwayat transaksi</td></tr>`;
        return;
    }
    tb.innerHTML = transactions.map(tx => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3 font-bold text-slate-800">#${tx.id}</td>
            <td class="p-3 text-slate-500 whitespace-nowrap">${new Date(tx.date).toLocaleString('id-ID')}</td>
            <td class="p-3 font-semibold">${tx.customer}<br><span class="text-[10px] text-slate-400">Kasir: ${tx.cashier || '-'}</span></td>
            <td class="p-3"><span class="line-clamp-1">${tx.items.map(i => `${i.name} (${i.qty})`).join(', ')}</span></td>
            <td class="p-3 uppercase"><span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${tx.paymentMethod === 'tunai' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'}">${tx.paymentMethod}</span></td>
            <td class="p-3 font-bold text-blue-600">${formatRupiah(tx.total)}</td>
            <td class="p-3 text-center whitespace-nowrap">
                <button onclick='showReceiptModal(${JSON.stringify(tx).replace(/'/g, "&#39;")})' class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold"><i class="fa-solid fa-receipt mr-1"></i>Struk</button>
                <button onclick="startReturnFor('${tx.id}')" class="px-2 py-1 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg text-xs font-semibold ml-1"><i class="fa-solid fa-rotate-left mr-1"></i>Retur</button>
            </td>
        </tr>`).join('');
}

function clearTransactionHistory() {
    if (transactions.length === 0) return;
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin yang boleh menghapus riwayat!'); return; }
    if (confirm('Hapus seluruh riwayat transaksi?')) {
        transactions = []; saveData(); renderTransactionHistory(); renderReports(); renderReturnSearch();
        cloudClearCollection('transactions');
    }
}

function exportTransactionsCSV() {
    if (transactions.length === 0) { alert('Tidak ada data!'); return; }
    let csv = "data:text/csv;charset=utf-8,ID,Waktu,Pembeli,Kasir,Total,Metode,Detail\n";
    transactions.forEach(tx => {
        const d = tx.items.map(i => `${i.name} (${i.qty})`).join('; ');
        csv += `${tx.id},"${new Date(tx.date).toLocaleString('id-ID')}",${tx.customer},${tx.cashier || ''},${tx.total},${tx.paymentMethod},"${d}"\n`;
    });
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `laporan_warung_hanes_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
}

// ---------- RETUR / PENGEMBALIAN ----------
function getReturnedQty(txId, productId) {
    return returns.filter(r => r.originalTxId === txId).reduce((s, r) => {
        const it = r.items.find(i => i.id === productId);
        return s + (it ? it.qty : 0);
    }, 0);
}

function startReturnFor(txId) {
    switchTab('retur');
    const inp = document.getElementById('return-search');
    if (inp) inp.value = txId;
    renderReturnSearch();
    selectReturnTx(txId);
}

function renderReturnSearch() {
    const box = document.getElementById('return-search-result');
    if (!box) return;
    const kw = (document.getElementById('return-search')?.value || '').toLowerCase().trim();
    const list = transactions.filter(tx => {
        if (!kw) return true;
        return tx.id.toLowerCase().includes(kw) || (tx.customer || '').toLowerCase().includes(kw);
    }).slice(0, 20);

    if (list.length === 0) {
        box.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-4">Tidak ada transaksi ditemukan. Lakukan penjualan dulu di menu Kasir.</p>`;
        return;
    }
    box.innerHTML = list.map(tx => `
        <button onclick="selectReturnTx('${tx.id}')" class="w-full text-left p-3 rounded-xl border transition text-xs ${selectedReturnTxId === tx.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}">
            <div class="flex justify-between items-center">
                <span class="font-extrabold text-slate-800">#${tx.id}</span>
                <span class="font-bold text-blue-700">${formatRupiah(tx.total)}</span>
            </div>
            <p class="text-slate-500 mt-0.5">${new Date(tx.date).toLocaleString('id-ID')} • ${tx.customer} • ${tx.items.reduce((s, i) => s + i.qty, 0)} pcs</p>
        </button>`).join('');
}

function selectReturnTx(txId) {
    selectedReturnTxId = txId;
    returnQtyMap = {};
    renderReturnSearch();
    const tx = transactions.find(t => t.id === txId);
    const form = document.getElementById('return-form');
    if (!tx) { if (form) form.classList.add('hidden'); return; }
    if (form) form.classList.remove('hidden');
    document.getElementById('return-tx-id').textContent = '#' + tx.id;
    document.getElementById('return-tx-info').textContent = `${new Date(tx.date).toLocaleString('id-ID')} • ${tx.customer} • ${tx.paymentMethod.toUpperCase()}`;

    const listEl = document.getElementById('return-items-list');
    listEl.innerHTML = tx.items.map(it => {
        const already = getReturnedQty(tx.id, it.id);
        const maxBisa = Math.max(0, it.qty - already);
        return `
        <div class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
            <div class="flex items-center gap-2 flex-1 min-w-0">
                ${it.image ? `<img src="${it.image}" width="1080" height="1090" class="w-9 rounded-lg object-cover border border-slate-200 bg-white shrink-0" style="aspect-ratio:1080/1090;">` : `<span class="text-xl shrink-0">${it.icon || '📦'}</span>`}
                <div class="min-w-0">
                    <p class="font-bold text-slate-800">${it.name}</p>
                    <p class="text-slate-500">Beli: ${it.qty} • Sudah diretur: ${already} • Maks: ${maxBisa} • @ ${formatRupiah(it.price)}</p>
                </div>
            </div>
            <div class="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-1">
                <button onclick="changeReturnQty('${it.id}', -1, ${maxBisa})" class="w-6 h-6 font-bold text-slate-500 hover:text-rose-600">-</button>
                <span class="font-extrabold w-6 text-center" id="ret-qty-${it.id}">0</span>
                <button onclick="changeReturnQty('${it.id}', 1, ${maxBisa})" class="w-6 h-6 font-bold text-slate-500 hover:text-blue-600">+</button>
            </div>
        </div>`;
    }).join('');
    updateReturnPreview();
}

function changeReturnQty(productId, delta, maxBisa) {
    const cur = returnQtyMap[productId] || 0;
    const nxt = cur + delta;
    if (nxt < 0 || nxt > maxBisa) return;
    returnQtyMap[productId] = nxt;
    const el = document.getElementById(`ret-qty-${productId}`);
    if (el) el.textContent = nxt;
    updateReturnPreview();
}

function calcReturnTotal() {
    const tx = transactions.find(t => t.id === selectedReturnTxId);
    if (!tx) return 0;
    return tx.items.reduce((s, it) => s + (returnQtyMap[it.id] || 0) * it.price, 0);
}

function updateReturnPreview() {
    const el = document.getElementById('return-total-preview');
    if (el) el.textContent = formatRupiah(calcReturnTotal());
}

function processReturn() {
    const tx = transactions.find(t => t.id === selectedReturnTxId);
    if (!tx) { alert('Pilih transaksi dulu!'); return; }
    const items = tx.items.filter(it => (returnQtyMap[it.id] || 0) > 0).map(it => ({
        id: it.id, name: it.name, icon: it.icon, image: it.image || '', price: it.price, qty: returnQtyMap[it.id]
    }));
    if (items.length === 0) { alert('Pilih minimal 1 barang & jumlah retur!'); return; }
    const reason = document.getElementById('return-reason')?.value || 'Lainnya';
    const totalRefund = items.reduce((s, i) => s + i.price * i.qty, 0);

    const ret = {
        id: 'RTN-' + Date.now().toString().slice(-6),
        date: new Date().toISOString(),
        originalTxId: tx.id,
        originalCustomer: tx.customer,
        items, totalRefund, reason,
        cashier: currentUser ? (currentUser.name || currentUser.username) : '-'
    };
    // Kembalikan stok
    items.forEach(ri => {
        const pr = products.find(p => p.id === ri.id);
        if (pr) pr.stock += ri.qty;
    });
    returns.unshift(ret);
    saveData();
    cloudAddReturn(ret);
    cloudUpsertProducts(items.map(ri => products.find(p => p.id === ri.id)).filter(Boolean));
    selectedReturnTxId = null;
    returnQtyMap = {};
    const si = document.getElementById('return-search');
    if (si) si.value = '';
    document.getElementById('return-form').classList.add('hidden');
    renderReturnSearch(); renderReturnHistory(); renderReports(); renderProducts(); renderInventoryTable();
    alert(`Retur ${ret.id} berhasil! Refund ${formatRupiah(totalRefund)} — stok dikembalikan.`);
}

function renderReturnHistory() {
    const tb = document.getElementById('return-history-table');
    const gt = document.getElementById('return-grand-total');
    const totalAll = returns.reduce((s, r) => s + r.totalRefund, 0);
    if (gt) gt.textContent = formatRupiah(totalAll);
    if (!tb) return;
    if (returns.length === 0) {
        tb.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 font-semibold">Belum ada pengembalian barang</td></tr>`;
        return;
    }
    tb.innerHTML = returns.map(r => `
        <tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-800">#${r.id}<br><span class="text-[10px] font-normal text-slate-400">${new Date(r.date).toLocaleString('id-ID')}</span></td>
            <td class="p-3 text-slate-500 whitespace-nowrap">${new Date(r.date).toLocaleDateString('id-ID')}<br><span class="text-[10px]">Oleh: ${r.cashier}</span></td>
            <td class="p-3 font-semibold">#${r.originalTxId}<br><span class="text-[10px] text-slate-400">${r.originalCustomer} • ${r.reason}</span></td>
            <td class="p-3">${r.items.map(i => `${i.name} (${i.qty})`).join(', ')}</td>
            <td class="p-3 font-bold text-rose-600">-${formatRupiah(r.totalRefund)}</td>
            <td class="p-3 text-center">
                <button onclick="deleteReturn('${r.id}')" class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`).join('');
}

function deleteReturn(retId) {
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin yang boleh menghapus riwayat retur!'); return; }
    const r = returns.find(x => x.id === retId);
    if (!r) return;
    if (!confirm(`Hapus retur ${retId}? Stok akan dikurangi kembali.`)) return;
    // Kembalikan efek stok (kurangi lagi)
    r.items.forEach(ri => {
        const pr = products.find(p => p.id === ri.id);
        if (pr) pr.stock = Math.max(0, pr.stock - ri.qty);
    });
    returns = returns.filter(x => x.id !== retId);
    saveData();
    cloudDeleteDoc('returns', retId);
    cloudUpsertProducts(r.items.map(ri => products.find(p => p.id === ri.id)).filter(Boolean));
    renderReturnHistory(); renderReports(); renderProducts(); renderInventoryTable();
}

function clearReturnHistory() {
    if (returns.length === 0) return;
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin yang boleh menghapus!'); return; }
    if (!confirm('Hapus SEMUA riwayat retur? Stok akan disesuaikan mundur.')) return;
    returns.forEach(r => r.items.forEach(ri => {
        const pr = products.find(p => p.id === ri.id);
        if (pr) pr.stock = Math.max(0, pr.stock - ri.qty);
    }));
    returns = [];
    saveData();
    cloudClearCollection('returns');
    cloudUpsertProducts(products);
    renderReturnHistory(); renderReports(); renderProducts(); renderInventoryTable();
}

// ---------- INVENTARIS ----------
function renderInventoryTable() {
    const tb = document.getElementById('inventory-table');
    if (!tb) return;
    tb.innerHTML = products.map(p => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3 flex items-center space-x-2 font-bold text-slate-800">${productVisual(p, 'w-10 h-10')}<span>${p.name}</span></td>
            <td class="p-3 text-slate-500">${p.category}</td>
            <td class="p-3 font-bold text-blue-600">${formatRupiah(p.price)}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs font-bold ${p.stock <= 5 ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-800'}">${p.stock} pcs</span></td>
            <td class="p-3 text-center space-x-1 whitespace-nowrap">
                <button onclick="editProduct('${p.id}')" class="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteProduct('${p.id}')" class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`).join('');
}

function handleProductSubmit(e) {
    e.preventDefault();
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin yang boleh kelola produk!'); return; }
    const editId = document.getElementById('edit-product-id').value;
    const name = document.getElementById('prod-name').value.trim();
    const category = document.getElementById('prod-category').value;
    const icon = document.getElementById('prod-icon').value;
    const price = Number(document.getElementById('prod-price').value);
    const stock = Number(document.getElementById('prod-stock').value);
    const image = document.getElementById('prod-image')?.value.trim() || '';
    if (editId) {
        const pr = products.find(p => p.id === editId);
        if (pr) Object.assign(pr, { name, category, icon, price, stock, image });
        cloudUpsertProducts([products.find(p => p.id === editId)].filter(Boolean));
    } else {
        const np = { id: 'PRD-' + Date.now().toString().slice(-6), name, category, icon, price, stock, image };
        products.unshift(np);
        cloudUpsertProducts([np]);
    }
    saveData(); resetProductForm(); renderInventoryTable(); renderProducts();
}

function editProduct(id) {
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin!'); return; }
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('form-title').textContent = 'Edit Produk';
    document.getElementById('edit-product-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-category').value = p.category;
    document.getElementById('prod-icon').value = p.icon || '📦';
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-stock').value = p.stock;
    const imgInput = document.getElementById('prod-image');
    const fileInput = document.getElementById('prod-image-file');
    if (imgInput) imgInput.value = p.image || '';
    if (fileInput) fileInput.value = '';
    previewProductImageUrl();
    document.getElementById('product-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteProduct(id) {
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin!'); return; }
    if (confirm('Hapus produk ini?')) {
        products = products.filter(p => p.id !== id);
        saveData(); renderInventoryTable(); renderProducts();
        cloudDeleteDoc('products', id);
    }
}

function resetProductForm() {
    document.getElementById('form-title').textContent = 'Tambah Produk Baru';
    document.getElementById('edit-product-id').value = '';
    document.getElementById('product-form').reset();
    previewProductImageUrl();
}

function resetDefaultProducts() {
    if (currentUser && currentUser.role !== 'admin') { alert('Hanya Admin!'); return; }
    if (confirm('Reset ke produk bawaan?')) {
        products = [...DEFAULT_PRODUCTS];
        saveData(); renderInventoryTable(); renderProducts();
        cloudReplaceProducts(products);
    }
}

// ---------- LAPORAN ----------
function renderReports() {
    const gross = transactions.reduce((s, t) => s + t.total, 0);
    const totalRefund = returns.reduce((s, r) => s + r.totalRefund, 0);
    const net = Math.max(0, gross - totalRefund);
    const totalOrders = transactions.length;
    const soldQty = transactions.reduce((s, t) => s + t.items.reduce((a, i) => a + i.qty, 0), 0);
    const retQty = returns.reduce((s, r) => s + r.items.reduce((a, i) => a + i.qty, 0), 0);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('report-total-revenue', formatRupiah(net));
    set('report-total-orders', `${totalOrders} Transaksi`);
    set('report-total-items', `${Math.max(0, soldQty - retQty)} Pcs`);
    set('report-total-refund', formatRupiah(totalRefund));

    const sales = {};
    transactions.forEach(tx => tx.items.forEach(i => {
        if (!sales[i.name]) sales[i.name] = { name: i.name, qty: 0, revenue: 0 };
        sales[i.name].qty += i.qty;
        sales[i.name].revenue += i.price * i.qty;
    }));
    // kurangi yang diretur agar bersih
    returns.forEach(r => r.items.forEach(i => {
        if (sales[i.name]) {
            sales[i.name].qty = Math.max(0, sales[i.name].qty - i.qty);
            sales[i.name].revenue = Math.max(0, sales[i.name].revenue - i.price * i.qty);
        }
    }));
    const top = Object.values(sales).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const tc = document.getElementById('top-products-list');
    if (tc) {
        tc.innerHTML = top.length === 0 ? `<p class="text-xs text-slate-400 italic">Belum ada data</p>` :
            top.map((p, i) => `
            <div class="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                <div class="flex items-center space-x-3">
                    <span class="w-6 h-6 flex items-center justify-center font-bold text-xs bg-amber-100 text-amber-800 rounded-full">${i + 1}</span>
                    <div><p class="font-bold text-xs">${p.name}</p><p class="text-[10px] text-slate-500">${p.qty} pcs</p></div>
                </div>
                <span class="font-bold text-xs text-blue-600">${formatRupiah(p.revenue)}</span>
            </div>`).join('');
    }

    const pm = { tunai: 0, qris: 0, transfer: 0 };
    transactions.forEach(tx => { if (pm[tx.paymentMethod] !== undefined) pm[tx.paymentMethod] += tx.total; });
    const pc = document.getElementById('payment-methods-breakdown');
    if (pc) {
        pc.innerHTML = `
            <div class="space-y-2">
                <div class="flex justify-between text-xs"><span class="font-semibold"><i class="fa-solid fa-money-bill-wave text-blue-600 mr-2"></i>Tunai</span><b>${formatRupiah(pm.tunai)}</b></div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div class="bg-blue-500 h-full" style="width:${gross ? pm.tunai / gross * 100 : 0}%"></div></div>
                <div class="flex justify-between text-xs pt-2"><span class="font-semibold"><i class="fa-solid fa-qrcode text-indigo-600 mr-2"></i>QRIS</span><b>${formatRupiah(pm.qris)}</b></div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div class="bg-indigo-500 h-full" style="width:${gross ? pm.qris / gross * 100 : 0}%"></div></div>
                <div class="flex justify-between text-xs pt-2"><span class="font-semibold"><i class="fa-solid fa-building-columns text-purple-600 mr-2"></i>Transfer</span><b>${formatRupiah(pm.transfer)}</b></div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div class="bg-purple-500 h-full" style="width:${gross ? pm.transfer / gross * 100 : 0}%"></div></div>
                <p class="text-[11px] text-slate-500 pt-2">Omset kotor: ${formatRupiah(gross)} • Refund retur: ${formatRupiah(totalRefund)} • <b>Bersih: ${formatRupiah(net)}</b></p>
            </div>`;
    }
}

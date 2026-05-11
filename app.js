// app.js
import { db, storage } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, onSnapshot, query, orderBy, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===================== State =====================
let customers = [], products = [], orders = [];
let editingCustomerId = null, editingProductId = null, editingOrderId = null;
let tempProductImages = []; // [{file, url, existing}]
let currentOrderItems = []; // for order modal

// ===================== Init =====================
window.onAppReady = function() {
  listenCustomers();
  listenProducts();
  listenOrders();
  setDefaultDate();
  scheduleAutoAllot();
};

function setDefaultDate() {
  const today = new Date().toISOString().slice(0, 10);
  const el = document.getElementById('order-date');
  if (el) el.value = today;
}

// ===================== Realtime Listeners =====================
function listenCustomers() {
  onSnapshot(collection(db, 'customers'), snap => {
    customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCustomers();
  });
}
function listenProducts() {
  onSnapshot(collection(db, 'products'), snap => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProducts();
  });
}
function listenOrders() {
  onSnapshot(query(collection(db, 'orders'), orderBy('date', 'desc')), snap => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders();
  });
}

// ===================== Navigation =====================
window.switchPage = function(page, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + page).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
};

window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden');
};

// ===================== Modal Helpers =====================
window.closeModal = function(id) {
  document.getElementById(id).classList.add('hidden');
};
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

// ===================== CUSTOMERS =====================
window.renderCustomers = function() {
  const search = (document.getElementById('filter-customer-search')?.value || '').toLowerCase();
  const platform = document.getElementById('filter-customer-platform')?.value || '';
  let list = customers.filter(c => {
    if (platform && c.platform !== platform) return false;
    if (search && !c.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const el = document.getElementById('customers-list');
  if (!el) return;
  el.innerHTML = list.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無客戶資料</p>'
    : list.map(c => `
      <div class="card customer-card">
        <div class="card-body">
          <div class="customer-info">
            <h4>${escHtml(c.name)}</h4>
            <span class="platform-tag">${escHtml(c.platform || '')}</span>
            ${c.note ? `<button class="btn outline small mt-1" onclick="showNote('${c.id}')">📝 備註</button>` : ''}
          </div>
          <div class="customer-actions">
            <button class="btn outline small" onclick="openCustomerModal('${c.id}')">✏️ 編輯</button>
            <button class="btn danger small" onclick="deleteCustomer('${c.id}')">🗑️</button>
          </div>
        </div>
      </div>
    `).join('');
};

window.openCustomerModal = function(id = null) {
  editingCustomerId = id;
  const c = id ? customers.find(x => x.id === id) : null;
  document.getElementById('customer-modal-title').textContent = id ? '編輯客戶' : '新增客戶';
  document.getElementById('cust-name').value = c ? c.name : '';
  document.getElementById('cust-platform').value = c ? (c.platform || 'Line@') : 'Line@';
  document.getElementById('cust-note').value = c ? (c.note || '') : '';
  openModal('customer-modal-overlay');
};

window.saveCustomer = async function() {
  const name = document.getElementById('cust-name').value.trim();
  if (!name) { showToast('⚠️ 請輸入客戶名稱'); return; }
  const data = {
    name,
    platform: document.getElementById('cust-platform').value,
    note: document.getElementById('cust-note').value.trim(),
    updatedAt: Date.now()
  };
  if (editingCustomerId) {
    await updateDoc(doc(db, 'customers', editingCustomerId), data);
    showToast('✅ 客戶已更新');
  } else {
    data.createdAt = Date.now();
    await addDoc(collection(db, 'customers'), data);
    showToast('✅ 客戶已新增');
  }
  closeModal('customer-modal-overlay');
};

window.deleteCustomer = async function(id) {
  if (!confirm('確定刪除此客戶？')) return;
  await deleteDoc(doc(db, 'customers', id));
  showToast('🗑️ 已刪除');
};

window.showNote = function(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('note-modal-content').textContent = c.note || '（無備註）';
  openModal('note-modal-overlay');
};

// ===================== PRODUCTS =====================
window.renderProducts = function() {
  const cat = document.getElementById('filter-product-category')?.value || '';
  const search = (document.getElementById('filter-product-search')?.value || '').toLowerCase();
  let list = products.filter(p => {
    if (cat && p.category !== cat) return false;
    if (search && !p.name?.toLowerCase().includes(search) && !p.sku?.toLowerCase().includes(search)) return false;
    return true;
  });
  const el = document.getElementById('products-list');
  if (!el) return;

  const groups = {};
  list.forEach(p => { const c = p.category || '其他'; if (!groups[c]) groups[c] = []; groups[c].push(p); });

  el.innerHTML = Object.entries(groups).map(([cat, prods]) => `
    <h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${cat}</h3>
    <div class="product-grid">
      ${prods.map(p => productCardHtml(p)).join('')}
    </div>
  `).join('') || '<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無商品資料</p>';
};

function productCardHtml(p) {
  const imgs = (p.images || []).slice(0, 4).map(url =>
    `<img src="${url}" alt="" onclick="window.open('${url}','_blank')" title="點擊下載/放大">`
  ).join('');
  const stockClass = (p.stock || 0) <= 3 ? 'low' : '';
  const variants = p.variants?.length ? `款式：${p.variants.join('、')}` : '';
  const sizes = p.sizes?.length ? `尺寸：${p.sizes.join('、')}` : '';
  return `
    <div class="card product-card">
      <div class="card-header">
        <span class="product-sku">${escHtml(p.sku || '')}</span>
        <span class="product-category-tag">${escHtml(p.category || '')}</span>
      </div>
      <div class="card-body">
        ${imgs ? `<div class="product-images">${imgs}</div>` : ''}
        <div style="font-weight:600;margin-bottom:4px;">${escHtml(p.name || '（未命名）')}</div>
        ${p.price != null ? `<div class="product-price">NT$ ${Number(p.price).toLocaleString()}</div>` : ''}
        <div class="product-stock ${stockClass}">庫存：${p.stock ?? '-'} 件</div>
        <div class="product-variants">${[variants, sizes].filter(Boolean).join('　')}</div>
        <div class="product-actions">
          <button class="btn outline small" onclick="openProductModal('${p.id}')">✏️ 編輯</button>
          <button class="btn danger small" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div>
      </div>
    </div>`;
}

window.onCategoryChange = function() {
  // SKU auto-generate when creating new product
  if (editingProductId) return;
  genSKU();
};

async function genSKU() {
  const cat = document.getElementById('prod-category').value;
  if (!cat) { document.getElementById('prod-sku').value = ''; return; }
  const prefix = cat === '服飾' ? 'A' : 'N';
  // Get existing SKUs of this category
  const used = products.filter(p => p.category === cat).map(p => p.sku || '');
  // Find max number
  let maxN = 0;
  used.forEach(sku => {
    const n = parseInt(sku.slice(1));
    if (!isNaN(n) && n > maxN) maxN = n;
  });
  // Also check deletedSKUs to avoid reuse
  let deletedMax = 0;
  try {
    const snap = await getDoc(doc(db, 'meta', 'deletedSKUs'));
    if (snap.exists()) {
      const arr = snap.data()[prefix] || [];
      arr.forEach(sku => {
        const n = parseInt(sku.slice(1));
        if (!isNaN(n) && n > deletedMax) deletedMax = n;
      });
    }
  } catch(e) {}
  const nextN = Math.max(maxN, deletedMax) + 1;
  document.getElementById('prod-sku').value = prefix + String(nextN).padStart(2, '0');
}

window.addVariantRow = function(containerId, type) {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.innerHTML = `<input type="text" placeholder="${type === 'variant' ? '款式/顏色' : '尺寸'}">
    <button class="btn outline small" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(row);
};

window.handleProductImages = function(e) {
  const files = Array.from(e.target.files);
  const remaining = 4 - tempProductImages.length;
  if (remaining <= 0) { showToast('⚠️ 最多4張圖片'); return; }
  files.slice(0, remaining).forEach(file => {
    const url = URL.createObjectURL(file);
    tempProductImages.push({ file, url, existing: false });
  });
  renderProductImagePreviews();
  e.target.value = '';
};

function renderProductImagePreviews() {
  const area = document.getElementById('prod-images-container');
  area.innerHTML = tempProductImages.map((img, i) => `
    <div class="img-preview-wrap">
      <img src="${img.url}" alt="">
      <button class="img-remove" onclick="removeProductImage(${i})">✕</button>
    </div>
  `).join('');
}

window.removeProductImage = function(idx) {
  tempProductImages.splice(idx, 1);
  renderProductImagePreviews();
};

window.openProductModal = async function(id = null) {
  editingProductId = id;
  tempProductImages = [];
  const p = id ? products.find(x => x.id === id) : null;
  document.getElementById('product-modal-title').textContent = id ? '編輯商品' : '新增商品';
  document.getElementById('prod-category').value = p ? (p.category || '') : '';
  document.getElementById('prod-sku').value = p ? (p.sku || '') : '';
  document.getElementById('prod-vendor').value = p ? (p.vendor || '') : '';
  document.getElementById('prod-name').value = p ? (p.name || '') : '';
  document.getElementById('prod-price').value = p?.price ?? '';
  document.getElementById('prod-cost').value = p?.cost ?? '';
  document.getElementById('prod-stock').value = p?.stock ?? '';

  // Variants
  const vc = document.getElementById('prod-variants-container');
  vc.innerHTML = '';
  (p?.variants || []).forEach(v => { addVariantRow('prod-variants-container', 'variant'); vc.lastChild.querySelector('input').value = v; });

  // Sizes
  const sc = document.getElementById('prod-sizes-container');
  sc.innerHTML = '';
  (p?.sizes || []).forEach(s => { addVariantRow('prod-sizes-container', 'size'); sc.lastChild.querySelector('input').value = s; });

  // Images (existing)
  if (p?.images?.length) {
    p.images.forEach(url => tempProductImages.push({ file: null, url, existing: true, storedUrl: url }));
  }
  renderProductImagePreviews();

  openModal('product-modal-overlay');
};

window.saveProduct = async function() {
  const category = document.getElementById('prod-category').value;
  if (!category) { showToast('⚠️ 請選擇商品分類'); return; }
  const sku = document.getElementById('prod-sku').value;

  // Upload new images
  const imageUrls = [];
  for (const img of tempProductImages) {
    if (img.existing) {
      imageUrls.push(img.storedUrl);
    } else {
      const imgRef = ref(storage, `products/${sku}_${Date.now()}_${img.file.name}`);
      await uploadBytes(imgRef, img.file);
      const url = await getDownloadURL(imgRef);
      imageUrls.push(url);
    }
  }

  // Variants & Sizes
  const variants = Array.from(document.querySelectorAll('#prod-variants-container .variant-row input'))
    .map(i => i.value.trim()).filter(Boolean);
  const sizes = Array.from(document.querySelectorAll('#prod-sizes-container .variant-row input'))
    .map(i => i.value.trim()).filter(Boolean);

  const price = document.getElementById('prod-price').value;
  const data = {
    category,
    sku,
    vendor: document.getElementById('prod-vendor').value.trim(),
    name: document.getElementById('prod-name').value.trim(),
    price: price !== '' ? Number(price) : null,
    cost: document.getElementById('prod-cost').value !== '' ? Number(document.getElementById('prod-cost').value) : null,
    stock: document.getElementById('prod-stock').value !== '' ? Number(document.getElementById('prod-stock').value) : 0,
    variants,
    sizes,
    images: imageUrls,
    updatedAt: Date.now()
  };

  if (editingProductId) {
    await updateDoc(doc(db, 'products', editingProductId), data);
    showToast('✅ 商品已更新');
  } else {
    data.createdAt = Date.now();
    await addDoc(collection(db, 'products'), data);
    showToast('✅ 商品已新增');
  }
  closeModal('product-modal-overlay');
};

window.deleteProduct = async function(id) {
  if (!confirm('確定刪除此商品？刪除後貨號不可再使用。')) return;
  const p = products.find(x => x.id === id);
  if (!p) return;
  // Record deleted SKU
  if (p.sku) {
    const prefix = p.sku[0];
    const metaRef = doc(db, 'meta', 'deletedSKUs');
    const snap = await getDoc(metaRef);
    const existing = snap.exists() ? (snap.data()[prefix] || []) : [];
    await setDoc(metaRef, { [prefix]: [...existing, p.sku] }, { merge: true });
  }
  await deleteDoc(doc(db, 'products', id));
  showToast('🗑️ 商品已刪除');
};

// ===================== ORDERS =====================
window.renderOrders = function() {
  const dateFrom = document.getElementById('filter-date-from')?.value || '';
  const dateTo = document.getElementById('filter-date-to')?.value || '';
  const status = document.getElementById('filter-order-status')?.value || '';
  const search = (document.getElementById('filter-order-search')?.value || '').toLowerCase();

  let list = orders.filter(o => {
    if (dateFrom && o.date < dateFrom) return false;
    if (dateTo && o.date > dateTo) return false;
    if (status && o.status !== status) return false;
    if (search) {
      const cust = customers.find(c => c.id === o.customerId);
      const custName = cust?.name?.toLowerCase() || '';
      if (!o.orderNo?.toLowerCase().includes(search) && !custName.includes(search)) return false;
    }
    return true;
  });

  const el = document.getElementById('orders-list');
  if (!el) return;
  el.innerHTML = list.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無訂單資料</p>'
    : list.map(o => orderCardHtml(o)).join('');
};

function orderCardHtml(o) {
  const cust = customers.find(c => c.id === o.customerId);
  const itemSummary = (o.items || []).map(i =>
    `${escHtml(i.productName || '')} ${i.variant ? `[${escHtml(i.variant)}]` : ''} ${i.size ? `/ ${escHtml(i.size)}` : ''} × ${i.qty} — <span class="badge ${i.goodsStatus || '採買中'}">${i.goodsStatus || '採買中'}</span>`
  ).join('<br>');
  const total = calcTotal(o);

  return `
    <div class="card order-card" onclick="openOrderModal('${o.id}')">
      <div class="card-header">
        <div>
          <span class="order-id">${escHtml(o.orderNo || o.id.slice(0, 8))}</span>
          <span style="margin-left:8px;color:var(--text-muted);font-size:12px;">${o.date || ''}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="badge ${o.status || ''}">${o.status || ''}</span>
          <button class="btn outline small" onclick="event.stopPropagation();downloadOrderImage('${o.id}')">🖼️</button>
          <button class="btn outline small" onclick="event.stopPropagation();downloadOrderPDF('${o.id}')">📄</button>
          <button class="btn danger small" onclick="event.stopPropagation();deleteOrder('${o.id}')">🗑️</button>
        </div>
      </div>
      <div class="card-body">
        <div class="order-meta">
          <span style="font-weight:600;">${cust ? escHtml(cust.name) : '未知客戶'}</span>
          ${cust?.platform ? `<span class="platform-tag" style="font-size:11px;background:var(--accent-light);color:var(--accent);padding:1px 7px;border-radius:20px;">${escHtml(cust.platform)}</span>` : ''}
          ${o.deposit ? '<span class="badge 已配貨" style="font-size:10px;">定金✓</span>' : '<span class="badge 缺貨" style="font-size:10px;">定金✗</span>'}
          ${o.balance ? '<span class="badge 已配貨" style="font-size:10px;">尾款✓</span>' : '<span class="badge 缺貨" style="font-size:10px;">尾款✗</span>'}
        </div>
        <div class="order-items-summary">${itemSummary}</div>
        <div class="order-totals">
          <span>總額：</span>
          <span class="order-total-amount">NT$ ${total.toLocaleString()}</span>
          <span style="color:var(--text-muted);font-size:12px;">寄送：${escHtml(o.shippingMethod || '')}</span>
        </div>
      </div>
    </div>`;
}

function calcTotal(o) {
  const sub = (o.items || []).reduce((s, i) => s + (i.qty || 0) * (i.priceSnapshot || 0), 0);
  const ship = Number(o.shippingFee || 0);
  const disc = Number(o.discount || 0);
  return sub + ship + disc;
}

// ---- Order Modal ----
window.openOrderModal = async function(id = null) {
  editingOrderId = id;
  currentOrderItems = [];
  const o = id ? orders.find(x => x.id === id) : null;
  document.getElementById('order-modal-title').textContent = id ? '編輯訂單' : '新增訂單';

  // Customer
  document.getElementById('order-customer-search').value = '';
  document.getElementById('order-customer-id').value = o?.customerId || '';
  const cust = o ? customers.find(c => c.id === o.customerId) : null;
  const selInfo = document.getElementById('selected-customer-info');
  if (cust) {
    document.getElementById('order-customer-search').value = cust.name;
    selInfo.textContent = `${cust.name}（${cust.platform || ''}）`;
    selInfo.classList.remove('hidden');
    // Show note popup if has note
    if (cust.note) {
      setTimeout(() => {
        document.getElementById('note-modal-content').textContent = cust.note;
        openModal('note-modal-overlay');
      }, 300);
    }
  } else {
    selInfo.classList.add('hidden');
  }

  document.getElementById('order-date').value = o?.date || new Date().toISOString().slice(0, 10);
  document.getElementById('order-status').value = o?.status || '採買中';
  document.getElementById('order-shipping-method').value = o?.shippingMethod || '7-11';
  document.getElementById('order-shipping-fee').value = o?.shippingFee ?? 60;
  document.getElementById('order-discount').value = o?.discount ?? 0;
  document.getElementById('order-deposit').checked = o?.deposit || false;
  document.getElementById('order-balance').checked = o?.balance || false;

  // Items
  currentOrderItems = o ? JSON.parse(JSON.stringify(o.items || [])) : [];
  renderOrderItemsUI();
  calcOrderTotal();

  // Show download buttons only when editing
  document.getElementById('btn-download-order').classList.toggle('hidden', !id);
  document.getElementById('btn-download-pdf').classList.toggle('hidden', !id);

  openModal('order-modal-overlay');
};

function renderOrderItemsUI() {
  const container = document.getElementById('order-items-container');
  container.innerHTML = currentOrderItems.map((item, idx) => {
    const p = products.find(x => x.id === item.productId);
    const variants = p?.variants || [];
    const sizes = p?.sizes || [];
    const imgs = (p?.images || []).slice(0, 4).map(url =>
      `<img src="${url}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--border);">`
    ).join('');
    return `
      <div class="order-item-row" id="order-item-${idx}">
        <div class="order-item-header">
          <span class="order-item-sku">${escHtml(item.sku || '')}</span>
          <span class="order-item-name">${escHtml(item.productName || '')}</span>
          <span style="color:var(--accent);font-size:13px;font-weight:600;">NT$ ${Number(item.priceSnapshot || 0).toLocaleString()}</span>
          <button class="btn danger small" onclick="removeOrderItem(${idx})">✕</button>
        </div>
        ${imgs ? `<div class="order-item-images">${imgs}</div>` : ''}
        <div class="order-item-grid">
          <div>
            <label style="font-size:11px;color:var(--text-muted);">款式/顏色</label>
            ${variants.length
              ? `<select onchange="updateOrderItem(${idx},'variant',this.value)">${[''].concat(variants).map(v => `<option ${item.variant === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`
              : `<input type="text" value="${escHtml(item.variant || '')}" placeholder="款式" onchange="updateOrderItem(${idx},'variant',this.value)">`
            }
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);">尺寸</label>
            ${sizes.length
              ? `<select onchange="updateOrderItem(${idx},'size',this.value)">${[''].concat(sizes).map(s => `<option ${item.size === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`
              : `<input type="text" value="${escHtml(item.size || '')}" placeholder="尺寸" onchange="updateOrderItem(${idx},'size',this.value)">`
            }
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);">數量</label>
            <input type="number" min="1" value="${item.qty || 1}" oninput="updateOrderItem(${idx},'qty',this.value);calcOrderTotal()">
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);">小計</label>
            <input type="text" value="NT$ ${((item.qty || 1) * (item.priceSnapshot || 0)).toLocaleString()}" readonly style="background:var(--bg-muted);" id="subtotal-${idx}">
          </div>
        </div>
        <div style="margin-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);">貨品狀況</label>
          <select onchange="updateOrderItem(${idx},'goodsStatus',this.value)" style="width:auto;">
            ${['採買中','已配貨','缺貨','官網訂購中'].map(s =>
              `<option ${item.goodsStatus === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
      </div>`;
  }).join('');
}

window.updateOrderItem = function(idx, field, value) {
  currentOrderItems[idx][field] = field === 'qty' ? Number(value) : value;
  if (field === 'qty') {
    const sub = (currentOrderItems[idx].qty || 1) * (currentOrderItems[idx].priceSnapshot || 0);
    const el = document.getElementById(`subtotal-${idx}`);
    if (el) el.value = 'NT$ ' + sub.toLocaleString();
    calcOrderTotal();
  }
};

window.removeOrderItem = function(idx) {
  currentOrderItems.splice(idx, 1);
  renderOrderItemsUI();
  calcOrderTotal();
};

// Product picker for order
window.addOrderItem = function() {
  // Simple product picker: show select modal inline
  const opts = products.map(p =>
    `<option value="${p.id}">[${p.sku || ''}] ${p.name || '（未命名）'} — NT$ ${p.price ?? '?'}</option>`
  ).join('');
  const container = document.getElementById('order-items-container');
  const pickerId = 'prod-picker-' + Date.now();
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;';
  div.innerHTML = `
    <select id="${pickerId}" style="flex:1">
      <option value="">選擇商品...</option>
      ${opts}
    </select>
    <button class="btn primary small" onclick="confirmAddProduct('${pickerId}',this.parentElement)">確認</button>
    <button class="btn outline small" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(div);
};

window.confirmAddProduct = function(pickerId, row) {
  const sel = document.getElementById(pickerId);
  const productId = sel.value;
  if (!productId) { showToast('⚠️ 請選擇商品'); return; }
  const p = products.find(x => x.id === productId);
  if (!p) return;
  currentOrderItems.push({
    productId: p.id,
    sku: p.sku || '',
    productName: p.name || '',
    priceSnapshot: p.price || 0,
    variant: '',
    size: '',
    qty: 1,
    goodsStatus: '採買中'
  });
  row.remove();
  renderOrderItemsUI();
  calcOrderTotal();
};

window.calcOrderTotal = function() {
  const sub = currentOrderItems.reduce((s, i) => s + (i.qty || 1) * (i.priceSnapshot || 0), 0);
  const method = document.getElementById('order-shipping-method')?.value || '7-11';
  let ship = 0;
  if (method === '7-11') ship = sub >= 3000 ? 0 : 60;
  else ship = sub >= 5000 ? 0 : 180;
  const discEl = document.getElementById('order-discount');
  const disc = Number(discEl?.value || 0);
  if (document.getElementById('order-shipping-fee')) document.getElementById('order-shipping-fee').value = ship;
  document.getElementById('display-subtotal').textContent = 'NT$ ' + sub.toLocaleString();
  document.getElementById('display-shipping').textContent = 'NT$ ' + ship.toLocaleString();
  document.getElementById('display-discount').textContent = 'NT$ ' + disc.toLocaleString();
  document.getElementById('display-total').textContent = 'NT$ ' + (sub + ship + disc).toLocaleString();
};

window.filterCustomerDropdown = function() {
  const q = document.getElementById('order-customer-search').value.toLowerCase();
  const dd = document.getElementById('customer-dropdown');
  const matches = customers.filter(c => c.name.toLowerCase().includes(q));
  if (!q || matches.length === 0) { dd.classList.add('hidden'); return; }
  dd.innerHTML = matches.map(c =>
    `<div class="dropdown-item" onclick="selectOrderCustomer('${c.id}','${escHtml(c.name)}','${escHtml(c.platform || '')}','${escHtml(c.note || '')}')">
      ${escHtml(c.name)} <span style="font-size:11px;color:var(--text-muted)">${escHtml(c.platform || '')}</span>
    </div>`
  ).join('');
  dd.classList.remove('hidden');
};

window.selectOrderCustomer = function(id, name, platform, note) {
  document.getElementById('order-customer-id').value = id;
  document.getElementById('order-customer-search').value = name;
  document.getElementById('customer-dropdown').classList.add('hidden');
  const selInfo = document.getElementById('selected-customer-info');
  selInfo.textContent = `${name}（${platform}）`;
  selInfo.classList.remove('hidden');
  if (note) {
    document.getElementById('note-modal-content').textContent = note;
    openModal('note-modal-overlay');
  }
};

window.saveOrder = async function() {
  const customerId = document.getElementById('order-customer-id').value;
  if (!customerId) { showToast('⚠️ 請選擇客戶'); return; }
  if (currentOrderItems.length === 0) { showToast('⚠️ 請至少新增一個品項'); return; }

  const sub = currentOrderItems.reduce((s, i) => s + (i.qty || 1) * (i.priceSnapshot || 0), 0);
  const method = document.getElementById('order-shipping-method').value;
  const shippingFee = method === '7-11' ? (sub >= 3000 ? 0 : 60) : (sub >= 5000 ? 0 : 180);

  const data = {
    customerId,
    date: document.getElementById('order-date').value,
    status: document.getElementById('order-status').value,
    shippingMethod: method,
    shippingFee,
    discount: Number(document.getElementById('order-discount').value || 0),
    deposit: document.getElementById('order-deposit').checked,
    balance: document.getElementById('order-balance').checked,
    items: currentOrderItems,
    updatedAt: Date.now()
  };

  if (editingOrderId) {
    await updateDoc(doc(db, 'orders', editingOrderId), data);
    showToast('✅ 訂單已更新');
  } else {
    // Generate order number
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const count = orders.filter(o => o.date === data.date).length + 1;
    data.orderNo = `ORD-${ymd}-${String(count).padStart(3, '0')}`;
    data.createdAt = Date.now();
    await addDoc(collection(db, 'orders'), data);
    showToast('✅ 訂單已新增');
  }
  closeModal('order-modal-overlay');
};

window.deleteOrder = async function(id) {
  if (!confirm('確定刪除此訂單？')) return;
  await deleteDoc(doc(db, 'orders', id));
  showToast('🗑️ 訂單已刪除');
};

// ===================== DOWNLOAD (Image / PDF) =====================
// Uses html2canvas and jsPDF loaded via CDN
function loadScript(src) {
  return new Promise(resolve => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function buildOrderReceiptEl(orderId) {
  const o = orderId ? orders.find(x => x.id === orderId) : (editingOrderId ? orders.find(x => x.id === editingOrderId) : null);
  if (!o) return null;
  const cust = customers.find(c => c.id === o.customerId);
  const total = calcTotal(o);
  const sub = (o.items || []).reduce((s, i) => s + (i.qty || 0) * (i.priceSnapshot || 0), 0);

  const el = document.createElement('div');
  el.style.cssText = 'width:480px;background:#fff;padding:28px;font-family:Noto Sans TC,sans-serif;color:#0F172A;font-size:14px;';
  el.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:28px;margin-bottom:6px;">🛍️</div>
      <h2 style="font-size:20px;font-weight:700;margin:0;">代購訂單明細</h2>
      <p style="color:#64748B;font-size:12px;margin-top:4px;">${o.orderNo || o.id.slice(0, 8)}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="color:#64748B;">客戶</span><strong>${escHtml(cust?.name || '未知')}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="color:#64748B;">平台</span><span>${escHtml(cust?.platform || '-')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="color:#64748B;">日期</span><span>${o.date || '-'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#64748B;">寄送方式</span><span>${escHtml(o.shippingMethod || '-')}</span>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
      <thead>
        <tr style="background:#F8FAFC;">
          <th style="padding:8px;text-align:left;border-bottom:1px solid #E2E8F0;">品名</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #E2E8F0;">款式/尺寸</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #E2E8F0;">數量</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #E2E8F0;">小計</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #E2E8F0;">狀態</th>
        </tr>
      </thead>
      <tbody>
        ${(o.items || []).map(i => `
          <tr>
            <td style="padding:7px 8px;border-bottom:1px solid #F1F5F9;">${escHtml(i.productName || '')}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F1F5F9;text-align:center;">${escHtml([i.variant, i.size].filter(Boolean).join(' / ') || '-')}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F1F5F9;text-align:center;">${i.qty}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F1F5F9;text-align:right;">NT$ ${((i.qty || 0) * (i.priceSnapshot || 0)).toLocaleString()}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F1F5F9;text-align:center;">${i.goodsStatus || '-'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="border-top:1px solid #E2E8F0;padding-top:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;">
        <span>小計</span><span>NT$ ${sub.toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;">
        <span>運費</span><span>NT$ ${Number(o.shippingFee || 0).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;">
        <span>優惠</span><span>NT$ ${Number(o.discount || 0).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:8px;">
        <span>總額</span><span style="color:#2563EB;">NT$ ${total.toLocaleString()}</span>
      </div>
    </div>
    <div style="margin-top:14px;padding:10px;background:#F8FAFC;border-radius:8px;font-size:12px;color:#64748B;display:flex;gap:16px;">
      <span>定金：${o.deposit ? '✅ 已付' : '❌ 未付'}</span>
      <span>尾款：${o.balance ? '✅ 已付' : '❌ 未付'}</span>
    </div>
  `;
  return el;
}

window.downloadOrderImage = async function(orderId) {
  showToast('⏳ 準備下載圖片...');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  const el = await buildOrderReceiptEl(orderId);
  document.body.appendChild(el);
  el.style.position = 'fixed'; el.style.top = '-9999px'; el.style.left = '-9999px';
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff' });
  document.body.removeChild(el);
  const link = document.createElement('a');
  link.download = `訂單-${orderId || editingOrderId || 'receipt'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('✅ 圖片已下載');
};

window.downloadOrderPDF = async function(orderId) {
  showToast('⏳ 準備下載PDF...');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const el = await buildOrderReceiptEl(orderId);
  document.body.appendChild(el);
  el.style.position = 'fixed'; el.style.top = '-9999px'; el.style.left = '-9999px';
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff' });
  document.body.removeChild(el);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const imgData = canvas.toDataURL('image/png');
  const pageW = pdf.internal.pageSize.getWidth();
  const imgH = canvas.height * pageW / canvas.width;
  pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
  pdf.save(`訂單-${orderId || editingOrderId || 'receipt'}.pdf`);
  showToast('✅ PDF已下載');
};

// ===================== PURCHASE LIST =====================
window.compilePurchaseList = function() {
  // Gather all items with goodsStatus = '採買中'
  const map = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      if ((item.goodsStatus || '採買中') !== '採買中') return;
      const key = `${item.productId}_${item.variant || ''}_${item.size || ''}`;
      if (!map[key]) {
        const p = products.find(x => x.id === item.productId);
        map[key] = {
          productId: item.productId,
          sku: item.sku || '',
          productName: item.productName || '',
          variant: item.variant || '',
          size: item.size || '',
          qty: 0,
          product: p,
          customers: [],
          done: false
        };
      }
      map[key].qty += (item.qty || 0);
      const cust = customers.find(c => c.id === o.customerId);
      if (cust) map[key].customers.push(cust.name);
    });
  });

  const el = document.getElementById('purchase-list');
  const items = Object.values(map);
  if (items.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">目前沒有採買中的品項</p>';
    return;
  }

  el.innerHTML = items.map((item, idx) => {
    const p = item.product;
    const imgs = (p?.images || []).slice(0, 2).map(url =>
      `<img src="${url}" alt="" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">`
    ).join('');
    return `
      <div class="purchase-item" id="purchase-row-${idx}">
        <div class="purchase-item-header">
          <input type="checkbox" class="purchase-done-check" onchange="togglePurchaseDone(${idx})" title="標記購買完成">
          ${imgs ? `<div style="display:flex;gap:4px;">${imgs}</div>` : ''}
          <div class="purchase-item-info">
            <div style="font-weight:700;font-size:13px;">${escHtml(p?.sku || item.sku)} — ${escHtml(item.productName)}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${p?.vendor ? `廠商：${escHtml(p.vendor)}　` : ''}
              ${item.variant ? `款式：${escHtml(item.variant)}　` : ''}
              ${item.size ? `尺寸：${escHtml(item.size)}　` : ''}
              庫存：${p?.stock ?? '-'}　
              ${p?.cost != null ? `成本：NT$ ${p.cost}` : ''}
            </div>
          </div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);white-space:nowrap;">× ${item.qty}</div>
        </div>
        <div class="purchase-customers-toggle" onclick="togglePurchaseCustomers(${idx})">
          📋 查看訂購客戶（${item.customers.length} 人）
        </div>
        <div id="purchase-customers-${idx}" class="purchase-customers-list hidden">
          ${item.customers.join('、') || '（無）'}
        </div>
      </div>`;
  }).join('');
};

window.togglePurchaseDone = function(idx) {
  const row = document.getElementById('purchase-row-' + idx);
  if (row) row.classList.toggle('done');
};

window.togglePurchaseCustomers = function(idx) {
  const el = document.getElementById('purchase-customers-' + idx);
  if (el) el.classList.toggle('hidden');
};

// ===================== AUTO ALLOT =====================
function scheduleAutoAllot() {
  runAutoAllot(); // run on load for any pending
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  const ms = nextMidnight - now;
  setTimeout(() => {
    runAutoAllot();
    setInterval(runAutoAllot, 24 * 60 * 60 * 1000);
  }, ms);
}

async function runAutoAllot() {
  // For each order item with goodsStatus '採買中', check if stock > 0
  for (const o of orders) {
    let changed = false;
    const newItems = (o.items || []).map(item => {
      if ((item.goodsStatus || '採買中') !== '採買中') return item;
      const p = products.find(x => x.id === item.productId);
      if (!p || (p.stock || 0) < (item.qty || 1)) return item;
      // Allot
      return { ...item, goodsStatus: '已配貨', allottedAt: Date.now() };
    });
    // Check if any item changed
    const anyChanged = newItems.some((ni, i) => ni.goodsStatus !== (o.items[i]?.goodsStatus));
    if (!anyChanged) continue;

    // Deduct stock
    for (let i = 0; i < newItems.length; i++) {
      if (newItems[i].goodsStatus === '已配貨' && (o.items[i]?.goodsStatus || '採買中') === '採買中') {
        const p = products.find(x => x.id === newItems[i].productId);
        if (p) {
          await updateDoc(doc(db, 'products', p.id), { stock: Math.max(0, (p.stock || 0) - (newItems[i].qty || 1)) });
        }
      }
    }
    await updateDoc(doc(db, 'orders', o.id), { items: newItems });
  }
}

// ===================== Utils =====================
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
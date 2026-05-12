// app.js
import { db, storage } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

let customers = [], products = [], orders = [];
let editingCustomerId = null, editingProductId = null, editingOrderId = null;
let tempProductImages = [], currentOrderItems = [];
// 自動存檔 debounce timer
let autoSaveTimer = null;

window.onAppReady = function() {
  listenCustomers(); listenProducts(); listenOrders();
  const el = document.getElementById('order-date');
  if (el) el.value = new Date().toISOString().slice(0,10);
  scheduleAutoAllot();
  switchPage('customers', document.querySelector('.nav-item'));
};

function listenCustomers() {
  onSnapshot(collection(db,'customers'), snap => { customers = snap.docs.map(d=>({id:d.id,...d.data()})); renderCustomers(); });
}
function listenProducts() {
  onSnapshot(collection(db,'products'), snap => { products = snap.docs.map(d=>({id:d.id,...d.data()})); renderProducts(); });
}
function listenOrders() {
  onSnapshot(query(collection(db,'orders'),orderBy('date','desc')), snap => { orders = snap.docs.map(d=>({id:d.id,...d.data()})); renderOrders(); });
}

window.switchPage = function(page, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.getElementById('page-'+page)?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
};
window.toggleSidebar = function() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('hidden');
};
window.closeModal = function(id) { document.getElementById(id).classList.add('hidden'); };
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function showToast(msg, ms=2500) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'),ms);
}

// ===== 自動存檔（訂單編輯中變更時，2秒後自動儲存）=====
function triggerAutoSave() {
  if(!editingOrderId) return; // 只對已存在的訂單自動存檔
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async ()=>{
    await doSaveOrder(true); // silent=true 不顯示toast
  }, 2000);
}

// ===== CUSTOMERS =====
window.renderCustomers = function() {
  const search=(document.getElementById('filter-customer-search')?.value||'').toLowerCase();
  const platform=document.getElementById('filter-customer-platform')?.value||'';
  const list=customers.filter(c=>{
    if(platform&&c.platform!==platform) return false;
    if(search&&!c.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const el=document.getElementById('customers-list'); if(!el) return;
  el.innerHTML=list.length===0
    ?'<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無客戶資料</p>'
    :list.map(c=>`
      <div class="card customer-card">
        <div class="card-body">
          <div class="customer-info">
            <h4>${esc(c.name)}</h4>
            <span class="platform-tag">${esc(c.platform||'')}</span>
            ${c.note?`<button class="btn outline small mt-1" onclick="showNote('${c.id}')">📝 備註</button>`:''}
          </div>
          <div class="customer-actions">
            <button class="btn outline small" onclick="openCustomerModal('${c.id}')">✏️ 編輯</button>
            <button class="btn danger small" onclick="deleteCustomer('${c.id}')">🗑️</button>
          </div>
        </div>
      </div>`).join('');
};
window.openCustomerModal = function(id=null) {
  editingCustomerId=id;
  const c=id?customers.find(x=>x.id===id):null;
  document.getElementById('customer-modal-title').textContent=id?'編輯客戶':'新增客戶';
  document.getElementById('cust-name').value=c?c.name:'';
  document.getElementById('cust-platform').value=c?(c.platform||'Line@'):'Line@';
  document.getElementById('cust-note').value=c?(c.note||''):'';
  openModal('customer-modal-overlay');
};
window.saveCustomer = async function() {
  const name=document.getElementById('cust-name').value.trim();
  if(!name){showToast('⚠️ 請輸入客戶名稱');return;}
  const data={name,platform:document.getElementById('cust-platform').value,note:document.getElementById('cust-note').value.trim(),updatedAt:Date.now()};
  if(editingCustomerId){await updateDoc(doc(db,'customers',editingCustomerId),data);showToast('✅ 客戶已更新');}
  else{data.createdAt=Date.now();await addDoc(collection(db,'customers'),data);showToast('✅ 客戶已新增');}
  closeModal('customer-modal-overlay');
};
window.deleteCustomer = async function(id) {
  if(!confirm('確定刪除此客戶？')) return;
  await deleteDoc(doc(db,'customers',id)); showToast('🗑️ 已刪除');
};
window.showNote = function(id) {
  const c=customers.find(x=>x.id===id); if(!c) return;
  document.getElementById('note-modal-content').textContent=c.note||'（無備註）';
  openModal('note-modal-overlay');
};

// ===== PRODUCTS =====
window.renderProducts = function() {
  const cat=document.getElementById('filter-product-category')?.value||'';
  const search=(document.getElementById('filter-product-search')?.value||'').toLowerCase();
  let list=[...products].sort((a,b)=>{
    const na=parseInt((a.sku||'').slice(1))||0;
    const nb=parseInt((b.sku||'').slice(1))||0;
    return nb-na;
  }).filter(p=>{
    if(cat&&p.category!==cat) return false;
    if(search&&!p.name?.toLowerCase().includes(search)&&!p.sku?.toLowerCase().includes(search)) return false;
    return true;
  });
  const el=document.getElementById('products-list'); if(!el) return;
  const groups={};
  list.forEach(p=>{const c=p.category||'其他';if(!groups[c])groups[c]=[];groups[c].push(p);});
  el.innerHTML=Object.entries(groups).map(([cat,prods])=>`
    <h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-muted);font-weight:700;text-transform:uppercase;">${cat}</h3>
    <div class="product-grid">${prods.map(p=>productCardHtml(p)).join('')}</div>
  `).join('')||'<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無商品資料</p>';
};

function productCardHtml(p) {
  const imgs=(p.images||[]).slice(0,4).map(url=>`<img src="${url}" alt="" onclick="window.open('${url}','_blank')">`).join('');
  const variantRows=(p.variants||[]).map(v=>`
    <tr>
      <td style="padding:3px 6px;">${esc(v.name||'')}</td>
      <td style="padding:3px 6px;">${esc(v.size||'-')}</td>
      <td style="padding:3px 6px;text-align:right;">${v.price!=null?'NT$ '+v.price:'-'}</td>
      <td style="padding:3px 6px;text-align:right;">${v.cost!=null?'NT$ '+v.cost:'-'}</td>
      <td style="padding:3px 6px;text-align:right;${(v.stock||0)<=3?'color:var(--danger);font-weight:700;':''}">${v.stock??0}</td>
    </tr>`).join('');
  const totalStock=(p.variants||[]).reduce((s,v)=>s+(v.stock||0),0);
  return `
    <div class="card product-card">
      <div class="card-header">
        <span class="product-sku">${esc(p.sku||'')}</span>
        <span class="product-category-tag">${esc(p.category||'')}</span>
      </div>
      <div class="card-body">
        ${imgs?`<div class="product-images">${imgs}</div>`:''}
        <div style="font-weight:600;margin-bottom:4px;">${esc(p.name||'（未命名）')}</div>
        ${p.variants?.length?`
          <table style="width:100%;font-size:12px;margin-top:6px;border-collapse:collapse;">
            <thead><tr style="background:var(--bg-muted);">
              <th style="padding:3px 6px;text-align:left;">款式/顏色</th>
              <th style="padding:3px 6px;text-align:left;">尺寸</th>
              <th style="padding:3px 6px;text-align:right;">售價</th>
              <th style="padding:3px 6px;text-align:right;">成本</th>
              <th style="padding:3px 6px;text-align:right;">庫存</th>
            </tr></thead>
            <tbody>${variantRows}</tbody>
          </table>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">總庫存：${totalStock} 件</div>
        `:'<div style="font-size:12px;color:var(--text-muted);">尚未設定款式</div>'}
        <div class="product-actions">
          <button class="btn outline small" onclick="openProductModal('${p.id}')">✏️ 編輯</button>
          <button class="btn danger small" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div>
      </div>
    </div>`;
}

window.onCategoryChange = function() { if(!editingProductId) genSKU(); };
async function genSKU() {
  const cat=document.getElementById('prod-category').value;
  if(!cat){document.getElementById('prod-sku').value='';return;}
  const prefix=cat==='服飾'?'A':'N';
  const used=products.filter(p=>p.category===cat).map(p=>p.sku||'');
  let maxN=0;
  used.forEach(sku=>{const n=parseInt(sku.slice(1));if(!isNaN(n)&&n>maxN)maxN=n;});
  let delMax=0;
  try{
    const snap=await getDoc(doc(db,'meta','deletedSKUs'));
    if(snap.exists())(snap.data()[prefix]||[]).forEach(sku=>{const n=parseInt(sku.slice(1));if(!isNaN(n)&&n>delMax)delMax=n;});
  }catch(e){}
  document.getElementById('prod-sku').value=prefix+String(Math.max(maxN,delMax)+1).padStart(2,'0');
}

window.addVariantRow = function(v={}) {
  const container=document.getElementById('prod-variants-container');
  const row=document.createElement('div');
  row.className='variant-row';
  row.style.cssText='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 28px;gap:6px;margin-bottom:6px;align-items:center;';
  row.innerHTML=`
    <input type="text" placeholder="款式/顏色名稱" value="${esc(v.name||'')}">
    <input type="text" placeholder="尺寸" value="${esc(v.size||'')}">
    <input type="number" placeholder="售價" min="0" value="${v.price??''}">
    <input type="number" placeholder="成本" min="0" value="${v.cost??''}">
    <input type="number" placeholder="庫存" min="0" value="${v.stock??0}">
    <button class="btn outline small" style="padding:4px;" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(row);
};

window.handleProductImages = function(e) {
  const files=Array.from(e.target.files);
  const rem=4-tempProductImages.length;
  if(rem<=0){showToast('⚠️ 最多4張圖片');return;}
  files.slice(0,rem).forEach(f=>tempProductImages.push({file:f,url:URL.createObjectURL(f),existing:false}));
  renderProductImagePreviews(); e.target.value='';
};
function renderProductImagePreviews() {
  const area=document.getElementById('prod-images-container'); if(!area) return;
  area.innerHTML=tempProductImages.map((img,i)=>`
    <div class="img-preview-wrap">
      <img src="${img.url}" alt="">
      <button class="img-remove" onclick="removeProductImage(${i})">✕</button>
    </div>`).join('');
}
window.removeProductImage = function(idx) { tempProductImages.splice(idx,1); renderProductImagePreviews(); };

window.openProductModal = async function(id=null) {
  editingProductId=id; tempProductImages=[];
  const p=id?products.find(x=>x.id===id):null;
  document.getElementById('product-modal-title').textContent=id?'編輯商品':'新增商品';
  document.getElementById('prod-category').value=p?(p.category||''):'';
  document.getElementById('prod-sku').value=p?(p.sku||''):'';
  document.getElementById('prod-vendor').value=p?(p.vendor||''):'';
  document.getElementById('prod-name').value=p?(p.name||''):'';
  const vc=document.getElementById('prod-variants-container'); vc.innerHTML='';
  (p?.variants||[]).forEach(v=>addVariantRow(v));
  if(p?.images?.length) p.images.forEach(url=>tempProductImages.push({file:null,url,existing:true,storedUrl:url}));
  renderProductImagePreviews();
  openModal('product-modal-overlay');
};

window.saveProduct = async function() {
  const category=document.getElementById('prod-category').value;
  if(!category){showToast('⚠️ 請選擇商品分類');return;}
  const sku=document.getElementById('prod-sku').value;
  const imageUrls=[];
  for(const img of tempProductImages){
    if(img.existing){imageUrls.push(img.storedUrl);}
    else{
      try{
        const r=ref(storage,`products/${sku}_${Date.now()}_${img.file.name}`);
        await uploadBytes(r,img.file);
        imageUrls.push(await getDownloadURL(r));
      }catch(e){showToast('⚠️ 圖片上傳失敗，跳過');}
    }
  }
  const variants=Array.from(document.querySelectorAll('#prod-variants-container .variant-row')).map(row=>{
    const inputs=row.querySelectorAll('input');
    return{name:inputs[0]?.value.trim()||'',size:inputs[1]?.value.trim()||'',price:inputs[2]?.value!==''?Number(inputs[2].value):null,cost:inputs[3]?.value!==''?Number(inputs[3].value):null,stock:inputs[4]?.value!==''?Number(inputs[4].value):0};
  }).filter(v=>v.name);
  const data={category,sku,vendor:document.getElementById('prod-vendor').value.trim(),name:document.getElementById('prod-name').value.trim(),variants,images:imageUrls,updatedAt:Date.now()};
  if(editingProductId){await updateDoc(doc(db,'products',editingProductId),data);showToast('✅ 商品已更新');}
  else{data.createdAt=Date.now();await addDoc(collection(db,'products'),data);showToast('✅ 商品已新增');}
  closeModal('product-modal-overlay');
};

window.deleteProduct = async function(id) {
  if(!confirm('確定刪除此商品？')) return;
  const p=products.find(x=>x.id===id); if(!p) return;
  if(p.sku){
    const prefix=p.sku[0];
    const mref=doc(db,'meta','deletedSKUs');
    const snap=await getDoc(mref);
    const ex=snap.exists()?(snap.data()[prefix]||[]):[];
    await setDoc(mref,{[prefix]:[...ex,p.sku]},{merge:true});
  }
  await deleteDoc(doc(db,'products',id)); showToast('🗑️ 商品已刪除');
};

// ===== ORDERS =====
window.renderOrders = function() {
  const df=document.getElementById('filter-date-from')?.value||'';
  const dt=document.getElementById('filter-date-to')?.value||'';
  const status=document.getElementById('filter-order-status')?.value||'';
  const search=(document.getElementById('filter-order-search')?.value||'').toLowerCase();
  const list=orders.filter(o=>{
    if(df&&o.date<df) return false;
    if(dt&&o.date>dt) return false;
    if(status&&o.status!==status) return false;
    if(search){
      const cust=customers.find(c=>c.id===o.customerId);
      if(!o.orderNo?.toLowerCase().includes(search)&&!cust?.name?.toLowerCase().includes(search)) return false;
    }
    return true;
  });
  const el=document.getElementById('orders-list'); if(!el) return;
  el.innerHTML=list.length===0
    ?'<p style="color:var(--text-muted);text-align:center;padding:40px;">尚無訂單資料</p>'
    :list.map(o=>orderCardHtml(o)).join('');
};

function orderCardHtml(o) {
  const cust=customers.find(c=>c.id===o.customerId);
  const itemSummary=(o.items||[]).map(i=>`${esc(i.productName||'')} ${i.variant?`[${esc(i.variant)}]`:''} ${i.size?`/ ${esc(i.size)}`:''} × ${i.qty}${i.allotted?` (配貨${i.allotted})`:''} — <span class="badge ${i.goodsStatus||'採買中'}">${i.goodsStatus||'採買中'}</span>`).join('<br>');
  const total=calcTotal(o);
  return `
    <div class="card order-card" onclick="openOrderModal('${o.id}')">
      <div class="card-header">
        <div>
          <span class="order-id">${esc(o.orderNo||o.id.slice(0,8))}</span>
          <span style="margin-left:8px;color:var(--text-muted);font-size:12px;">${o.date||''}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="badge ${o.status||''}">${o.status||''}</span>
          <button class="btn outline small" onclick="event.stopPropagation();downloadOrderImage('${o.id}')">🖼️</button>
          <button class="btn outline small" onclick="event.stopPropagation();downloadOrderPDF('${o.id}')">📄</button>
          <button class="btn danger small" onclick="event.stopPropagation();deleteOrder('${o.id}')">🗑️</button>
        </div>
      </div>
      <div class="card-body">
        <div class="order-meta">
          <span style="font-weight:600;">${cust?esc(cust.name):'未知客戶'}</span>
          ${cust?.platform?`<span style="font-size:11px;background:var(--accent-light);color:var(--accent);padding:1px 7px;border-radius:20px;">${esc(cust.platform)}</span>`:''}
          ${o.deposit?'<span class="badge 已配貨" style="font-size:10px;">定金✓</span>':'<span class="badge 缺貨" style="font-size:10px;">定金✗</span>'}
          ${o.balance?'<span class="badge 已配貨" style="font-size:10px;">尾款✓</span>':'<span class="badge 缺貨" style="font-size:10px;">尾款✗</span>'}
        </div>
        <div class="order-items-summary">${itemSummary}</div>
        <div class="order-totals">
          <span>總額：</span><span class="order-total-amount">NT$ ${total.toLocaleString()}</span>
          <span style="color:var(--text-muted);font-size:12px;">寄送：${esc(o.shippingMethod||'')}</span>
        </div>
      </div>
    </div>`;
}

function calcTotal(o) {
  const sub=(o.items||[]).reduce((s,i)=>s+(i.qty||0)*(i.priceSnapshot||0),0);
  const disc=Number(o.coupon||0)+Number(o.credit||0)+Number(o.prepaid||0);
  return sub+Number(o.shippingFee||0)-disc;
}

window.openOrderModal = async function(id=null) {
  editingOrderId=id; currentOrderItems=[];
  clearTimeout(autoSaveTimer);
  const o=id?orders.find(x=>x.id===id):null;
  document.getElementById('order-modal-title').textContent=id?'編輯訂單':'新增訂單';
  document.getElementById('order-customer-search').value='';
  document.getElementById('order-customer-id').value=o?.customerId||'';
  const cust=o?customers.find(c=>c.id===o.customerId):null;
  const selInfo=document.getElementById('selected-customer-info');
  if(cust){
    document.getElementById('order-customer-search').value=cust.name;
    selInfo.textContent=`${cust.name}（${cust.platform||''}）`;
    selInfo.classList.remove('hidden');
    if(cust.note) setTimeout(()=>{document.getElementById('note-modal-content').textContent=cust.note;openModal('note-modal-overlay');},300);
  }else{selInfo.classList.add('hidden');}
  document.getElementById('order-date').value=o?.date||new Date().toISOString().slice(0,10);
  document.getElementById('order-status').value=o?.status||'採買中';
  document.getElementById('order-shipping-method').value=o?.shippingMethod||'7-11';
  document.getElementById('order-shipping-fee').value=o?.shippingFee??60;
  document.getElementById('order-coupon').value=o?.coupon??0;
  document.getElementById('order-credit').value=o?.credit??0;
  document.getElementById('order-prepaid').value=o?.prepaid??0;
  document.getElementById('order-deposit').checked=o?.deposit||false;
  document.getElementById('order-balance').checked=o?.balance||false;
  currentOrderItems=o?JSON.parse(JSON.stringify(o.items||[])):[];
  renderOrderItemsUI(); calcOrderTotal();
  document.getElementById('btn-download-order').classList.toggle('hidden',!id);
  document.getElementById('btn-download-pdf').classList.toggle('hidden',!id);
  const si=document.getElementById('order-item-search'); if(si) si.value='';
  document.getElementById('order-product-dropdown')?.classList.add('hidden');
  openModal('order-modal-overlay');
};

window.filterOrderProductDropdown = function() {
  const q=(document.getElementById('order-item-search')?.value||'').toLowerCase();
  const dd=document.getElementById('order-product-dropdown');
  if(!q){dd.classList.add('hidden');return;}
  const matches=products.filter(p=>p.sku?.toLowerCase().includes(q)||p.name?.toLowerCase().includes(q));
  if(!matches.length){dd.classList.add('hidden');return;}
  dd.innerHTML=matches.map(p=>`
    <div class="dropdown-item" onclick="quickAddProduct('${p.id}')">
      <span>[${esc(p.sku||'')}] ${esc(p.name||'')}</span>
      <span style="font-size:11px;color:var(--text-muted);">${p.variants?.length?p.variants.length+'款':'NT$ '+(p.variants?.[0]?.price??'?')}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
};
window.quickAddProduct = function(productId) {
  document.getElementById('order-product-dropdown').classList.add('hidden');
  document.getElementById('order-item-search').value='';
  const p=products.find(x=>x.id===productId); if(!p) return;
  const firstPrice=p.variants?.[0]?.price??0;
  currentOrderItems.push({productId:p.id,sku:p.sku||'',productName:p.name||'',priceSnapshot:firstPrice,variant:'',size:'',qty:1,allotted:0,goodsStatus:'採買中'});
  renderOrderItemsUI(); calcOrderTotal();
};

function renderOrderItemsUI() {
  const container=document.getElementById('order-items-container');
  container.innerHTML=currentOrderItems.map((item,idx)=>{
    const p=products.find(x=>x.id===item.productId);
    const variants=p?.variants||[];
    const imgs=(p?.images||[]).slice(0,4).map(url=>`<img src="${url}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid var(--border);">`).join('');
    return `
      <div class="order-item-row" id="order-item-${idx}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span class="order-item-sku">${esc(item.sku||'')}</span>
          <span class="order-item-name" style="flex:1;min-width:80px;">${esc(item.productName||'')}</span>
          ${imgs?`<div style="display:flex;gap:3px;">${imgs}</div>`:''}
          <button class="btn danger small" style="padding:3px 7px;flex-shrink:0;" onclick="removeOrderItem(${idx})">✕</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:flex-end;">
          <div style="flex:2;min-width:90px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">款式/顏色</div>
            ${variants.length
              ?`<select style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'variant',this.value);updateVariantPrice(${idx},this.value)">
                  ${[''].concat(variants.map(v=>v.name||'')).map(v=>`<option ${item.variant===v?'selected':''}>${v}</option>`).join('')}
                </select>`
              :`<input type="text" value="${esc(item.variant||'')}" placeholder="款式" style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'variant',this.value)">`}
          </div>
          <div style="flex:1;min-width:65px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">尺寸</div>
            ${(variants.length&&variants.some(v=>v.size))
              ?`<select style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'size',this.value)">
                  ${[''].concat([...new Set(variants.filter(v=>v.size).map(v=>v.size))]).map(s=>`<option ${item.size===s?'selected':''}>${s}</option>`).join('')}
                </select>`
              :`<input type="text" value="${esc(item.size||'')}" placeholder="尺寸" style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'size',this.value)">`}
          </div>
          <div style="width:52px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">數量</div>
            <input type="number" min="1" value="${item.qty||1}" style="width:100%;font-size:13px;padding:6px 4px;" oninput="updateOrderItem(${idx},'qty',this.value)">
          </div>
          <div style="width:52px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">配貨量</div>
            <input type="number" min="0" value="${item.allotted||0}" style="width:100%;font-size:13px;padding:6px 4px;background:var(--accent-light);border-color:var(--accent);" oninput="updateOrderItem(${idx},'allotted',this.value);updateGoodsStatus(${idx})">
          </div>
          <div style="width:75px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">單價</div>
            <div style="font-size:12px;color:var(--text-muted);padding:6px 5px;background:var(--bg-muted);border-radius:var(--radius-sm);">NT$ ${Number(item.priceSnapshot||0).toLocaleString()}</div>
          </div>
          <div style="width:80px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">小計</div>
            <div id="subtotal-${idx}" style="font-size:12px;font-weight:600;color:var(--accent);padding:6px 5px;background:var(--bg-muted);border-radius:var(--radius-sm);">
              NT$ ${((item.qty||1)*(item.priceSnapshot||0)).toLocaleString()}
            </div>
          </div>
          <div style="flex:1;min-width:110px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">貨品狀況</div>
            <select style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'goodsStatus',this.value)">
              ${['採買中','已配貨','缺貨','官網訂購中'].map(s=>`<option ${item.goodsStatus===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`;
  }).join('');
}

// 修正2：配貨量變更時自動更新貨品狀況
window.updateGoodsStatus = function(idx) {
  const item=currentOrderItems[idx];
  const allotted=Number(item.allotted||0);
  const qty=Number(item.qty||1);
  let status='採買中';
  if(allotted>=qty) status='已配貨';
  else if(allotted>0) status='採買中'; // 部分配貨
  currentOrderItems[idx].goodsStatus=status;
  // 更新下拉選單
  const sel=document.querySelector(`#order-item-${idx} select[onchange*="goodsStatus"]`);
  if(sel) sel.value=status;
  triggerAutoSave();
};

window.updateVariantPrice = function(idx, variantName) {
  const item=currentOrderItems[idx];
  const p=products.find(x=>x.id===item.productId);
  const v=p?.variants?.find(x=>(x.name||x)===variantName);
  if(v&&v.price!=null){currentOrderItems[idx].priceSnapshot=v.price;renderOrderItemsUI();calcOrderTotal();}
};

window.updateOrderItem = function(idx, field, value) {
  currentOrderItems[idx][field]=(field==='qty'||field==='allotted')?Number(value):value;
  if(field==='qty'){
    const sub=(currentOrderItems[idx].qty||1)*(currentOrderItems[idx].priceSnapshot||0);
    const el=document.getElementById(`subtotal-${idx}`);
    if(el) el.textContent='NT$ '+sub.toLocaleString();
    calcOrderTotal();
  }
  triggerAutoSave();
};
window.removeOrderItem = function(idx) { currentOrderItems.splice(idx,1); renderOrderItemsUI(); calcOrderTotal(); triggerAutoSave(); };

window.addOrderItem = function() {
  const opts=products.map(p=>`<option value="${p.id}">[${p.sku||''}] ${p.name||'（未命名）'}</option>`).join('');
  const container=document.getElementById('order-items-container');
  const pickerId='prod-picker-'+Date.now();
  const div=document.createElement('div');
  div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:10px;';
  div.innerHTML=`<select id="${pickerId}" style="flex:1"><option value="">選擇商品...</option>${opts}</select>
    <button class="btn primary small" onclick="confirmAddProduct('${pickerId}',this.parentElement)">確認</button>
    <button class="btn outline small" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(div);
};
window.confirmAddProduct = function(pickerId,row) {
  const sel=document.getElementById(pickerId);
  const productId=sel.value; if(!productId){showToast('⚠️ 請選擇商品');return;}
  const p=products.find(x=>x.id===productId); if(!p) return;
  const firstPrice=p.variants?.[0]?.price??0;
  currentOrderItems.push({productId:p.id,sku:p.sku||'',productName:p.name||'',priceSnapshot:firstPrice,variant:'',size:'',qty:1,allotted:0,goodsStatus:'採買中'});
  row.remove(); renderOrderItemsUI(); calcOrderTotal();
};

window.calcOrderTotal = function() {
  const sub=currentOrderItems.reduce((s,i)=>s+(i.qty||1)*(i.priceSnapshot||0),0);
  const method=document.getElementById('order-shipping-method')?.value||'7-11';
  const ship=method==='7-11'?(sub>=3000?0:60):(sub>=5000?0:180);
  const coupon=Number(document.getElementById('order-coupon')?.value||0);
  const credit=Number(document.getElementById('order-credit')?.value||0);
  const prepaid=Number(document.getElementById('order-prepaid')?.value||0);
  const totalDisc=coupon+credit+prepaid;
  if(document.getElementById('order-shipping-fee')) document.getElementById('order-shipping-fee').value=ship;
  document.getElementById('display-subtotal').textContent='NT$ '+sub.toLocaleString();
  document.getElementById('display-shipping').textContent='NT$ '+ship.toLocaleString();
  document.getElementById('display-discount').textContent='− NT$ '+totalDisc.toLocaleString();
  document.getElementById('display-total').textContent='NT$ '+(sub+ship-totalDisc).toLocaleString();
  triggerAutoSave();
};

window.filterCustomerDropdown = function() {
  const q=document.getElementById('order-customer-search').value.toLowerCase();
  const dd=document.getElementById('customer-dropdown');
  const matches=customers.filter(c=>c.name.toLowerCase().includes(q));
  if(!q||!matches.length){dd.classList.add('hidden');return;}
  dd.innerHTML=matches.map(c=>`
    <div class="dropdown-item" onclick="selectOrderCustomer('${c.id}','${escA(c.name)}','${escA(c.platform||'')}','${escA(c.note||'')}')">
      ${esc(c.name)} <span style="font-size:11px;color:var(--text-muted)">${esc(c.platform||'')}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
};
window.selectOrderCustomer = function(id,name,platform,note) {
  document.getElementById('order-customer-id').value=id;
  document.getElementById('order-customer-search').value=name;
  document.getElementById('customer-dropdown').classList.add('hidden');
  const si=document.getElementById('selected-customer-info');
  si.textContent=`${name}（${platform}）`; si.classList.remove('hidden');
  if(note){document.getElementById('note-modal-content').textContent=note;openModal('note-modal-overlay');}
  triggerAutoSave();
};

// 儲存訂單（silent=true 表示自動存檔不顯示toast）
async function doSaveOrder(silent=false) {
  const customerId=document.getElementById('order-customer-id').value;
  if(!customerId) return;
  if(!currentOrderItems.length) return;
  const sub=currentOrderItems.reduce((s,i)=>s+(i.qty||1)*(i.priceSnapshot||0),0);
  const method=document.getElementById('order-shipping-method').value;
  const shippingFee=method==='7-11'?(sub>=3000?0:60):(sub>=5000?0:180);
  const data={
    customerId,date:document.getElementById('order-date').value,
    status:document.getElementById('order-status').value,
    shippingMethod:method,shippingFee,
    coupon:Number(document.getElementById('order-coupon').value||0),
    credit:Number(document.getElementById('order-credit').value||0),
    prepaid:Number(document.getElementById('order-prepaid').value||0),
    deposit:document.getElementById('order-deposit').checked,
    balance:document.getElementById('order-balance').checked,
    items:currentOrderItems,updatedAt:Date.now()
  };
  if(editingOrderId){
    await updateDoc(doc(db,'orders',editingOrderId),data);
    if(!silent) showToast('✅ 訂單已更新');
    else showToast('💾 自動儲存完成',1500);
  }else{
    const ymd=data.date.replace(/-/g,'');
    const count=orders.filter(o=>o.date===data.date).length+1;
    data.orderNo=`ORD-${ymd}-${String(count).padStart(3,'0')}`;
    data.createdAt=Date.now();
    const newDoc=await addDoc(collection(db,'orders'),data);
    editingOrderId=newDoc.id; // 儲存後設定 id，之後自動存檔用
    if(!silent) showToast('✅ 訂單已新增');
  }
}

window.saveOrder = async function() {
  const customerId=document.getElementById('order-customer-id').value;
  if(!customerId){showToast('⚠️ 請選擇客戶');return;}
  if(!currentOrderItems.length){showToast('⚠️ 請至少新增一個品項');return;}
  await doSaveOrder(false);
  closeModal('order-modal-overlay');
};

window.deleteOrder = async function(id) {
  if(!confirm('確定刪除此訂單？')) return;
  await deleteDoc(doc(db,'orders',id)); showToast('🗑️ 訂單已刪除');
};

// ===== DOWNLOAD =====
function loadScript(src) {
  return new Promise(resolve=>{
    if(document.querySelector(`script[src="${src}"]`)){resolve();return;}
    const s=document.createElement('script');s.src=src;s.onload=resolve;document.head.appendChild(s);
  });
}
async function buildReceiptEl(orderId) {
  const o=orders.find(x=>x.id===orderId); if(!o) return null;
  const cust=customers.find(c=>c.id===o.customerId);
  const sub=(o.items||[]).reduce((s,i)=>s+(i.qty||0)*(i.priceSnapshot||0),0);
  const disc=Number(o.coupon||0)+Number(o.credit||0)+Number(o.prepaid||0);
  const total=sub+Number(o.shippingFee||0)-disc;
  const el=document.createElement('div');
  el.style.cssText='width:480px;background:#fff;padding:28px;font-family:sans-serif;color:#0F172A;font-size:14px;';
  el.innerHTML=`
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:28px;">🛍️</div>
      <h2 style="font-size:20px;font-weight:700;margin:4px 0;">代購訂單明細</h2>
      <p style="color:#64748B;font-size:12px;">${o.orderNo||o.id.slice(0,8)}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#64748B;">客戶</span><strong>${esc(cust?.name||'未知')}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#64748B;">平台</span><span>${esc(cust?.platform||'-')}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#64748B;">日期</span><span>${o.date||'-'}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:#64748B;">寄送</span><span>${esc(o.shippingMethod||'-')}</span></div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
      <thead><tr style="background:#F8FAFC;">
        <th style="padding:7px;text-align:left;border-bottom:1px solid #E2E8F0;">品名</th>
        <th style="padding:7px;text-align:center;border-bottom:1px solid #E2E8F0;">款式/尺寸</th>
        <th style="padding:7px;text-align:center;border-bottom:1px solid #E2E8F0;">數量</th>
        <th style="padding:7px;text-align:right;border-bottom:1px solid #E2E8F0;">小計</th>
        <th style="padding:7px;text-align:center;border-bottom:1px solid #E2E8F0;">狀態</th>
      </tr></thead>
      <tbody>${(o.items||[]).map(i=>`
        <tr>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;">${esc(i.productName||'')}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:center;">${esc([i.variant,i.size].filter(Boolean).join(' / ')||'-')}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:center;">${i.qty}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:right;">NT$ ${((i.qty||0)*(i.priceSnapshot||0)).toLocaleString()}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:center;">${i.goodsStatus||'-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="border-top:1px solid #E2E8F0;padding-top:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;"><span>小計</span><span>NT$ ${sub.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;"><span>運費</span><span>NT$ ${Number(o.shippingFee||0).toLocaleString()}</span></div>
      ${o.coupon?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>折價券</span><span>− NT$ ${o.coupon}</span></div>`:''}
      ${o.credit?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>購物金</span><span>− NT$ ${o.credit}</span></div>`:''}
      ${o.prepaid?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>訂金</span><span>− NT$ ${o.prepaid}</span></div>`:''}
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:8px;"><span>總額</span><span style="color:#2563EB;">NT$ ${total.toLocaleString()}</span></div>
    </div>
    <div style="margin-top:14px;padding:10px;background:#F8FAFC;border-radius:8px;font-size:12px;color:#64748B;display:flex;gap:16px;">
      <span>定金：${o.deposit?'✅ 已付':'❌ 未付'}</span>
      <span>尾款：${o.balance?'✅ 已付':'❌ 未付'}</span>
    </div>`;
  return el;
}
window.downloadOrderImage = async function(orderId) {
  showToast('⏳ 準備下載圖片...');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  const el=await buildReceiptEl(orderId||editingOrderId); if(!el) return;
  document.body.appendChild(el); el.style.cssText+=';position:fixed;top:-9999px;left:-9999px;';
  const canvas=await html2canvas(el,{scale:2,useCORS:true,backgroundColor:'#fff'});
  document.body.removeChild(el);
  const link=document.createElement('a');
  link.download=`訂單-${orderId||editingOrderId||'receipt'}.png`;
  link.href=canvas.toDataURL('image/png'); link.click();
  showToast('✅ 圖片已下載');
};
window.downloadOrderPDF = async function(orderId) {
  showToast('⏳ 準備下載PDF...');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const el=await buildReceiptEl(orderId||editingOrderId); if(!el) return;
  document.body.appendChild(el); el.style.cssText+=';position:fixed;top:-9999px;left:-9999px;';
  const canvas=await html2canvas(el,{scale:2,useCORS:true,backgroundColor:'#fff'});
  document.body.removeChild(el);
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pw=pdf.internal.pageSize.getWidth();
  pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,pw,canvas.height*pw/canvas.width);
  pdf.save(`訂單-${orderId||editingOrderId||'receipt'}.pdf`);
  showToast('✅ PDF已下載');
};

// ===== PURCHASE LIST =====
window.compilePurchaseList = function() {
  const map={};
  orders.forEach(o=>{
    (o.items||[]).forEach(item=>{
      if((item.goodsStatus||'採買中')!=='採買中') return;
      const key=`${item.productId}_${item.variant||''}_${item.size||''}`;
      if(!map[key]){
        const p=products.find(x=>x.id===item.productId);
        let stock=0;
        if(p?.variants?.length){
          const v=p.variants.find(x=>(x.name||x)===item.variant);
          stock=v?.stock??0;
        }
        map[key]={productId:item.productId,sku:item.sku||'',productName:item.productName||'',variant:item.variant||'',size:item.size||'',orderedQty:0,stock,product:p,customers:[]};
      }
      map[key].orderedQty+=(item.qty||0);
      const cust=customers.find(c=>c.id===o.customerId);
      if(cust) map[key].customers.push({name:cust.name,qty:item.qty||0});
    });
  });
  const el=document.getElementById('purchase-list');
  const items=Object.values(map);
  if(!items.length){el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:40px;">目前沒有採買中的品項</p>';return;}
  el.innerHTML=items.map((item,idx)=>{
    const p=item.product;
    const imgs=(p?.images||[]).slice(0,2).map(url=>`<img src="${url}" alt="" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">`).join('');
    const need=Math.max(0,item.orderedQty-item.stock);
    return `
      <div class="purchase-item" id="purchase-row-${idx}">
        <div class="purchase-item-header">
          <input type="checkbox" class="purchase-done-check" onchange="togglePurchaseDone(${idx})">
          ${imgs?`<div style="display:flex;gap:4px;">${imgs}</div>`:''}
          <div class="purchase-item-info">
            <div style="font-weight:700;font-size:13px;">${esc(p?.sku||item.sku)} — ${esc(item.productName)}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${p?.vendor?`廠商：${esc(p.vendor)}　`:''}
              ${item.variant?`款式：${esc(item.variant)}　`:''}
              ${item.size?`尺寸：${esc(item.size)}　`:''}
              庫存：${item.stock}　訂購量：${item.orderedQty}
              ${p?.variants?.find(v=>v.name===item.variant)?.cost!=null?`　成本：NT$ ${p.variants.find(v=>v.name===item.variant).cost}`:''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:20px;font-weight:700;color:${need>0?'var(--danger)':'var(--success)'};">需採買 × ${need}</div>
            ${need===0?'<div style="font-size:11px;color:var(--success);">庫存充足</div>':''}
          </div>
        </div>
        <div class="purchase-customers-toggle" onclick="togglePurchaseCustomers(${idx})">📋 查看訂購客戶（${item.customers.length} 人）</div>
        <div id="purchase-customers-${idx}" class="purchase-customers-list hidden">
          ${item.customers.map(c=>`${esc(c.name)}（${c.qty}件）`).join('、')||'（無）'}
        </div>
      </div>`;
  }).join('');
};
window.togglePurchaseDone = function(idx){document.getElementById('purchase-row-'+idx)?.classList.toggle('done');};
window.togglePurchaseCustomers = function(idx){document.getElementById('purchase-customers-'+idx)?.classList.toggle('hidden');};

// ===== AUTO ALLOT =====
function scheduleAutoAllot() {
  runAutoAllot();
  const now=new Date(),next=new Date(now);
  next.setDate(next.getDate()+1);next.setHours(0,0,0,0);
  setTimeout(()=>{runAutoAllot();setInterval(runAutoAllot,86400000);},next-now);
}
async function runAutoAllot() {
  for(const o of orders){
    const newItems=(o.items||[]).map(item=>({...item}));
    let changed=false;
    for(let i=0;i<newItems.length;i++){
      const item=newItems[i];
      if((item.goodsStatus||'採買中')!=='採買中') continue;
      const p=products.find(x=>x.id===item.productId); if(!p) continue;
      let vIdx=-1,stock=p.stock||0,useVariant=false;
      if(p.variants?.length&&item.variant){
        vIdx=p.variants.findIndex(v=>(v.name||v)===item.variant);
        if(vIdx>=0&&p.variants[vIdx].stock!=null){stock=p.variants[vIdx].stock;useVariant=true;}
      }
      if(stock<(item.qty||1)) continue;
      newItems[i]={...item,goodsStatus:'已配貨',allotted:item.qty,allottedAt:Date.now()};
      changed=true;
      if(useVariant){
        const nv=[...p.variants];
        nv[vIdx]={...nv[vIdx],stock:Math.max(0,stock-(item.qty||1))};
        await updateDoc(doc(db,'products',p.id),{variants:nv});
      }else{
        await updateDoc(doc(db,'products',p.id),{stock:Math.max(0,(p.stock||0)-(item.qty||1))});
      }
    }
    if(changed) await updateDoc(doc(db,'orders',o.id),{items:newItems});
  }
}

function esc(str){if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escA(str){if(!str)return'';return String(str).replace(/'/g,"\\'").replace(/\n/g,' ');}
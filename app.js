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
let autoSaveTimer = null;
let stockUpdateProductId = null;

window.onAppReady = function() {
  listenCustomers(); listenProducts(); listenOrders();
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
window.closeModal = function(id) { document.getElementById(id)?.classList.add('hidden'); };

// 修正1：各自獨立關閉，不依賴 try/catch，直接呼叫
window.closeCustomerModal = function() {
  document.getElementById('customer-modal-overlay').classList.add('hidden');
  resetBtn('save-customer-btn','💾 儲存');
};
window.closeProductModal = function() {
  document.getElementById('product-modal-overlay').classList.add('hidden');
  resetBtn('save-product-btn','💾 儲存');
};
window.closeOrderModal = function() {
  document.getElementById('order-modal-overlay').classList.add('hidden');
  resetBtn('save-order-btn','💾 儲存訂單');
  clearTimeout(autoSaveTimer);
};

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }

// 修正1：重設按鈕狀態的輔助函數
function resetBtn(id, label) {
  const btn = document.getElementById(id);
  if(btn) { btn.disabled = false; btn.textContent = label; }
}
function setBtnLoading(id, label) {
  const btn = document.getElementById(id);
  if(btn) { btn.disabled = true; btn.textContent = label; }
}

function showToast(msg, ms=2500) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'),ms);
}
function triggerAutoSave() {
  if(!editingOrderId) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async()=>{ await doSaveOrder(true); }, 2000);
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
  resetBtn('save-customer-btn','💾 儲存');
  openModal('customer-modal-overlay');
};

// 修正1：不用 try/catch，直接執行，完成後立刻關閉
window.saveCustomer = async function() {
  const btn=document.getElementById('save-customer-btn');
  if(btn?.disabled) return;
  const name=document.getElementById('cust-name').value.trim();
  if(!name){showToast('⚠️ 請輸入客戶名稱');return;}
  setBtnLoading('save-customer-btn','儲存中...');
  const data={name,platform:document.getElementById('cust-platform').value,note:document.getElementById('cust-note').value.trim(),updatedAt:Date.now()};
  if(editingCustomerId){
    await updateDoc(doc(db,'customers',editingCustomerId),data);
  } else {
    data.createdAt=Date.now();
    await addDoc(collection(db,'customers'),data);
  }
  showToast(editingCustomerId?'✅ 客戶已更新':'✅ 客戶已新增');
  closeCustomerModal();
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
      <td style="padding:3px 6px;">${esc(v.color||v.name||'')}</td>
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
              <th style="padding:3px 6px;text-align:left;">顏色/款式</th>
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
          <button class="btn primary small" onclick="openStockModal('${p.id}')">📦 入庫</button>
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
  const usedNums=new Set();
  products.filter(p=>p.category===cat).forEach(p=>{const n=parseInt((p.sku||'').slice(1));if(!isNaN(n))usedNums.add(n);});
  try{
    const snap=await getDoc(doc(db,'meta','deletedSKUs'));
    if(snap.exists())(snap.data()[prefix]||[]).forEach(sku=>{const n=parseInt(sku.slice(1));if(!isNaN(n))usedNums.add(n);});
  }catch(e){}
  let next=1; while(usedNums.has(next)) next++;
  document.getElementById('prod-sku').value=prefix+String(next).padStart(2,'0');
}

// 修正2：新增顏色群組時，自動帶入上一個群組的售價、成本、尺寸和庫存
window.addColorGroup = function(colorData={}) {
  const container=document.getElementById('prod-colors-container');
  let lastPrice='', lastCost='', lastSizes=[];
  const existingGroups=container.querySelectorAll(':scope > div[id^="cg-"]');
  if(existingGroups.length>0 && !colorData.color && !colorData.name){
    const lastGroup=existingGroups[existingGroups.length-1];
    lastPrice=lastGroup.querySelector('.color-price-input')?.value||'';
    lastCost=lastGroup.querySelector('.color-cost-input')?.value||'';
    // 修正2：抓取上一個群組的尺寸和庫存
    lastGroup.querySelectorAll('[class^="sizes-container-"] > div').forEach(row=>{
      const size=row.querySelector('.size-name')?.value.trim()||'';
      const stock=row.querySelector('.size-stock')?.value||'0';
      if(size) lastSizes.push({size, stock});
    });
  }
  const groupId='cg-'+Date.now()+Math.random().toString(36).slice(2,5);
  const div=document.createElement('div');
  div.id=groupId;
  div.style.cssText='border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-muted);';
  div.innerHTML=`
    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap;">
      <div style="flex:2;min-width:100px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">顏色/款式名稱 <span style="color:var(--danger)">*</span></div>
        <input type="text" placeholder="例：黑色、白色、格紋..." value="${esc(colorData.color||colorData.name||'')}" class="color-name-input" style="width:100%;">
      </div>
      <div style="width:90px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">售價</div>
        <input type="number" placeholder="售價" min="0" value="${colorData.price!=null?colorData.price:lastPrice}" class="color-price-input" style="width:100%;">
      </div>
      <div style="width:80px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">成本</div>
        <input type="number" placeholder="成本" min="0" value="${colorData.cost!=null?colorData.cost:lastCost}" class="color-cost-input" style="width:100%;">
      </div>
      <button class="btn danger small" onclick="document.getElementById('${groupId}').remove()">✕ 刪除</button>
    </div>
    <div style="margin-left:8px;">
      <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px;">尺寸（可多個）：</div>
      <div class="sizes-container-${groupId}"></div>
      <button class="btn outline small" onclick="addSizeRow('${groupId}')">＋ 新增尺寸</button>
    </div>`;
  container.appendChild(div);
  // 修正2：使用已有資料或上一組的尺寸/庫存
  const sizesToLoad = colorData.sizes?.length ? colorData.sizes : (lastSizes.length ? lastSizes : [{size:'',stock:0}]);
  sizesToLoad.forEach(s=>addSizeRow(groupId,s));
};

window.addSizeRow = function(groupId, sizeData={}) {
  const container=document.querySelector(`.sizes-container-${groupId}`);
  if(!container) return;
  const row=document.createElement('div');
  row.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:5px;';
  row.innerHTML=`
    <input type="text" placeholder="尺寸（S、M、L、XL、free...）" value="${esc(sizeData.size||'')}" style="flex:2;" class="size-name">
    <input type="number" placeholder="庫存" min="0" value="${sizeData.stock??0}" style="width:70px;" class="size-stock">
    <button class="btn outline small" style="padding:4px 7px;" onclick="this.parentElement.remove()">✕</button>`;
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
  document.getElementById('prod-colors-container').innerHTML='';
  if(p?.variants?.length){
    const colorMap={};
    p.variants.forEach(v=>{
      const colorKey=v.color||v.name||'';
      if(!colorMap[colorKey]) colorMap[colorKey]={color:colorKey,price:v.price,cost:v.cost,sizes:[]};
      colorMap[colorKey].sizes.push({size:v.size||'',stock:v.stock??0});
    });
    Object.values(colorMap).forEach(cg=>addColorGroup(cg));
  }
  if(p?.images?.length) p.images.forEach(url=>tempProductImages.push({file:null,url,existing:true,storedUrl:url}));
  renderProductImagePreviews();
  resetBtn('save-product-btn','💾 儲存');
  openModal('product-modal-overlay');
};

// 修正1：移除 try/catch，直接執行
window.saveProduct = async function() {
  const btn=document.getElementById('save-product-btn');
  if(btn?.disabled) return;
  const category=document.getElementById('prod-category').value;
  if(!category){showToast('⚠️ 請選擇商品分類');return;}
  const sku=document.getElementById('prod-sku').value;
  if(!sku){showToast('⚠️ 請先選擇分類產生貨號');return;}
  if(!editingProductId){
    const exists=products.find(p=>p.sku===sku);
    if(exists){showToast('⚠️ 貨號已存在');await genSKU();return;}
  }
  setBtnLoading('save-product-btn','儲存中...');
  const imageUrls=[];
  for(const img of tempProductImages){
    if(img.existing){imageUrls.push(img.storedUrl);}
    else{
      try{
        const r=ref(storage,`products/${sku}_${Date.now()}_${img.file.name}`);
        await uploadBytes(r,img.file);
        imageUrls.push(await getDownloadURL(r));
      }catch(e){}
    }
  }
  const variants=[];
  document.querySelectorAll('#prod-colors-container > div[id^="cg-"]').forEach(group=>{
    const colorName=group.querySelector('.color-name-input')?.value.trim()||'';
    const price=group.querySelector('.color-price-input')?.value;
    const cost=group.querySelector('.color-cost-input')?.value;
    group.querySelectorAll('.sizes-container-'+group.id+' > div').forEach(sizeRow=>{
      const size=sizeRow.querySelector('.size-name')?.value.trim()||'';
      const stock=Number(sizeRow.querySelector('.size-stock')?.value||0);
      if(colorName||size){
        variants.push({color:colorName,name:colorName,size,price:price!==''&&price!=null?Number(price):null,cost:cost!==''&&cost!=null?Number(cost):null,stock});
      }
    });
  });
  const data={category,sku,vendor:document.getElementById('prod-vendor').value.trim(),name:document.getElementById('prod-name').value.trim(),variants,images:imageUrls,updatedAt:Date.now()};
  if(editingProductId){
    await updateDoc(doc(db,'products',editingProductId),data);
    showToast('✅ 商品已更新');
  } else {
    data.createdAt=Date.now();
    await addDoc(collection(db,'products'),data);
    showToast('✅ 商品已新增');
  }
  closeProductModal();
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

// 修正3：單一品項入庫
window.openStockModal = function(productId) {
  stockUpdateProductId=productId;
  const p=products.find(x=>x.id===productId); if(!p) return;
  document.getElementById('stock-modal-title').textContent=`📦 入庫更新 — ${esc(p.name||p.sku)}`;
  const container=document.getElementById('stock-update-container');
  container.innerHTML=(p.variants||[]).map((v,i)=>`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:8px;background:var(--bg-muted);border-radius:6px;">
      <div style="flex:1;font-size:13px;"><strong>${esc(v.color||v.name||'')}</strong>${v.size?' / '+esc(v.size):''}</div>
      <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;">現有：${v.stock??0} 件</div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:12px;color:var(--text-muted);">入庫＋</span>
        <input type="number" min="0" value="0" style="width:65px;" id="stock-input-${i}" placeholder="0">
      </div>
    </div>`).join('')||'<p style="color:var(--text-muted);">此商品尚未設定款式</p>';
  openModal('stock-modal-overlay');
};

window.confirmStockUpdate = async function() {
  const p=products.find(x=>x.id===stockUpdateProductId); if(!p) return;
  const newVariants=p.variants.map((v,i)=>{
    const input=document.getElementById(`stock-input-${i}`);
    const add=input?Number(input.value)||0:0;
    return add>0?{...v,stock:(v.stock||0)+add}:v;
  });
  await updateDoc(doc(db,'products',stockUpdateProductId),{variants:newVariants,updatedAt:Date.now()});
  showToast('✅ 庫存已更新');
  closeModal('stock-modal-overlay');
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
  const itemSummary=(o.items||[]).map(i=>`${esc(i.productName||'')} ${(i.color||i.variant)?`[${esc(i.color||i.variant)}]`:''} ${i.size?`/ ${esc(i.size)}`:''} × ${i.qty}${i.allotted?` (配${i.allotted})`:''} — <span class="badge ${i.goodsStatus||'採買中'}">${i.goodsStatus||'採買中'}</span>`).join('<br>');
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
  const selInfo=document.getElementById('selected-customer-info');
  const cust=o?customers.find(c=>c.id===o.customerId):null;
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
  resetBtn('save-order-btn','💾 儲存訂單');
  openModal('order-modal-overlay');
  setTimeout(()=>{ const body=document.getElementById('order-modal-body'); if(body) body.scrollTop=0; },50);
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
    </div>`).join('');
  dd.classList.remove('hidden');
};
window.quickAddProduct = function(productId) {
  document.getElementById('order-product-dropdown').classList.add('hidden');
  document.getElementById('order-item-search').value='';
  addProductToOrder(productId);
};

function addProductToOrder(productId) {
  const p=products.find(x=>x.id===productId); if(!p) return;
  const firstPrice=p.variants?.[0]?.price??0;
  currentOrderItems.push({productId:p.id,sku:p.sku||'',productName:p.name||'',priceSnapshot:firstPrice,color:'',variant:'',size:'',qty:1,allotted:0,goodsStatus:'採買中'});
  renderOrderItemsUI(); calcOrderTotal();
}

window.addOrderItemByCategory = function(category) {
  const catProducts=products.filter(p=>p.category===category).sort((a,b)=>{
    const na=parseInt((a.sku||'').slice(1))||0, nb=parseInt((b.sku||'').slice(1))||0;
    return na-nb;
  });
  if(!catProducts.length){showToast(`⚠️ 尚無${category}商品`);return;}
  const container=document.getElementById('order-items-container');
  const pickerId='prod-picker-'+Date.now();
  const div=document.createElement('div');
  div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:10px;';
  const opts=catProducts.map(p=>`<option value="${p.id}">[${p.sku||''}] ${p.name||'（未命名）'}</option>`).join('');
  div.innerHTML=`<select id="${pickerId}" style="flex:1"><option value="">選擇${category}商品...</option>${opts}</select>
    <button class="btn primary small" onclick="confirmPickProduct('${pickerId}',this.parentElement)">確認</button>
    <button class="btn outline small" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(div);
};
window.confirmPickProduct = function(pickerId,row) {
  const sel=document.getElementById(pickerId);
  const productId=sel.value; if(!productId){showToast('⚠️ 請選擇商品');return;}
  addProductToOrder(productId); row.remove();
};

function getVariantStock(productId, colorKey, sizeKey) {
  const p=products.find(x=>x.id===productId);
  if(!p?.variants?.length) return 0;
  const v=p.variants.find(x=>(x.color||x.name||'')===colorKey&&(x.size||'')===(sizeKey||''));
  return v?.stock??0;
}

function renderOrderItemsUI() {
  const container=document.getElementById('order-items-container');
  container.innerHTML=currentOrderItems.map((item,idx)=>{
    const p=products.find(x=>x.id===item.productId);
    const variants=p?.variants||[];
    const colors=[...new Set(variants.map(v=>v.color||v.name||'').filter(Boolean))];
    const selectedColor=item.color||item.variant||'';
    const sizesForColor=variants.filter(v=>(v.color||v.name||'')===selectedColor).map(v=>v.size||'').filter(Boolean);
    const imgs=(p?.images||[]).slice(0,4).map(url=>`<img src="${url}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid var(--border);">`).join('');
    // 修正5：取得目前庫存，決定配貨量上限
    const currentStock=getVariantStock(item.productId, selectedColor, item.size||'');
    // 修正6：配貨量上限 = min(訂購量, 已配+庫存)，但不超過訂購量
    const maxAllotted=item.qty||1;
    // 修正5：若庫存為0且尚未配貨，顯示警告
    const stockWarning = currentStock===0 && (item.allotted||0)===0;
    return `
      <div class="order-item-row" id="order-item-${idx}" style="${stockWarning?'border-color:var(--warn);':''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span class="order-item-sku">${esc(item.sku||'')}</span>
          <span class="order-item-name" style="flex:1;min-width:80px;">${esc(item.productName||'')}</span>
          ${imgs?`<div style="display:flex;gap:3px;">${imgs}</div>`:''}
          <button class="btn danger small" style="padding:3px 7px;flex-shrink:0;" onclick="removeOrderItem(${idx})">✕</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:flex-end;">
          <div style="flex:2;min-width:90px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">顏色/款式</div>
            ${colors.length
              ?`<select style="width:100%;font-size:13px;" onchange="onColorChange(${idx},this.value)">
                  <option value="">請選擇...</option>
                  ${colors.map(c=>`<option value="${esc(c)}" ${selectedColor===c?'selected':''}>${esc(c)}</option>`).join('')}
                </select>`
              :`<input type="text" value="${esc(selectedColor)}" placeholder="顏色/款式" style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'color',this.value)">`}
          </div>
          <div style="flex:1;min-width:65px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">尺寸</div>
            ${sizesForColor.length
              ?`<select style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'size',this.value)">
                  <option value="">請選擇...</option>
                  ${sizesForColor.map(s=>`<option value="${esc(s)}" ${item.size===s?'selected':''}>${esc(s)}</option>`).join('')}
                </select>`
              :`<input type="text" value="${esc(item.size||'')}" placeholder="尺寸" style="width:100%;font-size:13px;" onchange="updateOrderItem(${idx},'size',this.value)">`}
          </div>
          <div style="width:52px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">數量</div>
            <input type="number" min="1" value="${item.qty||1}" style="width:100%;font-size:13px;padding:6px 4px;" oninput="updateOrderItem(${idx},'qty',this.value)">
          </div>
          <div style="width:60px;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">
              配貨量
              ${stockWarning?'<span style="color:var(--warn)" title="庫存不足">⚠️</span>':''}
            </div>
            <!-- 修正5+6：max=訂購量，庫存0時disabled -->
            <input type="number" min="0" max="${maxAllotted}"
              value="${item.allotted||0}"
              ${currentStock===0&&(item.allotted||0)===0?'disabled title="庫存為0，無法配貨"':''}
              style="width:100%;font-size:13px;padding:6px 4px;background:${currentStock===0&&(item.allotted||0)===0?'var(--bg-muted)':'var(--accent-light)'};border-color:var(--accent);"
              oninput="onAllottedChange(${idx},this.value)">
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
        ${currentStock>0?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">目前庫存：${currentStock} 件</div>`:''}
      </div>`;
  }).join('');
}

window.onColorChange = function(idx, colorValue) {
  currentOrderItems[idx].color=colorValue;
  currentOrderItems[idx].variant=colorValue;
  currentOrderItems[idx].size='';
  const p=products.find(x=>x.id===currentOrderItems[idx].productId);
  const v=p?.variants?.find(x=>(x.color||x.name||'')===colorValue);
  if(v?.price!=null) currentOrderItems[idx].priceSnapshot=v.price;
  renderOrderItemsUI(); calcOrderTotal(); triggerAutoSave();
};

// 修正4+5+6：配貨量變更
window.onAllottedChange = async function(idx, value) {
  const item=currentOrderItems[idx];
  const qty=item.qty||1;
  // 修正6：不超過訂購量
  let newAllotted=Math.min(Number(value)||0, qty);
  newAllotted=Math.max(0,newAllotted);

  // 修正5：不超過庫存
  const colorKey=item.color||item.variant||'';
  const currentStock=getVariantStock(item.productId, colorKey, item.size||'');
  const oldAllotted=Number(item.allotted||0);
  const diff=newAllotted-oldAllotted;

  // 如果要增加配貨，確認庫存是否足夠
  if(diff>0 && currentStock<diff){
    showToast(`⚠️ 庫存不足！目前庫存：${currentStock} 件`);
    newAllotted=oldAllotted+currentStock; // 最多配到庫存量
    newAllotted=Math.min(newAllotted,qty);
  }

  currentOrderItems[idx].allotted=newAllotted;
  // 修正4：配貨量 >= 訂購量時，自動設為「已配貨」
  currentOrderItems[idx].goodsStatus=newAllotted>=qty?'已配貨':'採買中';

  // 同步扣減庫存
  const actualDiff=newAllotted-oldAllotted;
  if(actualDiff!==0 && editingOrderId){
    const p=products.find(x=>x.id===item.productId);
    if(p?.variants?.length){
      const vIdx=p.variants.findIndex(v=>(v.color||v.name||'')===colorKey&&(v.size||'')===(item.size||''));
      if(vIdx>=0){
        const nv=[...p.variants];
        nv[vIdx]={...nv[vIdx],stock:Math.max(0,(nv[vIdx].stock||0)-actualDiff)};
        await updateDoc(doc(db,'products',p.id),{variants:nv});
      }
    }
  }
  renderOrderItemsUI(); triggerAutoSave();
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

async function doSaveOrder(silent=false) {
  const customerId=document.getElementById('order-customer-id').value;
  if(!customerId||!currentOrderItems.length) return;
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
    else showToast('💾 自動儲存',1500);
  } else {
    const ymd=data.date.replace(/-/g,'');
    const count=orders.filter(o=>o.date===data.date).length+1;
    data.orderNo=`ORD-${ymd}-${String(count).padStart(3,'0')}`;
    data.createdAt=Date.now();
    const newDoc=await addDoc(collection(db,'orders'),data);
    editingOrderId=newDoc.id;
    if(!silent) showToast('✅ 訂單已新增');
  }
}

// 修正1：saveOrder 不用 try/catch
window.saveOrder = async function() {
  const btn=document.getElementById('save-order-btn');
  if(btn?.disabled) return;
  const customerId=document.getElementById('order-customer-id').value;
  if(!customerId){showToast('⚠️ 請選擇客戶');return;}
  if(!currentOrderItems.length){showToast('⚠️ 請至少新增一個品項');return;}
  setBtnLoading('save-order-btn','儲存中...');
  await doSaveOrder(false);
  closeOrderModal();
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
      <div style="font-size:18px;font-weight:700;letter-spacing:2px;color:#2563EB;">SENCE.TW</div>
      <h2 style="font-size:18px;font-weight:700;margin:4px 0;">訂單明細</h2>
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
      </tr></thead>
      <tbody>${(o.items||[]).map(i=>`
        <tr>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;">${esc(i.productName||'')}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:center;">${esc([(i.color||i.variant),i.size].filter(Boolean).join(' / ')||'-')}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:center;">${i.qty}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #F1F5F9;text-align:right;">NT$ ${((i.qty||0)*(i.priceSnapshot||0)).toLocaleString()}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="border-top:1px solid #E2E8F0;padding-top:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;"><span>小計</span><span>NT$ ${sub.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748B;"><span>運費</span><span>NT$ ${Number(o.shippingFee||0).toLocaleString()}</span></div>
      ${o.coupon?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>折價券</span><span>− NT$ ${o.coupon}</span></div>`:''}
      ${o.credit?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>購物金</span><span>− NT$ ${o.credit}</span></div>`:''}
      ${o.prepaid?`<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#DC2626;"><span>定金</span><span>− NT$ ${o.prepaid}</span></div>`:''}
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
      if((item.goodsStatus||'採買中')==='已配貨'&&(item.allotted||0)>=(item.qty||1)) return;
      if((item.goodsStatus||'採買中')==='缺貨'||(item.goodsStatus||'採買中')==='官網訂購中') return;
      const colorKey=item.color||item.variant||'';
      const key=`${item.productId}_${colorKey}_${item.size||''}`;
      if(!map[key]){
        const p=products.find(x=>x.id===item.productId);
        const stock=getVariantStock(item.productId,colorKey,item.size||'');
        map[key]={productId:item.productId,sku:item.sku||'',productName:item.productName||'',color:colorKey,size:item.size||'',orderedQty:0,allottedQty:0,stock,product:p,customers:[]};
      }
      map[key].orderedQty+=(item.qty||0);
      map[key].allottedQty+=(item.allotted||0);
      const cust=customers.find(c=>c.id===o.customerId);
      if(cust) map[key].customers.push({name:cust.name,qty:item.qty||0,allotted:item.allotted||0});
    });
  });
  const el=document.getElementById('purchase-list');
  const items=Object.values(map);
  if(!items.length){el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:40px;">目前沒有採買中的品項</p>';return;}
  el.innerHTML=items.map((item,idx)=>{
    const p=item.product;
    const imgs=(p?.images||[]).slice(0,2).map(url=>`<img src="${url}" alt="" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">`).join('');
    const remaining=item.orderedQty-item.allottedQty;
    const need=Math.max(0,remaining-item.stock);
    return `
      <div class="purchase-item" id="purchase-row-${idx}">
        <div class="purchase-item-header">
          <input type="checkbox" class="purchase-done-check" onchange="togglePurchaseDone(${idx})">
          ${imgs?`<div style="display:flex;gap:4px;">${imgs}</div>`:''}
          <div class="purchase-item-info">
            <div style="font-weight:700;font-size:13px;">${esc(p?.sku||item.sku)} — ${esc(item.productName)}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${p?.vendor?`廠商：${esc(p.vendor)}　`:''}
              ${item.color?`顏色：${esc(item.color)}　`:''}
              ${item.size?`尺寸：${esc(item.size)}　`:''}
            </div>
            <div style="font-size:12px;margin-top:3px;">
              訂購：<strong>${item.orderedQty}</strong>　
              已配貨：<strong style="color:var(--success)">${item.allottedQty}</strong>　
              庫存：<strong>${item.stock}</strong>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:20px;font-weight:700;color:${need>0?'var(--danger)':'var(--success)'};">需採買 × ${need}</div>
            ${need===0?'<div style="font-size:11px;color:var(--success);">已足夠</div>':''}
          </div>
        </div>
        <div class="purchase-customers-toggle" onclick="togglePurchaseCustomers(${idx})">📋 查看訂購客戶（${item.customers.length} 人）</div>
        <div id="purchase-customers-${idx}" class="purchase-customers-list hidden">
          ${item.customers.map(c=>`${esc(c.name)}（訂${c.qty}件${c.allotted?`，配${c.allotted}件`:''}）`).join('、')||'（無）'}
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
      const colorKey=item.color||item.variant||'';
      let vIdx=-1,stock=p.stock||0,useVariant=false;
      if(p.variants?.length){
        vIdx=p.variants.findIndex(v=>(v.color||v.name||'')===colorKey&&(v.size||'')===(item.size||''));
        if(vIdx>=0&&p.variants[vIdx].stock!=null){stock=p.variants[vIdx].stock;useVariant=true;}
      }
      if(stock<(item.qty||1)) continue;
      newItems[i]={...item,goodsStatus:'已配貨',allotted:item.qty,allottedAt:Date.now()};
      changed=true;
      if(useVariant){
        const nv=[...p.variants];
        nv[vIdx]={...nv[vIdx],stock:Math.max(0,stock-(item.qty||1))};
        await updateDoc(doc(db,'products',p.id),{variants:nv});
      } else {
        await updateDoc(doc(db,'products',p.id),{stock:Math.max(0,(p.stock||0)-(item.qty||1))});
      }
    }
    if(changed) await updateDoc(doc(db,'orders',o.id),{items:newItems});
  }
}

function esc(str){if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escA(str){if(!str)return'';return String(str).replace(/'/g,"\\'").replace(/\n/g,' ');}
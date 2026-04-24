import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js';
import {
  TYPE_CATEGORY_MAP, CATEGORY_LABELS, SOURCE_REQUIRED_CATEGORIES,
  addTransaction, updateTransaction, deleteTransaction, getTransactions,
  addStudent, updateStudent, deleteStudent, getStudents, recordStudentPayment,
  addFaculty, updateFaculty, deleteFaculty, getFaculty, recordFacultyPayment,
  addInvestor, updateInvestor, deleteInvestor, getInvestors, recordInvestment,
  sumBy, studentPaid, facultyPaid, investorTotal, txnsForSource
} from './store.js';

// ============================================================
// STATE
// ============================================================
const state = {
  user: null,
  txns: [],
  students: [],
  faculty: [],
  investors: [],
  currentMonth: new Date().getMonth(),
  currentYear:  new Date().getFullYear(),
  confirmAction: null   // () => Promise for current confirm-modal target
};

// ============================================================
// HELPERS
// ============================================================
const $  = (id) => document.getElementById(id);
const q  = (sel) => document.querySelector(sel);
const qa = (sel) => document.querySelectorAll(sel);

const formatMoney = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(n || 0));

const formatDate = (s) =>
  new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const monthName = (i) => new Date(0, i).toLocaleString('en-US', { month: 'long' });

const todayISO = () => new Date().toISOString().slice(0, 10);

const categoryLabel = (cat) => CATEGORY_LABELS[cat] || String(cat || '').replace(/-/g, ' ');

const methodLabel = (m) => ({ cash: 'Cash', upi: 'UPI', bank: 'Bank' }[m] || m);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function toast(message, type = 'success') {
  const container = $('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? 'fa-check-circle' : type === 'info' ? 'fa-info-circle' : 'fa-exclamation-circle';
  el.innerHTML = `<i class="fas ${icon}"></i> ${escapeHtml(message)}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function openModal(id)  { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

// ESC closes top-most modal; clicking the dimmed overlay closes it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') qa('.modal-overlay.active').forEach(m => m.classList.remove('active'));
});
qa('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});
qa('[data-close]').forEach(btn => {
  btn.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.remove('active'));
});

// ============================================================
// AUTH
// ============================================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    state.user = user;
    $('login-screen').style.display = 'none';
    $('app').style.display = 'flex';
    $('user-email').textContent = user.email;
    $('user-name').textContent = user.displayName || user.email.split('@')[0];
    $('user-avatar').textContent = (user.displayName || user.email).charAt(0).toUpperCase();
    boot();
  } else {
    state.user = null;
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
  }
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value;
  const password = $('login-password').value;
  const btn = $('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Signing In…';
  $('login-error').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    $('login-error').textContent = 'Invalid email or password';
    btn.disabled = false;
    btn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
  }
});

$('logout-btn').addEventListener('click', () => signOut(auth));

// ============================================================
// NAVIGATION
// ============================================================
function switchPage(pageId, title) {
  qa('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === pageId));
  qa('.page').forEach(p => p.classList.toggle('active', p.id === `page-${pageId}`));
  $('page-title').textContent = title;
  if (window.innerWidth <= 768) {
    $('sidebar').classList.remove('open');
    $('sidebar-backdrop').classList.remove('active');
  }
}

qa('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(item.dataset.page, item.querySelector('span').textContent);
  });
});

qa('.card-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const id = link.dataset.page;
    switchPage(id, id.charAt(0).toUpperCase() + id.slice(1));
  });
});

$('menu-btn').addEventListener('click', () => {
  $('sidebar').classList.add('open');
  $('sidebar-backdrop').classList.add('active');
});
$('sidebar-close').addEventListener('click', () => {
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('active');
});
$('sidebar-backdrop').addEventListener('click', () => {
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('active');
});

// ============================================================
// BOOT
// ============================================================
async function boot() {
  await loadAll();
  setupMonthPicker();
  setupReportControls();
  renderAll();
}

async function loadAll() {
  const [t, s, f, i] = await Promise.all([
    getTransactions(), getStudents(), getFaculty(), getInvestors()
  ]);
  state.txns      = t.data || [];
  state.students  = s.data || [];
  state.faculty   = f.data || [];
  state.investors = i.data || [];
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderStudents();
  renderFaculty();
  renderInvestors();
  renderReports();
}

// ============================================================
// DASHBOARD
// ============================================================
function setupMonthPicker() {
  const label = $('month-label');
  const update = () => label.textContent = `${monthName(state.currentMonth)} ${state.currentYear}`;
  $('prev-month').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    update(); renderDashboard();
  });
  $('next-month').addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    update(); renderDashboard();
  });
  update();
}

function inMonth(t, month, year) {
  const d = new Date(t.date);
  return d.getMonth() === month && d.getFullYear() === year;
}

function renderDashboard() {
  const monthTxns = state.txns.filter(t => inMonth(t, state.currentMonth, state.currentYear));

  // Monthly totals
  const income     = sumBy(monthTxns, t => t.type === 'income');
  const expenses   = sumBy(monthTxns, t => t.type === 'expense');
  const investment = sumBy(monthTxns, t => t.type === 'investment');
  const netProfit  = income - expenses;
  const cash       = income + investment - expenses;

  $('stat-income').textContent     = formatMoney(income);
  $('stat-expense').textContent    = formatMoney(expenses);
  $('stat-investment').textContent = formatMoney(investment);
  $('stat-balance').textContent    = formatMoney(netProfit);
  $('stat-cash-hint').textContent  = `Cash in Hand: ${formatMoney(cash)}`;

  // All-time totals
  const allIncome     = sumBy(state.txns, t => t.type === 'income');
  const allExpenses   = sumBy(state.txns, t => t.type === 'expense');
  const allInvestment = sumBy(state.txns, t => t.type === 'investment');
  const allNet        = allIncome - allExpenses;
  const allCash       = allIncome + allInvestment - allExpenses;

  $('stat-all-income').textContent     = formatMoney(allIncome);
  $('stat-all-expense').textContent    = formatMoney(allExpenses);
  $('stat-all-investment').textContent = formatMoney(allInvestment);
  $('stat-all-balance').textContent    = formatMoney(allNet);
  $('stat-all-cash-hint').textContent  = `Cash in Hand: ${formatMoney(allCash)}`;

  // Cash position by payment method (all-time)
  const byMethod = { cash: 0, upi: 0, bank: 0 };
  for (const t of state.txns) {
    const sign = t.type === 'expense' ? -1 : 1;
    if (byMethod[t.paymentMethod] !== undefined) {
      byMethod[t.paymentMethod] += sign * Number(t.amount || 0);
    }
  }
  $('cash-balance-cash').textContent = formatMoney(byMethod.cash);
  $('cash-balance-upi').textContent  = formatMoney(byMethod.upi);
  $('cash-balance-bank').textContent = formatMoney(byMethod.bank);

  // Expense breakdown (monthly) — per category
  const expenseByCat = {};
  for (const t of monthTxns) {
    if (t.type !== 'expense') continue;
    expenseByCat[t.category] = (expenseByCat[t.category] || 0) + Number(t.amount || 0);
  }
  const bars = $('breakdown-bars');
  const entries = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    bars.innerHTML = `<div class="empty-state"><i class="fas fa-chart-bar"></i><p>No expenses this month</p></div>`;
  } else {
    const max = Math.max(...entries.map(e => e[1]));
    bars.innerHTML = entries.map(([cat, val]) => {
      const pct = max > 0 ? (val / max) * 100 : 0;
      return `
        <div class="breakdown-item">
          <div class="breakdown-label">
            <span class="breakdown-dot" style="background:${colorForCategory(cat)}"></span>
            <span>${escapeHtml(categoryLabel(cat))}</span>
            <span class="breakdown-amount">${formatMoney(val)}</span>
          </div>
          <div class="breakdown-bar">
            <div class="breakdown-fill" style="width:${pct}%; background:${colorForCategory(cat)}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Recent txns (monthly)
  const recent = monthTxns.slice(0, 5);
  const recentList = $('recent-transactions');
  if (recent.length === 0) {
    recentList.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i><p>No transactions this month</p></div>`;
  } else {
    recentList.innerHTML = recent.map(t => {
      const icon = t.type === 'income' ? 'fa-arrow-down'
                 : t.type === 'investment' ? 'fa-hand-holding-usd'
                 : 'fa-arrow-up';
      const sign = t.type === 'expense' ? '-' : '+';
      const label = t.sourceName || t.note || categoryLabel(t.category);
      return `
        <div class="recent-item">
          <div class="recent-icon ${t.type}"><i class="fas ${icon}"></i></div>
          <div class="recent-details">
            <div class="recent-note">${escapeHtml(label)}</div>
            <div class="recent-meta">${formatDate(t.date)} • ${methodLabel(t.paymentMethod)}</div>
          </div>
          <div class="recent-amount ${t.type}">${sign}${formatMoney(t.amount)}</div>
        </div>`;
    }).join('');
  }

  // Student summary
  let collected = 0, dues = 0;
  for (const s of state.students) {
    const paid = studentPaid(state.txns, s.id);
    collected += paid;
    dues += Math.max(0, Number(s.totalFee || 0) - paid);
  }
  $('total-students').textContent  = state.students.length;
  $('total-collected').textContent = formatMoney(collected);
  $('total-dues').textContent      = formatMoney(dues);

  // Faculty summary
  const facPaid = state.faculty.reduce((s, f) => s + facultyPaid(state.txns, f.id), 0);
  $('total-faculty').textContent      = state.faculty.length;
  $('total-paid-faculty').textContent = formatMoney(facPaid);
}

const CATEGORY_COLORS = {
  'student-fee':     '#22c55e',
  'other-income':    '#10b981',
  'faculty-payment': '#3b82f6',
  'operational':     '#f59e0b',
  'course-creation': '#a855f7',
  'marketing':       '#ec4899',
  'other-expense':   '#ef4444',
  'capital':         '#8b5cf6'
};
const colorForCategory = (c) => CATEGORY_COLORS[c] || '#64748b';

// ============================================================
// TRANSACTIONS — direct add/edit form (no source link)
// ============================================================
// The direct add form only allows categories that do NOT require a source.
const DIRECT_CATEGORIES = {
  income: TYPE_CATEGORY_MAP.income.filter(c => !SOURCE_REQUIRED_CATEGORIES[c]),
  expense: TYPE_CATEGORY_MAP.expense.filter(c => !SOURCE_REQUIRED_CATEGORIES[c])
};

function populateCategoryOptions(type, selected) {
  const select = $('txn-category');
  const opts = DIRECT_CATEGORIES[type] || [];
  select.innerHTML = opts.map(v =>
    `<option value="${v}">${categoryLabel(v)}</option>`
  ).join('');
  if (selected && opts.includes(selected)) select.value = selected;
}

$('txn-type').addEventListener('change', (e) => populateCategoryOptions(e.target.value));

$('add-transaction-btn').addEventListener('click', () => {
  $('transaction-form').reset();
  $('txn-date').value = todayISO();
  $('edit-txn-id').value = '';
  $('modal-title').textContent = 'Add Transaction';
  $('txn-submit-text').textContent = 'Save Transaction';
  $('txn-type').value = 'expense';
  populateCategoryOptions('expense');
  openModal('transaction-modal');
});

$('transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#transaction-form button[type="submit"]');
  btn.disabled = true;

  const editId = $('edit-txn-id').value;
  const payload = {
    date:          $('txn-date').value,
    type:          $('txn-type').value,
    category:      $('txn-category').value,
    amount:        $('txn-amount').value,
    note:          $('txn-note').value,
    paymentMethod: $('txn-method').value,
    sourceType:    'direct',
    sourceId:      null,
    sourceName:    null
  };

  const res = editId
    ? await updateTransaction(editId, payload)
    : await addTransaction(payload, state.user.email);

  if (res.success) {
    toast(editId ? 'Transaction updated' : 'Transaction added');
    closeModal('transaction-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed to save', 'error');
  }
  btn.disabled = false;
});

// Filter toggle (mobile collapsible)
$('filters-toggle').addEventListener('click', () => {
  $('filters-toggle').classList.toggle('open');
  $('filters-body').classList.toggle('open');
});

// Transactions filters
['filter-from', 'filter-to', 'filter-type', 'filter-method', 'filter-search'].forEach(id => {
  $(id).addEventListener('input', () => renderTransactions());
});
$('reset-filters').addEventListener('click', () => {
  ['filter-from', 'filter-to', 'filter-search'].forEach(id => $(id).value = '');
  $('filter-type').value = 'all';
  $('filter-method').value = 'all';
  renderTransactions();
});

function renderTransactions() {
  const from   = $('filter-from').value;
  const to     = $('filter-to').value;
  const type   = $('filter-type').value;
  const method = $('filter-method').value;
  const q      = $('filter-search').value.trim().toLowerCase();

  let list = state.txns;
  if (from) list = list.filter(t => t.date >= from);
  if (to)   list = list.filter(t => t.date <= to);
  if (type !== 'all')   list = list.filter(t => t.type === type);
  if (method !== 'all') list = list.filter(t => t.paymentMethod === method);
  if (q) {
    list = list.filter(t =>
      (t.note || '').toLowerCase().includes(q) ||
      (t.sourceName || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  }

  const tbody = $('transactions-tbody');
  const empty = $('transactions-empty');
  const table = $('transactions-table');

  if (list.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = list.map(t => {
    const src = t.sourceType === 'direct'
      ? '<span class="muted">Direct</span>'
      : `<span class="source-pill source-${t.sourceType}">${escapeHtml(t.sourceName || t.sourceType)}</span>`;
    const isLinked = t.sourceType !== 'direct';
    return `
      <tr>
        <td data-label="Date">${formatDate(t.date)}</td>
        <td data-label="Type"><span class="type-badge ${t.type}">${t.type}</span></td>
        <td data-label="Category"><span class="cat-badge">${escapeHtml(categoryLabel(t.category))}</span></td>
        <td data-label="Source">${src}</td>
        <td data-label="Amount" class="amount-cell ${t.type}">${formatMoney(t.amount)}</td>
        <td data-label="Note">${escapeHtml(t.note || '-')}</td>
        <td data-label="Method"><span class="method-badge">${methodLabel(t.paymentMethod)}</span></td>
        <td data-label="By">${escapeHtml((t.addedBy || '').split('@')[0])}</td>
        <td data-label="">
          ${isLinked ? '' : `<button class="action-btn edit" data-edit-txn="${t.id}" title="Edit"><i class="fas fa-edit"></i></button>`}
          <button class="action-btn delete" data-del-txn="${t.id}" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  }).join('');

  qa('[data-edit-txn]').forEach(btn => btn.addEventListener('click', onEditTxn));
  qa('[data-del-txn]').forEach(btn => btn.addEventListener('click', onDeleteTxn));
}

function onEditTxn(e) {
  const id = e.currentTarget.dataset.editTxn;
  const t = state.txns.find(x => x.id === id);
  if (!t) return;
  // Only direct (non-source-linked) txns are editable from this form.
  $('modal-title').textContent = 'Edit Transaction';
  $('txn-submit-text').textContent = 'Update Transaction';
  $('edit-txn-id').value = t.id;
  $('txn-date').value = t.date;
  $('txn-type').value = t.type;
  populateCategoryOptions(t.type, t.category);
  $('txn-amount').value = t.amount;
  $('txn-note').value = t.note || '';
  $('txn-method').value = t.paymentMethod;
  openModal('transaction-modal');
}

function onDeleteTxn(e) {
  const id = e.currentTarget.dataset.delTxn;
  askConfirm({
    text: 'Delete this transaction? This cannot be undone.',
    showCascade: false,
    action: async () => {
      const res = await deleteTransaction(id);
      if (!res.success) return toast(res.error || 'Delete failed', 'error');
      toast('Transaction deleted');
      await loadAll();
      renderAll();
    }
  });
}

// ============================================================
// STUDENTS
// ============================================================
$('add-student-btn').addEventListener('click', () => {
  $('student-form').reset();
  $('edit-stu-id').value = '';
  $('student-modal-title').textContent = 'Add Student';
  $('stu-submit-text').textContent = 'Add Student';
  openModal('student-modal');
});

$('student-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#student-form button[type="submit"]');
  btn.disabled = true;
  const id = $('edit-stu-id').value;
  const data = {
    studentName: $('stu-name').value,
    batchName:   $('stu-batch').value,
    totalFee:    $('stu-fee').value
  };
  const res = id ? await updateStudent(id, data) : await addStudent(data);
  if (res.success) {
    toast(id ? 'Student updated' : 'Student added');
    closeModal('student-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

$('search-students').addEventListener('input', (e) => renderStudents(e.target.value));

function renderStudents(search = '') {
  const grid = $('students-grid');
  const q = search.toLowerCase();
  const list = q
    ? state.students.filter(s =>
        (s.studentName || '').toLowerCase().includes(q) ||
        (s.batchName   || '').toLowerCase().includes(q))
    : state.students;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1"><i class="fas fa-user-graduate"></i><p>${state.students.length === 0 ? 'No students added yet' : 'No students match your search'}</p></div>`;
    return;
  }

  grid.innerHTML = list.map(s => {
    const paid = studentPaid(state.txns, s.id);
    const due  = Math.max(0, Number(s.totalFee || 0) - paid);
    const pct  = s.totalFee > 0 ? Math.min(100, (paid / s.totalFee) * 100) : 0;
    return `
      <div class="student-card">
        <div class="student-card-header">
          <div>
            <div class="student-name">${escapeHtml(s.studentName)}</div>
            <div class="student-batch">${escapeHtml(s.batchName)}</div>
          </div>
          <div>
            <button class="action-btn edit" data-edit-stu="${s.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete" data-del-stu="${s.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="student-fees">
          <div class="fee-item"><span class="fee-label">Total</span><span class="fee-value">${formatMoney(s.totalFee)}</span></div>
          <div class="fee-item"><span class="fee-label">Paid</span><span class="fee-value paid">${formatMoney(paid)}</span></div>
          <div class="fee-item"><span class="fee-label">Due</span><span class="fee-value ${due > 0 ? 'due' : ''}">${formatMoney(due)}</span></div>
        </div>
        <div class="student-card-actions" style="display:flex; gap:.5rem;">
          <button class="btn btn-secondary btn-sm" data-stu-history="${s.id}" style="flex:1"><i class="fas fa-history"></i> History</button>
          <button class="btn btn-primary btn-sm" data-stu-pay="${s.id}" style="flex:1" ${due <= 0 ? 'disabled title="Fully paid"' : ''}><i class="fas fa-money-bill-wave"></i> Pay</button>
        </div>
      </div>`;
  }).join('');

  qa('[data-edit-stu]').forEach(b => b.addEventListener('click', onEditStudent));
  qa('[data-del-stu]').forEach(b => b.addEventListener('click', onDeleteStudent));
  qa('[data-stu-history]').forEach(b => b.addEventListener('click', onStudentHistory));
  qa('[data-stu-pay]').forEach(b => b.addEventListener('click', onStudentPay));
}

function onEditStudent(e) {
  const id = e.currentTarget.dataset.editStu;
  const s = state.students.find(x => x.id === id);
  if (!s) return;
  $('edit-stu-id').value = s.id;
  $('student-modal-title').textContent = 'Edit Student';
  $('stu-submit-text').textContent = 'Save Changes';
  $('stu-name').value = s.studentName;
  $('stu-batch').value = s.batchName;
  $('stu-fee').value = s.totalFee;
  openModal('student-modal');
}

function onDeleteStudent(e) {
  const id = e.currentTarget.dataset.delStu;
  const s = state.students.find(x => x.id === id);
  const paid = studentPaid(state.txns, id);
  askConfirm({
    text: paid > 0
      ? `Delete ${s?.studentName}? They have ₹${paid.toLocaleString('en-IN')} in recorded payments.`
      : `Delete ${s?.studentName}?`,
    showCascade: paid > 0,
    action: async (cascade) => {
      const res = await deleteStudent(id, { cascade });
      if (!res.success) return toast(res.error || 'Delete failed', 'error');
      toast('Student deleted');
      await loadAll();
      renderAll();
    }
  });
}

function onStudentPay(e) {
  const id = e.currentTarget.dataset.stuPay;
  const s = state.students.find(x => x.id === id);
  if (!s) return;
  const paid = studentPaid(state.txns, id);
  const due  = Math.max(0, Number(s.totalFee || 0) - paid);
  $('payment-form').reset();
  $('pay-student-id').value = id;
  $('pay-date').value = todayISO();
  $('pay-amount').value = due;
  $('pay-amount').max = due;
  $('payment-info').innerHTML = `
    <strong>${escapeHtml(s.studentName)}</strong> — ${escapeHtml(s.batchName)}<br>
    Pending Dues: <strong style="color:var(--red)">${formatMoney(due)}</strong>
  `;
  openModal('payment-modal');
}

$('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#payment-form button[type="submit"]');
  btn.disabled = true;
  const res = await recordStudentPayment($('pay-student-id').value, {
    amount: $('pay-amount').value,
    method: $('pay-method').value,
    date:   $('pay-date').value,
    note:   $('pay-note').value
  }, state.user.email);
  if (res.success) {
    toast('Payment recorded');
    closeModal('payment-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

function onStudentHistory(e) {
  const id = e.currentTarget.dataset.stuHistory;
  const s = state.students.find(x => x.id === id);
  if (!s) return;
  const payments = txnsForSource(state.txns, 'student', id);
  const paid = studentPaid(state.txns, id);
  const due  = Math.max(0, Number(s.totalFee || 0) - paid);

  $('stu-history-info').innerHTML = `
    <strong>${escapeHtml(s.studentName)}</strong> (${escapeHtml(s.batchName)})<br>
    <span style="color: var(--text-muted); font-size: 0.85rem;">
      Total Fee: ${formatMoney(s.totalFee)} |
      Paid: <span class="paid">${formatMoney(paid)}</span> |
      Due: <span class="unpaid">${formatMoney(due)}</span>
    </span>
  `;

  const tbody = $('stu-history-tbody');
  const empty = $('stu-history-empty');
  const table = tbody.closest('table');
  const printBtn = $('stu-print-btn');

  if (payments.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
    printBtn.style.display = 'none';
  } else {
    table.style.display = 'table';
    empty.style.display = 'none';
    printBtn.style.display = 'inline-flex';
    printBtn.dataset.id = id;
    tbody.innerHTML = payments.map(p => `
      <tr>
        <td>${formatDate(p.date)}</td>
        <td><span class="method-badge">${methodLabel(p.paymentMethod)}</span></td>
        <td>${escapeHtml(p.note || '-')}</td>
        <td class="amount-cell paid">${formatMoney(p.amount)}</td>
      </tr>`).join('');
  }
  openModal('stu-history-modal');
}

// Print receipt
$('stu-print-btn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
  btn.disabled = true;

  const id = btn.dataset.id;
  const s = state.students.find(x => x.id === id);
  if (!s) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    return;
  }

  // Use a small timeout to allow UI to update and browser to breathe
  setTimeout(() => {
    const payments = txnsForSource(state.txns, 'student', id)
      .slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const paid = studentPaid(state.txns, id);
    const due  = Math.max(0, Number(s.totalFee || 0) - paid);

    $('receipt-name').textContent = s.studentName;
    $('receipt-batch').textContent = s.batchName;
    $('receipt-date').textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const now = new Date();
    $('receipt-number').textContent = `NA-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${id.slice(-4).toUpperCase()}`;

    $('receipt-tbody').innerHTML = payments.length === 0
      ? '<tr><td colspan="5" style="text-align:center;">No payments.</td></tr>'
      : payments.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
            <td>${escapeHtml(p.note || 'Tuition Fee Installment')}</td>
            <td style="text-transform: uppercase;">${p.paymentMethod}</td>
            <td style="text-align: right;">₹${Number(p.amount).toLocaleString('en-IN')}</td>
          </tr>`).join('');

    $('receipt-total-fee').textContent  = '₹' + Number(s.totalFee).toLocaleString('en-IN');
    $('receipt-total-paid').textContent = '₹' + Number(paid).toLocaleString('en-IN');
    $('receipt-balance').textContent    = '₹' + Number(due).toLocaleString('en-IN');

    // Give one more tiny delay so the innerHTML can strictly render before print blocking
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
        btn.innerHTML = originalText;
        btn.disabled = false;
      }, 100);
    });
  }, 50);
});

// ============================================================
// FACULTY
// ============================================================
$('add-faculty-btn').addEventListener('click', () => {
  $('faculty-form').reset();
  $('edit-fac-id').value = '';
  $('faculty-modal-title').textContent = 'Add Faculty';
  $('fac-submit-text').textContent = 'Add Faculty';
  openModal('faculty-modal');
});

$('faculty-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#faculty-form button[type="submit"]');
  btn.disabled = true;
  const id = $('edit-fac-id').value;
  const data = { facultyName: $('fac-name').value, subjectCode: $('fac-subject').value };
  const res = id ? await updateFaculty(id, data) : await addFaculty(data);
  if (res.success) {
    toast(id ? 'Faculty updated' : 'Faculty added');
    closeModal('faculty-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

$('search-faculty').addEventListener('input', (e) => renderFaculty(e.target.value));

function renderFaculty(search = '') {
  const grid = $('faculty-grid');
  const q = search.toLowerCase();
  const list = q
    ? state.faculty.filter(f =>
        (f.facultyName || '').toLowerCase().includes(q) ||
        (f.subjectCode || '').toLowerCase().includes(q))
    : state.faculty;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1"><i class="fas fa-chalkboard-teacher"></i><p>${state.faculty.length === 0 ? 'No faculty added yet' : 'No faculty match your search'}</p></div>`;
    return;
  }

  grid.innerHTML = list.map(f => {
    const paid = facultyPaid(state.txns, f.id);
    return `
      <div class="student-card">
        <div class="student-card-header">
          <div>
            <div class="student-name">${escapeHtml(f.facultyName)}</div>
            <div class="student-batch">${escapeHtml(f.subjectCode)}</div>
          </div>
          <div>
            <button class="action-btn edit" data-edit-fac="${f.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete" data-del-fac="${f.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="student-fees" style="margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 1rem;">
          <div class="fee-item"><span class="fee-label">Total Paid</span><span class="fee-value paid">${formatMoney(paid)}</span></div>
        </div>
        <div class="student-card-actions" style="display:flex; gap:.5rem;">
          <button class="btn btn-secondary btn-sm" data-fac-history="${f.id}" style="flex:1"><i class="fas fa-history"></i> History</button>
          <button class="btn btn-primary btn-sm" data-fac-pay="${f.id}" style="flex:1"><i class="fas fa-money-bill-wave"></i> Pay</button>
        </div>
      </div>`;
  }).join('');

  qa('[data-edit-fac]').forEach(b => b.addEventListener('click', onEditFaculty));
  qa('[data-del-fac]').forEach(b => b.addEventListener('click', onDeleteFaculty));
  qa('[data-fac-history]').forEach(b => b.addEventListener('click', onFacultyHistory));
  qa('[data-fac-pay]').forEach(b => b.addEventListener('click', onFacultyPay));
}

function onEditFaculty(e) {
  const id = e.currentTarget.dataset.editFac;
  const f = state.faculty.find(x => x.id === id);
  if (!f) return;
  $('edit-fac-id').value = f.id;
  $('faculty-modal-title').textContent = 'Edit Faculty';
  $('fac-submit-text').textContent = 'Save Changes';
  $('fac-name').value = f.facultyName;
  $('fac-subject').value = f.subjectCode;
  openModal('faculty-modal');
}

function onDeleteFaculty(e) {
  const id = e.currentTarget.dataset.delFac;
  const f = state.faculty.find(x => x.id === id);
  const paid = facultyPaid(state.txns, id);
  askConfirm({
    text: paid > 0
      ? `Delete ${f?.facultyName}? They have ₹${paid.toLocaleString('en-IN')} in recorded payments.`
      : `Delete ${f?.facultyName}?`,
    showCascade: paid > 0,
    action: async (cascade) => {
      const res = await deleteFaculty(id, { cascade });
      if (!res.success) return toast(res.error || 'Delete failed', 'error');
      toast('Faculty deleted');
      await loadAll();
      renderAll();
    }
  });
}

function onFacultyPay(e) {
  const id = e.currentTarget.dataset.facPay;
  const f = state.faculty.find(x => x.id === id);
  if (!f) return;
  const paid = facultyPaid(state.txns, id);
  $('fac-payment-form').reset();
  $('fac-pay-id').value = id;
  $('fac-pay-date').value = todayISO();
  $('fac-payment-info').innerHTML = `
    <strong>${escapeHtml(f.facultyName)}</strong> — ${escapeHtml(f.subjectCode)}<br>
    <span style="color:var(--text-light); font-size: 0.875rem;">Total paid so far: ${formatMoney(paid)}</span>
  `;
  openModal('fac-payment-modal');
}

$('fac-payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#fac-payment-form button[type="submit"]');
  btn.disabled = true;
  const res = await recordFacultyPayment($('fac-pay-id').value, {
    amount: $('fac-pay-amount').value,
    method: $('fac-pay-method').value,
    date:   $('fac-pay-date').value,
    unit:   $('fac-pay-unit').value
  }, state.user.email);
  if (res.success) {
    toast('Payment recorded');
    closeModal('fac-payment-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

function onFacultyHistory(e) {
  const id = e.currentTarget.dataset.facHistory;
  const f = state.faculty.find(x => x.id === id);
  if (!f) return;
  const payments = txnsForSource(state.txns, 'faculty', id);
  const paid = facultyPaid(state.txns, id);

  $('fac-history-info').innerHTML = `
    <strong>${escapeHtml(f.facultyName)}</strong> — ${escapeHtml(f.subjectCode)}<br>
    <span style="color:var(--text-light); font-size: 0.875rem;">Total paid: ${formatMoney(paid)}</span>
  `;

  const tbody = $('fac-history-tbody');
  const empty = $('fac-history-empty');
  const table = tbody.closest('table');

  if (payments.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
  } else {
    table.style.display = 'table';
    empty.style.display = 'none';
    tbody.innerHTML = payments.map(p => `
      <tr>
        <td>${formatDate(p.date)}</td>
        <td>${escapeHtml(p.note || '-')}</td>
        <td><span class="method-badge">${methodLabel(p.paymentMethod)}</span></td>
        <td class="amount-cell">${formatMoney(p.amount)}</td>
      </tr>`).join('');
  }
  openModal('fac-history-modal');
}

// ============================================================
// INVESTORS
// ============================================================
$('add-investor-btn').addEventListener('click', () => {
  $('investor-form').reset();
  $('edit-inv-id').value = '';
  $('investor-modal-title').textContent = 'Add Investor';
  $('inv-submit-text').textContent = 'Add Investor';
  openModal('investor-modal');
});

$('investor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#investor-form button[type="submit"]');
  btn.disabled = true;
  const id = $('edit-inv-id').value;
  const data = { investorName: $('inv-name').value, note: $('inv-note').value };
  const res = id ? await updateInvestor(id, data) : await addInvestor(data);
  if (res.success) {
    toast(id ? 'Investor updated' : 'Investor added');
    closeModal('investor-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

$('search-investors').addEventListener('input', (e) => renderInvestors(e.target.value));

function renderInvestors(search = '') {
  const grid = $('investors-grid');
  const q = search.toLowerCase();
  const list = q
    ? state.investors.filter(i => (i.investorName || '').toLowerCase().includes(q))
    : state.investors;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1"><i class="fas fa-hand-holding-usd"></i><p>${state.investors.length === 0 ? 'No investors added yet' : 'No investors match your search'}</p></div>`;
    return;
  }

  grid.innerHTML = list.map(inv => {
    const total = investorTotal(state.txns, inv.id);
    const count = txnsForSource(state.txns, 'investor', inv.id).length;
    return `
      <div class="student-card">
        <div class="student-card-header">
          <div>
            <div class="student-name">${escapeHtml(inv.investorName)}</div>
            <div class="student-batch">${escapeHtml(inv.note || 'Investor')}</div>
          </div>
          <div>
            <button class="action-btn edit" data-edit-inv="${inv.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete" data-del-inv="${inv.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="student-fees" style="grid-template-columns: 1fr 1fr;">
          <div class="fee-item"><span class="fee-label">Total Invested</span><span class="fee-value paid">${formatMoney(total)}</span></div>
          <div class="fee-item"><span class="fee-label">Transactions</span><span class="fee-value">${count}</span></div>
        </div>
        <div class="student-card-actions" style="display:flex; gap:.5rem;">
          <button class="btn btn-secondary btn-sm" data-inv-history="${inv.id}" style="flex:1"><i class="fas fa-history"></i> History</button>
          <button class="btn btn-primary btn-sm" data-inv-record="${inv.id}" style="flex:1"><i class="fas fa-plus-circle"></i> Record</button>
        </div>
      </div>`;
  }).join('');

  qa('[data-edit-inv]').forEach(b => b.addEventListener('click', onEditInvestor));
  qa('[data-del-inv]').forEach(b => b.addEventListener('click', onDeleteInvestor));
  qa('[data-inv-history]').forEach(b => b.addEventListener('click', onInvestorHistory));
  qa('[data-inv-record]').forEach(b => b.addEventListener('click', onInvestorRecord));
}

function onEditInvestor(e) {
  const id = e.currentTarget.dataset.editInv;
  const inv = state.investors.find(x => x.id === id);
  if (!inv) return;
  $('edit-inv-id').value = inv.id;
  $('investor-modal-title').textContent = 'Edit Investor';
  $('inv-submit-text').textContent = 'Save Changes';
  $('inv-name').value = inv.investorName;
  $('inv-note').value = inv.note || '';
  openModal('investor-modal');
}

function onDeleteInvestor(e) {
  const id = e.currentTarget.dataset.delInv;
  const inv = state.investors.find(x => x.id === id);
  const total = investorTotal(state.txns, id);
  askConfirm({
    text: total > 0
      ? `Delete ${inv?.investorName}? They have ₹${total.toLocaleString('en-IN')} in investments.`
      : `Delete ${inv?.investorName}?`,
    showCascade: total > 0,
    action: async (cascade) => {
      const res = await deleteInvestor(id, { cascade });
      if (!res.success) return toast(res.error || 'Delete failed', 'error');
      toast('Investor deleted');
      await loadAll();
      renderAll();
    }
  });
}

function onInvestorRecord(e) {
  const id = e.currentTarget.dataset.invRecord;
  const inv = state.investors.find(x => x.id === id);
  if (!inv) return;
  $('invest-payment-form').reset();
  $('inv-pay-id').value = id;
  $('inv-pay-date').value = todayISO();
  $('inv-payment-info').innerHTML = `
    <strong>${escapeHtml(inv.investorName)}</strong><br>
    <span style="color:var(--text-muted);">Total invested so far: ${formatMoney(investorTotal(state.txns, id))}</span>
  `;
  openModal('invest-payment-modal');
}

$('invest-payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = q('#invest-payment-form button[type="submit"]');
  btn.disabled = true;
  const res = await recordInvestment($('inv-pay-id').value, {
    amount: $('inv-pay-amount').value,
    method: $('inv-pay-method').value,
    date:   $('inv-pay-date').value,
    note:   $('inv-pay-note').value
  }, state.user.email);
  if (res.success) {
    toast('Investment recorded');
    closeModal('invest-payment-modal');
    await loadAll();
    renderAll();
  } else {
    toast(res.error || 'Failed', 'error');
  }
  btn.disabled = false;
});

function onInvestorHistory(e) {
  const id = e.currentTarget.dataset.invHistory;
  const inv = state.investors.find(x => x.id === id);
  if (!inv) return;
  const payments = txnsForSource(state.txns, 'investor', id);
  const total = investorTotal(state.txns, id);

  $('inv-history-info').innerHTML = `
    <strong>${escapeHtml(inv.investorName)}</strong><br>
    <span style="color: var(--text-muted); font-size: 0.85rem;">Total Invested: <span class="paid">${formatMoney(total)}</span></span>
  `;

  const tbody = $('inv-history-tbody');
  const empty = $('inv-history-empty');
  const table = tbody.closest('table');

  if (payments.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
  } else {
    table.style.display = 'table';
    empty.style.display = 'none';
    tbody.innerHTML = payments.map(p => `
      <tr>
        <td>${formatDate(p.date)}</td>
        <td>${escapeHtml(p.note || '-')}</td>
        <td><span class="method-badge">${methodLabel(p.paymentMethod)}</span></td>
        <td class="amount-cell paid">${formatMoney(p.amount)}</td>
      </tr>`).join('');
  }
  openModal('inv-history-modal');
}

// ============================================================
// CONFIRM MODAL (generic)
// ============================================================
function askConfirm({ text, showCascade = false, action }) {
  $('confirm-text').textContent = text;
  $('cascade-delete-label').style.display = showCascade ? 'flex' : 'none';
  $('cascade-delete').checked = false;
  state.confirmAction = action;
  openModal('confirm-modal');
}

$('confirm-cancel').addEventListener('click', () => {
  state.confirmAction = null;
  closeModal('confirm-modal');
});

$('confirm-ok').addEventListener('click', async () => {
  if (!state.confirmAction) return;
  const btn = $('confirm-ok');
  btn.disabled = true;
  try {
    await state.confirmAction($('cascade-delete').checked);
    closeModal('confirm-modal');
  } finally {
    btn.disabled = false;
    state.confirmAction = null;
  }
});

// ============================================================
// REPORTS
// ============================================================
function setupReportControls() {
  const m = $('report-month');
  const y = $('report-year');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  m.innerHTML = months.map((name, i) => `<option value="${i}" ${i === state.currentMonth ? 'selected' : ''}>${name}</option>`).join('');
  const cur = new Date().getFullYear();
  y.innerHTML = [cur-1, cur, cur+1].map(yr => `<option value="${yr}" ${yr === state.currentYear ? 'selected' : ''}>${yr}</option>`).join('');
  $('generate-report').addEventListener('click', renderReports);
  $('export-csv').addEventListener('click', exportCSV);
}

function renderReports() {
  const m = parseInt($('report-month').value);
  const y = parseInt($('report-year').value);

  const list = state.txns.filter(t => inMonth(t, m, y));

  const revStudent = sumBy(list, t => t.type === 'income' && t.category === 'student-fee');
  const revOther   = sumBy(list, t => t.type === 'income' && t.category === 'other-income');
  const income     = revStudent + revOther;

  const expFaculty = sumBy(list, t => t.type === 'expense' && t.category === 'faculty-payment');
  const expOp      = sumBy(list, t => t.type === 'expense' && t.category === 'operational');
  const expCourse  = sumBy(list, t => t.type === 'expense' && t.category === 'course-creation');
  const expMkt     = sumBy(list, t => t.type === 'expense' && t.category === 'marketing');
  const expOther   = sumBy(list, t => t.type === 'expense' && t.category === 'other-expense');
  const totalExp   = expFaculty + expOp + expCourse + expMkt + expOther;

  const investment = sumBy(list, t => t.type === 'investment');
  const netProfit  = income - totalExp;
  const netCash    = netProfit + investment;

  $('pnl-rev-student').textContent  = formatMoney(revStudent);
  $('pnl-rev-other').textContent    = formatMoney(revOther);
  $('pnl-income').textContent       = formatMoney(income);

  $('pnl-exp-faculty').textContent     = formatMoney(expFaculty);
  $('pnl-exp-operational').textContent = formatMoney(expOp);
  $('pnl-exp-course').textContent      = formatMoney(expCourse);
  $('pnl-exp-marketing').textContent   = formatMoney(expMkt);
  $('pnl-exp-other').textContent       = formatMoney(expOther);
  $('pnl-total-expense').textContent   = formatMoney(totalExp);

  const netEl = $('pnl-net');
  netEl.textContent = (netProfit < 0 ? '- ' : '') + formatMoney(Math.abs(netProfit));
  const netRow = netEl.parentElement;
  netRow.classList.remove('profit', 'loss');
  if (netProfit > 0) netRow.classList.add('profit');
  if (netProfit < 0) netRow.classList.add('loss');

  $('pnl-investment').textContent = formatMoney(investment);

  const cashEl = $('pnl-cash');
  cashEl.textContent = (netCash < 0 ? '- ' : '') + formatMoney(Math.abs(netCash));
  const cashRow = cashEl.parentElement;
  cashRow.classList.remove('profit', 'loss');
  if (netCash > 0) cashRow.classList.add('profit');
  if (netCash < 0) cashRow.classList.add('loss');

  drawChart(list);
}

function drawChart(list) {
  const canvas = $('category-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 250 * dpr;
  ctx.scale(dpr, dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `250px`;
  ctx.clearRect(0, 0, rect.width, 250);

  const buckets = [
    { label: 'Revenue', val: sumBy(list, t => t.type === 'income'),     color: '#22c55e' },
    { label: 'Faculty', val: sumBy(list, t => t.type === 'expense' && t.category === 'faculty-payment'),  color: '#3b82f6' },
    { label: 'Op',      val: sumBy(list, t => t.type === 'expense' && t.category === 'operational'),      color: '#f59e0b' },
    { label: 'Course',  val: sumBy(list, t => t.type === 'expense' && t.category === 'course-creation'),  color: '#a855f7' },
    { label: 'Mktg',    val: sumBy(list, t => t.type === 'expense' && t.category === 'marketing'),        color: '#ec4899' },
    { label: 'Other',   val: sumBy(list, t => t.type === 'expense' && t.category === 'other-expense'),    color: '#ef4444' },
    { label: 'Capital', val: sumBy(list, t => t.type === 'investment'), color: '#8b5cf6' }
  ].filter(b => b.val > 0);

  if (buckets.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px "Plus Jakarta Sans"';
    ctx.textAlign = 'center';
    ctx.fillText('No data for selected period', rect.width / 2, 125);
    return;
  }

  const max = Math.max(...buckets.map(b => b.val));
  const padding = 40;
  const chartH = 180;
  const barW = 50;
  const count = buckets.length;
  const spacing = count > 1 ? (rect.width - padding * 2 - barW * count) / (count - 1) : 0;

  buckets.forEach((b, i) => {
    const x = count === 1 ? (rect.width - barW) / 2 : padding + i * (barW + spacing);
    const h = (b.val / max) * chartH;
    const y = 200 - h;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, [6, 6, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "Plus Jakarta Sans"';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, x + barW / 2, 220);
    if (h > 20) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px "Plus Jakarta Sans"';
      ctx.fillText(`₹${(b.val / 1000).toFixed(1)}k`, x + barW / 2, y + 16);
    } else {
      ctx.fillStyle = b.color;
      ctx.font = 'bold 12px "Plus Jakarta Sans"';
      ctx.fillText(`₹${(b.val / 1000).toFixed(1)}k`, x + barW / 2, y - 8);
    }
  });
}

function exportCSV() {
  const m = parseInt($('report-month').value);
  const y = parseInt($('report-year').value);
  const list = state.txns.filter(t => inMonth(t, m, y));
  if (list.length === 0) return toast('No data to export', 'info');

  const headers = ['Date','Type','Category','Source Type','Source Name','Amount','Method','Note','Added By'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = list.map(t => [t.date, t.type, t.category, t.sourceType, t.sourceName || '', t.amount, t.paymentMethod, t.note || '', t.addedBy].map(esc).join(','));
  const csv = 'data:text/csv;charset=utf-8,' + headers.map(esc).join(',') + '\n' + rows.join('\n');
  const a = document.createElement('a');
  a.href = encodeURI(csv);
  a.download = `nudge-accounts-${y}-${String(m+1).padStart(2,'0')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

window.addEventListener('resize', () => {
  if (q('#page-reports').classList.contains('active')) renderReports();
});

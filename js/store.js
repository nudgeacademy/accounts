import {
  db, collection, addDoc, getDocs, query, orderBy, where,
  deleteDoc, doc, updateDoc, getDoc, serverTimestamp
} from './firebase.js';

// ============================================================
// ACCOUNTING SCHEMA
// ============================================================
// The ledger (accounting_transactions) is the single source of truth.
// Student / Faculty / Investor records hold master data only.
// Paid / due / totals for those entities are COMPUTED from the ledger.
//
// Type → allowed categories:
export const TYPE_CATEGORY_MAP = {
  income:     ['student-fee', 'other-income'],
  expense:    ['faculty-payment', 'operational', 'course-creation', 'marketing', 'other-expense'],
  investment: ['capital']
};

export const CATEGORY_LABELS = {
  'student-fee':      'Student Fee',
  'other-income':     'Other Income',
  'faculty-payment':  'Faculty Payment',
  'operational':      'Operational',
  'course-creation':  'Course Creation',
  'marketing':        'Marketing',
  'other-expense':    'Other Expense',
  'capital':          'Capital Investment'
};

// Categories that require a source entity (enforced on add/update).
export const SOURCE_REQUIRED_CATEGORIES = {
  'student-fee':     'student',
  'faculty-payment': 'faculty',
  'capital':         'investor'
};

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi',  label: 'UPI' },
  { value: 'bank', label: 'Bank Transfer' }
];

export const SOURCE_TYPES = ['student', 'faculty', 'investor', 'direct'];

// ============================================================
// VALIDATION
// ============================================================
function toAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Amount must be a positive number');
  }
  return n;
}

function toDate(v) {
  if (!v || isNaN(new Date(v).getTime())) {
    throw new Error('Valid date is required');
  }
  return v;
}

function validateTxnShape({ type, category, paymentMethod, sourceType, sourceId }) {
  if (!TYPE_CATEGORY_MAP[type]) {
    throw new Error(`Invalid type: ${type}`);
  }
  if (!TYPE_CATEGORY_MAP[type].includes(category)) {
    throw new Error(`Category "${category}" not allowed for type "${type}"`);
  }
  if (!PAYMENT_METHODS.some(p => p.value === paymentMethod)) {
    throw new Error(`Invalid payment method: ${paymentMethod}`);
  }
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new Error(`Invalid source type: ${sourceType}`);
  }

  // Source integrity: some categories MUST link to an entity.
  const requiredSource = SOURCE_REQUIRED_CATEGORIES[category];
  if (requiredSource) {
    if (sourceType !== requiredSource) {
      throw new Error(`Category "${category}" requires source type "${requiredSource}"`);
    }
    if (!sourceId) {
      throw new Error(`Category "${category}" requires a ${requiredSource} to be selected`);
    }
  } else {
    // Direct-only categories cannot have a source link.
    if (sourceType !== 'direct') {
      throw new Error(`Category "${category}" must be direct (no source link)`);
    }
  }
}

// ============================================================
// TRANSACTIONS (the ledger)
// ============================================================
export async function addTransaction(input, userEmail) {
  try {
    const amount = toAmount(input.amount);
    toDate(input.date);
    const sourceType = input.sourceType || 'direct';
    const sourceId   = input.sourceId || null;

    validateTxnShape({
      type: input.type,
      category: input.category,
      paymentMethod: input.paymentMethod,
      sourceType,
      sourceId
    });

    const doc = {
      date:          input.date,
      type:          input.type,
      category:      input.category,
      amount,
      note:          (input.note || '').trim(),
      paymentMethod: input.paymentMethod,
      sourceType,
      sourceId,
      sourceName:    (input.sourceName || '').trim() || null,
      addedBy:       userEmail || input.addedBy || 'unknown',
      createdAt:     serverTimestamp()
    };

    const ref = await addDoc(collection(db, 'accounting_transactions'), doc);
    return { success: true, id: ref.id };
  } catch (e) {
    console.error('addTransaction:', e);
    return { success: false, error: e.message };
  }
}

export async function updateTransaction(id, patch) {
  try {
    const existing = await getDoc(doc(db, 'accounting_transactions', id));
    if (!existing.exists()) throw new Error('Transaction not found');
    const cur = existing.data();

    const next = { ...cur, ...patch };
    if (patch.amount !== undefined) next.amount = toAmount(patch.amount);
    if (patch.date !== undefined) toDate(patch.date);

    validateTxnShape({
      type:          next.type,
      category:      next.category,
      paymentMethod: next.paymentMethod,
      sourceType:    next.sourceType || 'direct',
      sourceId:      next.sourceId || null
    });

    const writePatch = { ...patch };
    if (writePatch.amount !== undefined) writePatch.amount = toAmount(writePatch.amount);
    if (writePatch.note !== undefined) writePatch.note = String(writePatch.note).trim();

    await updateDoc(doc(db, 'accounting_transactions', id), writePatch);
    return { success: true };
  } catch (e) {
    console.error('updateTransaction:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteTransaction(id) {
  try {
    await deleteDoc(doc(db, 'accounting_transactions', id));
    return { success: true };
  } catch (e) {
    console.error('deleteTransaction:', e);
    return { success: false, error: e.message };
  }
}

export async function getTransactions() {
  try {
    const snap = await getDocs(
      query(collection(db, 'accounting_transactions'), orderBy('date', 'desc'))
    );
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('getTransactions:', e);
    return { success: false, error: e.message, data: [] };
  }
}

// Delete every ledger entry linked to a given source (used on cascade deletes).
async function deleteTxnsBySource(sourceType, sourceId) {
  const snap = await getDocs(query(
    collection(db, 'accounting_transactions'),
    where('sourceType', '==', sourceType),
    where('sourceId', '==', sourceId)
  ));
  await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'accounting_transactions', d.id))));
  return snap.size;
}

// ============================================================
// STUDENTS
// ============================================================
export async function addStudent(input) {
  try {
    const studentName = String(input.studentName || '').trim();
    const batchName   = String(input.batchName || '').trim();
    const totalFee    = toAmount(input.totalFee);
    if (!studentName) throw new Error('Student name is required');
    if (!batchName)   throw new Error('Batch name is required');

    const ref = await addDoc(collection(db, 'accounting_students'), {
      studentName, batchName, totalFee,
      createdAt: serverTimestamp()
    });
    return { success: true, id: ref.id };
  } catch (e) {
    console.error('addStudent:', e);
    return { success: false, error: e.message };
  }
}

export async function updateStudent(id, patch) {
  try {
    const write = { ...patch };
    if (patch.totalFee !== undefined) write.totalFee = toAmount(patch.totalFee);
    if (patch.studentName !== undefined) write.studentName = String(patch.studentName).trim();
    if (patch.batchName !== undefined) write.batchName = String(patch.batchName).trim();
    await updateDoc(doc(db, 'accounting_students', id), write);
    return { success: true };
  } catch (e) {
    console.error('updateStudent:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteStudent(id, { cascade = false } = {}) {
  try {
    if (cascade) await deleteTxnsBySource('student', id);
    await deleteDoc(doc(db, 'accounting_students', id));
    return { success: true };
  } catch (e) {
    console.error('deleteStudent:', e);
    return { success: false, error: e.message };
  }
}

export async function getStudents() {
  try {
    const snap = await getDocs(
      query(collection(db, 'accounting_students'), orderBy('createdAt', 'desc'))
    );
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('getStudents:', e);
    return { success: false, error: e.message, data: [] };
  }
}

export async function recordStudentPayment(studentId, { amount, date, method, note }, userEmail) {
  try {
    const snap = await getDoc(doc(db, 'accounting_students', studentId));
    if (!snap.exists()) throw new Error('Student not found');
    const stu = snap.data();

    const amt = toAmount(amount);

    // Guard against overpayment using the ledger (not a stored counter).
    const txnSnap = await getDocs(query(
      collection(db, 'accounting_transactions'),
      where('sourceType', '==', 'student'),
      where('sourceId', '==', studentId)
    ));
    const paidSoFar = txnSnap.docs.reduce((sum, d) => {
      const t = d.data();
      return t.type === 'income' ? sum + Number(t.amount || 0) : sum;
    }, 0);
    const due = Number(stu.totalFee || 0) - paidSoFar;
    if (due <= 0) throw new Error('Student has no pending dues');
    if (amt > due) throw new Error(`Payment ₹${amt} exceeds due ₹${due}`);

    return await addTransaction({
      date,
      type: 'income',
      category: 'student-fee',
      amount: amt,
      paymentMethod: method,
      sourceType: 'student',
      sourceId: studentId,
      sourceName: `${stu.studentName} (${stu.batchName})`,
      note: note || `Fee payment`
    }, userEmail);
  } catch (e) {
    console.error('recordStudentPayment:', e);
    return { success: false, error: e.message };
  }
}

// ============================================================
// FACULTY
// ============================================================
export async function addFaculty(input) {
  try {
    const facultyName = String(input.facultyName || '').trim();
    const subjectCode = String(input.subjectCode || '').trim();
    if (!facultyName) throw new Error('Faculty name is required');
    if (!subjectCode) throw new Error('Subject is required');

    const ref = await addDoc(collection(db, 'accounting_faculty'), {
      facultyName, subjectCode,
      createdAt: serverTimestamp()
    });
    return { success: true, id: ref.id };
  } catch (e) {
    console.error('addFaculty:', e);
    return { success: false, error: e.message };
  }
}

export async function updateFaculty(id, patch) {
  try {
    const write = {};
    if (patch.facultyName !== undefined) write.facultyName = String(patch.facultyName).trim();
    if (patch.subjectCode !== undefined) write.subjectCode = String(patch.subjectCode).trim();
    await updateDoc(doc(db, 'accounting_faculty', id), write);
    return { success: true };
  } catch (e) {
    console.error('updateFaculty:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteFaculty(id, { cascade = false } = {}) {
  try {
    if (cascade) await deleteTxnsBySource('faculty', id);
    await deleteDoc(doc(db, 'accounting_faculty', id));
    return { success: true };
  } catch (e) {
    console.error('deleteFaculty:', e);
    return { success: false, error: e.message };
  }
}

export async function getFaculty() {
  try {
    const snap = await getDocs(
      query(collection(db, 'accounting_faculty'), orderBy('createdAt', 'desc'))
    );
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('getFaculty:', e);
    return { success: false, error: e.message, data: [] };
  }
}

export async function recordFacultyPayment(facultyId, { amount, date, method, unit }, userEmail) {
  try {
    const snap = await getDoc(doc(db, 'accounting_faculty', facultyId));
    if (!snap.exists()) throw new Error('Faculty not found');
    const fac = snap.data();
    const u = String(unit || '').trim();
    if (!u) throw new Error('Unit / topic is required');

    return await addTransaction({
      date,
      type: 'expense',
      category: 'faculty-payment',
      amount,
      paymentMethod: method,
      sourceType: 'faculty',
      sourceId: facultyId,
      sourceName: `${fac.facultyName} (${fac.subjectCode})`,
      note: u
    }, userEmail);
  } catch (e) {
    console.error('recordFacultyPayment:', e);
    return { success: false, error: e.message };
  }
}

// ============================================================
// INVESTORS
// ============================================================
export async function addInvestor(input) {
  try {
    const investorName = String(input.investorName || '').trim();
    const note         = String(input.note || '').trim();
    if (!investorName) throw new Error('Investor name is required');

    const ref = await addDoc(collection(db, 'accounting_investors'), {
      investorName, note,
      createdAt: serverTimestamp()
    });
    return { success: true, id: ref.id };
  } catch (e) {
    console.error('addInvestor:', e);
    return { success: false, error: e.message };
  }
}

export async function updateInvestor(id, patch) {
  try {
    const write = {};
    if (patch.investorName !== undefined) write.investorName = String(patch.investorName).trim();
    if (patch.note !== undefined) write.note = String(patch.note).trim();
    await updateDoc(doc(db, 'accounting_investors', id), write);
    return { success: true };
  } catch (e) {
    console.error('updateInvestor:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteInvestor(id, { cascade = false } = {}) {
  try {
    if (cascade) await deleteTxnsBySource('investor', id);
    await deleteDoc(doc(db, 'accounting_investors', id));
    return { success: true };
  } catch (e) {
    console.error('deleteInvestor:', e);
    return { success: false, error: e.message };
  }
}

export async function getInvestors() {
  try {
    const snap = await getDocs(
      query(collection(db, 'accounting_investors'), orderBy('createdAt', 'desc'))
    );
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('getInvestors:', e);
    return { success: false, error: e.message, data: [] };
  }
}

export async function recordInvestment(investorId, { amount, date, method, note }, userEmail) {
  try {
    const snap = await getDoc(doc(db, 'accounting_investors', investorId));
    if (!snap.exists()) throw new Error('Investor not found');
    const inv = snap.data();
    const n = String(note || '').trim();
    if (!n) throw new Error('Purpose / note is required');

    return await addTransaction({
      date,
      type: 'investment',
      category: 'capital',
      amount,
      paymentMethod: method,
      sourceType: 'investor',
      sourceId: investorId,
      sourceName: inv.investorName,
      note: n
    }, userEmail);
  } catch (e) {
    console.error('recordInvestment:', e);
    return { success: false, error: e.message };
  }
}

// ============================================================
// COMPUTED AGGREGATIONS (pure functions over an already-loaded ledger)
// ============================================================
export function sumBy(txns, pred) {
  return txns.reduce((s, t) => pred(t) ? s + Number(t.amount || 0) : s, 0);
}

export function studentPaid(txns, studentId) {
  return sumBy(txns, t => t.sourceType === 'student' && t.sourceId === studentId && t.type === 'income');
}

export function facultyPaid(txns, facultyId) {
  return sumBy(txns, t => t.sourceType === 'faculty' && t.sourceId === facultyId && t.type === 'expense');
}

export function investorTotal(txns, investorId) {
  return sumBy(txns, t => t.sourceType === 'investor' && t.sourceId === investorId && t.type === 'investment');
}

export function txnsForSource(txns, sourceType, sourceId) {
  return txns.filter(t => t.sourceType === sourceType && t.sourceId === sourceId);
}

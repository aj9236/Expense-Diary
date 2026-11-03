const P = require('../src/parser.js');
const now = new Date(2026, 10, 1, 22, 0);
let fail = 0;
function check(name, text, expect) {
  const r = P.parse(text, now);
  if (expect === null) {
    if (r !== null) { fail++; console.log('FAIL', name, 'expected null, got', r); } else console.log('ok  ', name, '-> ignored');
    return;
  }
  const bad = Object.keys(expect).filter(k => JSON.stringify(r && r[k]) !== JSON.stringify(expect[k]));
  if (!r || bad.length) { fail++; console.log('FAIL', name, bad.map(k => `${k}: got ${JSON.stringify(r && r[k])} want ${JSON.stringify(expect[k])}`).join('; ')); }
  else console.log('ok  ', name, '->', r.type, r.amount, r.date, r.time || '-', '|', r.description, '|', r.bank, r.account, '| ref', r.ref, '|', r.category, '|', r.confidence);
}

// The user's three samples
check('HDFC UPI sent', `Sent Rs.1500.00
From HDFC Bank A/C *2507
To NEKESH N KAMATH
On 01/11/26
Ref 630572220070
Not You?
Call 18002586161/SMS BLOCK UPI to 7308080808`,
  { type: 'expense', amount: 1500, date: '2026-11-01', party: 'NEKESH N KAMATH', account: '2507', bank: 'HDFC Bank', mode: 'UPI', ref: '630572220070', confidence: 'high' });

check('Federal UPI debit', 'Debited Rs 754.00 from a/c X0090 on 24Oct26 13:10 via UPI to THAVAKKAL CH. Ref 666327617212.Bal Rs 4740.99. Not you?Call 18004251199 -Federal Bank',
  { type: 'expense', amount: 754, date: '2026-10-24', time: '13:10', party: 'THAVAKKAL CH', account: '0090', bank: 'Federal Bank', mode: 'UPI', ref: '666327617212', balance: 4740.99 });

check('HDFC credit', 'Credit Alert!\nRs.5000.00 credited to HDFC Bank A/c XX2507 on 31-10-26 from VPA *tu-2@okicici (UPI 630451298334)',
  { type: 'income', amount: 5000, date: '2026-10-31', party: '*tu-2@okicici', account: '2507', bank: 'HDFC Bank', mode: 'UPI', ref: '630451298334' });

// Other common Indian formats, for robustness
check('SBI UPI debit', 'Dear UPI user A/C X1234 debited by 250.0 on date 30Oct26 trf to SWIGGY Refno 430212345678. If not u? call 1800111109. -SBI', { type: 'expense', amount: 250, date: '2026-10-30', ref: '430212345678', party: 'SWIGGY', category: 'Food & Dining' });
check('ICICI card', 'INR 2,349.00 spent using ICICI Bank Card XX4321 on 28-Oct-26 on AMAZON PAY IN. Avl Limit: INR 1,02,345.00. If not you, call 1800 2662/SMS BLOCK 4321 to 9215676766.',
  { type: 'expense', amount: 2349, date: '2026-10-28', account: '4321', bank: 'ICICI Bank', category: 'Shopping' });
check('Salary credit', 'Your A/c XX0090 is credited with INR 85,000.00 on 30-10-2026 by NEFT from ACME PAYROLL. Avl Bal INR 89,740.99 -Federal Bank',
  { type: 'income', amount: 85000, date: '2026-10-30', balance: 89740.99, category: 'Salary', mode: 'NEFT' });
check('Email style debit', 'Dear Customer, Rs.754.00 has been debited from account **0090 to VPA thavakkal@ybl THAVAKKAL CHICKEN on 24-10-26. Your UPI transaction reference number is 666327617212.',
  { type: 'expense', amount: 754, date: '2026-10-24', account: '0090', ref: '666327617212' });
check('ATM', 'Rs.2000.00 withdrawn at ATM from A/c XX2507 on 29/10/26 13:45. Avl bal Rs.12,345.00',
  { type: 'expense', amount: 2000, mode: 'ATM', balance: 12345, category: 'Cash Withdrawal', time: '13:45' });

check('Footer mentions OTP', 'Rs 320.00 debited from A/c XX0090 on 01-11-26 to MILMA BOOTH via UPI Ref 777123456789. Never share OTP/PIN with anyone. -Federal Bank',
  { type: 'expense', amount: 320, party: 'MILMA BOOTH', category: 'Groceries' });

// Messages that must be ignored
check('OTP', 'OTP for transaction of Rs 1500.00 at AMAZON is 123456. Do not share. -HDFC Bank', null);
check('Due reminder', 'Your credit card payment of Rs 4,500 is due on 05-11-26. Pay now.', null);
check('Collect request', 'XYZ has requested money from you on Google Pay. On approving, Rs 500 will be debited from your a/c.', null);
check('Promo', 'Get a pre-approved personal loan of Rs 5,00,000. Apply now!', null);

console.log(fail ? `\n${fail} FAILED` : '\nAll parser checks passed');
process.exit(fail ? 1 : 0);

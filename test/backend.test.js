const { load } = require('./gas-mock');
const CODE = __dirname + '/../dist/backend/Code.gs';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

// A version-1 sheet that already holds one confirmed and one pending row
const V1H = ['id','date','time','type','amount','category','description','party','account','bank','mode','ref','balance','source','status','note','raw','created','updated'];
const v1 = [V1H,
  ['a1','2026-10-30','','income',85000,'Salary','NEFT from ACME','ACME','0090','Federal Bank','NEFT','','','sms','confirmed','','raw','x','x'],
  ['a2','2026-10-24','13:10','expense',754,'Others','UPI to THAVAKKAL CH','THAVAKKAL CH','0090','Federal Bank','UPI','666327617212',4740.99,'sms','pending','','raw','x','x']];
const g = load(CODE, { presetSheets: [['Entries', v1]] });
g.ctx.setup();
const T = g.props.TOKEN;
const P = b => g.post(Object.assign({ token: T }, b));

ok(g.post({ action: 'refresh', token: 'bad' }).ok === false, 'wrong access key rejected');
let s = P({ action: 'refresh' });
ok(s.entries.length === 1 && s.inbox.length === 1 && s.inbox[0].ref === '666327617212', 'version-1 pending row moved to the Inbox');

const sms1 = 'Sent Rs.1500.00\nFrom HDFC Bank A/C *2507\nTo NEKESH N KAMATH\nOn 01/11/26\nRef 630572220070\nNot You?';
const r1 = P({ action: 'ingest', text: sms1 });
ok(r1.added === true && r1.entries === undefined, 'Shortcut SMS goes to Inbox with a short reply');
ok(P({ action: 'ingest', text: sms1 }).duplicate === true, 'same SMS twice is held once');
ok(P({ action: 'ingest', text: 'Debited Rs 754.00 from a/c X0090 on 24Oct26 13:10 via UPI to THAVAKKAL CH. Ref 666327617212.' }).duplicate === true, 'migrated item still blocks its duplicate');
ok(P({ action: 'ingest', text: 'Your OTP is 123456 for Rs 500 -HDFC' }).skipped === true, 'OTP skipped');

g.gmail.threads.push({ addLabel() {}, getMessages: () => [{ getId: () => 'm9', getSubject: () => 'Alert', getDate: () => new Date(2026, 9, 31),
  getBody: () => '', getPlainBody: () => 'Rs.5000.00 credited to HDFC Bank A/c XX2507 on 31-10-26 from VPA *tu-2@okicici (UPI 630451298334)' }] });
s = P({ action: 'refresh', scan: true, force: true });
ok(s.scanned === true && s.inbox.length === 3, 'opening the app scans Gmail (inbox now ' + s.inbox.length + ')');
ok(P({ action: 'refresh', scan: true }).scanned === false, 'repeat scans within a minute are skipped');

const byRef = ref => s.inbox.find(x => x.ref === ref);
const firstId = byRef('630572220070').id;
s = P({ action: 'confirm', items: [{ id: byRef('630572220070').id, entry: { category: 'Family' } }, { id: byRef('630451298334').id }] });
ok(s.added === 2 && s.inbox.length === 1 && s.entries.length === 3, 'two ticked items added to the diary');
ok(s.entries.some(e => e.ref === '630572220070' && e.category === 'Family' && e.source === 'sms'), 'category chosen before confirming is kept');
s = P({ action: 'confirm', items: [{ id: firstId }] });
ok(s.entries.length === 3, 'confirming twice does not add twice');
s = P({ action: 'ignore', ids: [s.inbox[0].id] });
ok(s.inbox.length === 0 && s.entries.length === 3, 'ignored item leaves the list without a diary row');
ok(P({ action: 'ingest', text: 'Debited Rs 754.00 from a/c X0090 on 24Oct26 via UPI to THAVAKKAL CH. Ref 666327617212.' }).duplicate === true, 'ignored message does not come back');

s = P({ action: 'save', kind: 'entry', item: { date: '2026-11-03', type: 'expense', amount: 120, category: 'Food & Dining', description: 'Tea and snacks', mode: 'Cash' } });
ok(s.entries.some(e => e.description === 'Tea and snacks' && e.source === 'manual'), 'manual cash entry saved');
ok(P({ action: 'save', kind: 'entry', item: { date: '03-11-2026', type: 'expense', amount: 5 } }).ok === false, 'bad date rejected');

s = P({ action: 'save', kind: 'holding', item: { side: 'liability', type: 'Home loan', name: 'Home loan', party: 'Federal Bank', amount: '25,00,000', current: 1850000, rate: 8.6, installment: 24500, frequency: 'Monthly', nextDue: '2026-11-05' } });
const loan = s.holdings[0];
ok(loan && loan.amount === 2500000 && loan.status === 'active' && loan.nextDue === '2026-11-05', 'liability saved with numbers cleaned');
s = P({ action: 'batch', ops: [
  { action: 'save', kind: 'holding', item: Object.assign({}, loan, { nextDue: '2026-12-05' }) },
  { action: 'save', kind: 'entry', item: { date: '2026-11-05', type: 'expense', amount: 24500, category: 'EMI & Loans', description: 'EMI - Home loan' } }] });
ok(s.holdings[0].nextDue === '2026-12-05' && s.entries.some(e => e.amount === 24500), 'record payment: due date moved and diary row added together');
ok(P({ action: 'save', kind: 'holding', item: { side: 'asset', type: 'Chitty' } }).ok === false, 'holding without a name rejected');
s = P({ action: 'delete', kind: 'holding', id: loan.id });
ok(s.holdings.length === 0, 'holding deleted');
ok(g.sheets.Inbox && g.sheets.Holdings && g.sheets.Entries.rows[0].length === V1H.length, 'three sheets present, Entries layout unchanged');

// iPhone Shortcut variants: key and action in the address, message as form field / multipart / plain text
const viaQuery = (contents, type) => JSON.parse(g.ctx.doPost({ parameter: { token: T, action: 'ingest', source: 'sms' }, postData: { contents, type } }));
let q = viaQuery('Debited Rs 11.00 from a/c X0090 on 01Nov26 via UPI to TEA SHOP. Ref 900000000001.', 'text/plain');
ok(q.ok && q.added === true, 'Shortcut plain-text body accepted');
q = viaQuery('--b1\r\nContent-Disposition: form-data; name="text"\r\n\r\nDebited Rs 12.00 from a/c X0090 on 01Nov26 via UPI to JUICE SHOP. Ref 900000000002.\r\n--b1--\r\n', 'multipart/form-data');
ok(q.ok && q.added === true, 'Shortcut multipart form accepted');
q = JSON.parse(g.ctx.doPost({ parameter: { token: T, action: 'ingest', text: 'Debited Rs 13.00 from a/c X0090 on 01Nov26 via UPI to BAKERY. Ref 900000000003.' }, postData: { contents: 'text=Debited+Rs+13.00', type: 'application/x-www-form-urlencoded' } }));
ok(q.ok && q.added === true, 'Shortcut url-encoded form accepted');

ok(P({ action: 'refresh' }).sheetId === 'x', 'refresh tells the app which Sheet holds the data');

// Notes
s = P({ action: 'save', kind: 'note', item: { date: '2026-11-08', title: 'New car battery', details: 'Amaron 55Ah, 48 months warranty', label: 'Vehicle', amount: '6,450', remind: '2030-11-08' } });
ok(s.notes.length === 1 && s.notes[0].amount === 6450 && s.notes[0].remind === '2030-11-08' && s.features.indexOf('notes') >= 0, 'note saved with amount and reminder');
ok(P({ action: 'save', kind: 'note', item: { date: '2026-11-08' } }).ok === false, 'empty note rejected');
s = P({ action: 'save', kind: 'note', item: { id: s.notes[0].id, details: 'Amaron 55Ah, 48 months warranty, bill in glovebox' } });
ok(s.notes.length === 1 && /glovebox/.test(s.notes[0].details) && s.notes[0].title === 'New car battery', 'note edited in place');
s = P({ action: 'delete', kind: 'note', id: s.notes[0].id });
ok(s.notes.length === 0, 'note deleted');

// One-time connect page
let page = g.ctx.doGet({ parameter: { connect: '' } }).html;
ok(/expensediary:\/\/setup\?cfg=/.test(page) && page.indexOf(encodeURIComponent(T)) > 0, 'connect page offers the app link with the key');
page = g.ctx.doGet({ parameter: { connect: '' } }).html;
ok(/Already connected/.test(page) && page.indexOf(T) < 0, 'connect page shows the key only once');
g.ctx.resetAccessKey();
page = g.ctx.doGet({ parameter: { connect: '' } }).html;
ok(page.indexOf(encodeURIComponent(g.props.TOKEN)) > 0 && g.props.TOKEN !== T, 'resetAccessKey issues a new key and allows connecting again');
ok(typeof g.ctx.doGet({ parameter: {} }) === 'string', 'plain status check still works');

console.log(fail ? fail + ' FAILED' : '\nAll back-end checks passed');
process.exit(fail ? 1 : 0);

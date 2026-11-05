/* ------------------------------------------------------------------
 * Expense Diary (version 2) - Google Apps Script back end
 *
 * Sheets kept in this spreadsheet:
 *   Inbox    - bank SMS / e-mails that were read, waiting for you to confirm
 *   Entries  - your confirmed income and expense diary
 *   Holdings - assets and liabilities (insurance, chitty, loans, deposits...)
 *
 * First-time setup (or after pasting a new version): choose the function
 * "setup" in the toolbar and press Run. The Execution log shows your key.
 * ------------------------------------------------------------------ */

/* The Google Sheet that holds your data. Leave empty when this script is
   opened from the Sheet itself (Extensions > Apps Script). */
var SPREADSHEET_ID = '';

function ss_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  // A copied standalone service keeps its own Sheet, created on first setup.
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { } }
  var created = SpreadsheetApp.create('Expense Diary');
  props.setProperty('SHEET_ID', created.getId());
  return created;
}

var KINDS = {
  entry: { sheet: 'Entries', headers: ['id', 'date', 'time', 'type', 'amount', 'category', 'description', 'party', 'account', 'bank',
    'mode', 'ref', 'balance', 'source', 'status', 'note', 'raw', 'created', 'updated'] },
  inbox: { sheet: 'Inbox', headers: ['id', 'date', 'time', 'type', 'amount', 'category', 'description', 'party', 'account', 'bank',
    'mode', 'ref', 'balance', 'source', 'status', 'msgId', 'entryId', 'raw', 'received', 'updated'] },
  holding: { sheet: 'Holdings', headers: ['id', 'side', 'type', 'name', 'party', 'ref', 'amount', 'current', 'rate', 'installment',
    'frequency', 'start', 'end', 'nextDue', 'status', 'notes', 'created', 'updated'] }
};
var NUMERIC = { amount: 1, balance: 1, current: 1, rate: 1, installment: 1 };
var DATE_KEYS = { date: 1, start: 1, end: 1, nextDue: 1 };
var ENTRY_FIELDS = ['date', 'time', 'type', 'amount', 'category', 'description', 'party', 'account', 'bank', 'mode', 'ref', 'balance', 'source', 'raw', 'note'];
var HOLDING_FIELDS = ['side', 'type', 'name', 'party', 'ref', 'amount', 'current', 'rate', 'installment', 'frequency', 'start', 'end', 'nextDue', 'status', 'notes'];
var PROCESSED_LABEL = 'ExpenseDiary-Processed';
var DEFAULT_GMAIL_QUERY = '(from:hdfcbank.net OR from:hdfcbank.bank.in OR from:federalbank.co.in OR from:federal.bank.in) (debited OR credited OR spent) newer_than:7d';
var SCAN_GAP_MS = 60 * 1000;

/* ---------- setup ---------- */
function setup() {
  var props = PropertiesService.getScriptProperties();
  Object.keys(KINDS).forEach(getSheet_);
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', newKey_());
  if (!props.getProperty('GMAIL_QUERY')) props.setProperty('GMAIL_QUERY', DEFAULT_GMAIL_QUERY);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'scanGmail' || h === 'scheduledScan') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledScan').timeBased().everyMinutes(10).create();
  if (!GmailApp.getUserLabelByName(PROCESSED_LABEL)) GmailApp.createLabel(PROCESSED_LABEL);
  migrate_();
  Logger.log('Setup complete. Sheets ready: Inbox, Entries, Holdings.');
  Logger.log('YOUR ACCESS KEY (keep it private): ' + props.getProperty('TOKEN'));
  Logger.log('Gmail search used: ' + props.getProperty('GMAIL_QUERY'));
  Logger.log('Your Sheet: ' + ss_().getUrl());
  Logger.log('Next: Deploy > New deployment > Web app, Who has access: Anyone. Then open the Web app URL with ?connect at the end.');
}

function resetAccessKey() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('TOKEN', newKey_());
  props.deleteProperty('CONNECT_SHOWN');
  Logger.log('NEW ACCESS KEY: ' + props.getProperty('TOKEN'));
}

function newKey_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 24); }

/* Runs every 10 minutes so e-mails are already waiting when you open the app. */
function scheduledScan() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { scanGmail_(); } finally { lock.releaseLock(); }
}

/* ---------- web endpoints ---------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.connect !== undefined) return connectPage_();
  return json_({ ok: true, app: 'Expense Diary', version: 2, message: 'The service is running.' });
}

/* One-time page that hands this service's address and key to the app.
   It is shown only once; run resetAccessKey to show it again with a new key. */
function connectPage_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  var body;
  if (!token) {
    body = '<h1>Almost there</h1><p>Please go back to Apps Script, choose <b>setup</b> and press <b>Run</b> first.</p>';
  } else if (props.getProperty('CONNECT_SHOWN')) {
    body = '<h1>Already connected</h1><p>For your safety this link is shown only once. To connect again, run <b>resetAccessKey</b> in Apps Script, then open this page again.</p>';
  } else {
    props.setProperty('CONNECT_SHOWN', String(Date.now()));
    var url = ScriptApp.getService().getUrl().replace(/\/dev$/, '/exec');
    var cfg = JSON.stringify({ url: url, token: token });
    var appLink = 'expensediary://setup?cfg=' + encodeURIComponent(cfg);
    var webLink = 'https://aj9236.github.io/Expense-Diary/#setup=' + encodeURIComponent(cfg);
    body = '<h1>Your Expense Diary is ready</h1>' +
      '<p>Tap the button to connect the app on this phone.</p>' +
      '<p><a class="btn" href="' + appLink + '" target="_top">Connect the Android app</a></p>' +
      '<p class="small">On an iPhone or a computer, use this link instead:</p>' +
      '<p><a href="' + webLink + '" target="_top">Open Expense Diary in the browser</a></p>' +
      '<p class="small">If the button does nothing, copy this setup link and paste it in the app under Settings, Web app URL:</p>' +
      '<textarea readonly onclick="this.select()">' + webLink + '</textarea>' +
      '<p class="small">Keep this link private; it works like a password for your records.</p>';
  }
  var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:-apple-system,Roboto,sans-serif;background:#f5efe3;color:#2a2620;padding:24px;line-height:1.5}' +
    'h1{font-family:Georgia,serif;font-size:24px}.btn{display:inline-block;background:#8c3b2b;color:#fffaf0;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:600}' +
    '.small{font-size:14px;color:#6d6558}textarea{width:100%;height:110px;font-size:12px;border-radius:10px;border:1px solid #e6dccb;padding:8px}</style>' +
    '</head><body>' + body + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Expense Diary').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var body = {}, raw = (e && e.postData && e.postData.contents) || '';
  try { body = JSON.parse(raw || '{}'); } catch (err) {
    // iPhone Shortcuts may send a form or plain text instead of JSON
    body = {};
    var mp = /name="?text"?[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n--/.exec(raw);
    if (mp) body.text = mp[1];
    else if (raw && !/^[\w%+.\-]+=[^\s]*(&|$)/.test(raw)) body.text = raw;
  }
  if (!body || typeof body !== 'object') body = {};
  if (e && e.parameter) Object.keys(e.parameter).forEach(function (k) { if (body[k] === undefined) body[k] = e.parameter[k]; });

  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || String(body.token || '') !== token) return json_({ ok: false, error: 'Access key is missing or incorrect.' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var out = handle_(body);
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { }
  }
}

function handle_(b) {
  migrate_();
  switch (b.action) {
    case 'ping': return { version: 2 };
    case 'ingest': // used by the iPhone Shortcut; small reply unless the app asks for data
      var r = ingest_(b.text, b.source || 'sms', b.at ? new Date(Number(b.at)) : null, null);
      return b.snapshot ? withSnapshot_(r) : r;
    case 'refresh':
      var info = {};
      if (b.scan) {
        try { info.scanned = maybeScan_(!!b.force); } catch (err) { info.scanError = String(err && err.message || err); }
      }
      return withSnapshot_(info);
    case 'confirm': return withSnapshot_({ added: confirm_(b.items || []) });
    case 'ignore': setInboxStatus_(b.ids || [], 'ignored'); return withSnapshot_({});
    case 'save': save_(b.kind, b.item || {}); return withSnapshot_({});
    case 'delete': remove_(b.kind, b.id); return withSnapshot_({});
    case 'batch': (b.ops || []).forEach(runOp_); return withSnapshot_({});
    case 'reparse': return withSnapshot_({ reparsed: reparseInbox_() });
    default: throw new Error('Unknown action.');
  }
}

function runOp_(op) {
  if (op.action === 'save') save_(op.kind, op.item || {});
  else if (op.action === 'delete') remove_(op.kind, op.id);
  else if (op.action === 'ingest') ingest_(op.text, op.source || 'sms', op.at ? new Date(Number(op.at)) : null, null);
  else if (op.action === 'confirm') confirm_(op.items || []);
  else if (op.action === 'ignore') setInboxStatus_(op.ids || [], 'ignored');
  else throw new Error('Unknown operation.');
}

function withSnapshot_(o) {
  o.entries = readAll_('entry');
  o.inbox = readAll_('inbox').filter(function (x) { return x.status === 'new'; });
  o.holdings = readAll_('holding');
  o.lastScan = Number(PropertiesService.getScriptProperties().getProperty('LAST_SCAN') || 0);
  try { var book = ss_(); o.sheetId = book.getId(); o.sheetUrl = book.getUrl(); } catch (e) { }
  return o;
}

/* ---------- Gmail ---------- */
function maybeScan_(force) {
  var last = Number(PropertiesService.getScriptProperties().getProperty('LAST_SCAN') || 0);
  if (!force && Date.now() - last < SCAN_GAP_MS) return false;
  scanGmail_();
  return true;
}

function scanGmail_() {
  var props = PropertiesService.getScriptProperties();
  var query = props.getProperty('GMAIL_QUERY') || DEFAULT_GMAIL_QUERY;
  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var threads = GmailApp.search(query + ' -label:' + PROCESSED_LABEL, 0, 40);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var body = msg.getPlainBody() || stripHtml_(msg.getBody());
      ingest_(msg.getSubject() + '\n' + emailCore_(body), 'email', msg.getDate(), msg.getId());
    });
    thread.addLabel(label);
  });
  props.setProperty('LAST_SCAN', String(Date.now()));
}

/* ---------- inbox ---------- */
function ingest_(text, source, when, msgId) {
  var parsed = ExpenseParser.parse(String(text || ''), when || new Date());
  if (!parsed) return { skipped: true, reason: 'Not a completed debit or credit.' };
  var dup = findDuplicate_(parsed, msgId);
  if (dup) return { duplicate: true };
  var now = new Date().toISOString();
  var item = {
    id: Utilities.getUuid(), date: parsed.date, time: parsed.time, type: parsed.type, amount: parsed.amount,
    category: parsed.category, description: parsed.description, party: parsed.party, account: parsed.account,
    bank: parsed.bank, mode: parsed.mode, ref: parsed.ref, balance: parsed.balance === null ? '' : parsed.balance,
    source: source === 'email' ? 'email' : 'sms', status: 'new', msgId: msgId || '', entryId: '',
    raw: String(text).slice(0, 1500), received: now, updated: now
  };
  append_('inbox', item);
  return { added: true, item: item };
}

function findDuplicate_(p, msgId) {
  var lists = [readAll_('inbox'), readAll_('entry')];
  for (var l = 0; l < lists.length; l++) {
    for (var i = 0; i < lists[l].length; i++) {
      var e = lists[l][i];
      if (msgId && e.msgId === msgId) return e;
      if (p.ref && e.ref && String(e.ref) === String(p.ref)) return e;
      if (!p.ref && p.account && e.source !== 'manual' && e.type === p.type && Number(e.amount) === p.amount &&
          e.date === p.date && e.account === p.account) return e;
    }
  }
  return null;
}

function confirm_(items) {
  var tab = rows_('inbox'), added = 0, now = new Date().toISOString();
  items.forEach(function (it) {
    for (var i = 0; i < tab.rows.length; i++) {
      var m = tab.rows[i].obj;
      if (m.id !== String(it.id) || m.status !== 'new') continue;
      var entry = {};
      ENTRY_FIELDS.forEach(function (k) { if (m[k] !== undefined) entry[k] = m[k]; });
      var edits = it.entry || {};
      ENTRY_FIELDS.forEach(function (k) { if (edits[k] !== undefined && k !== 'raw' && k !== 'source') entry[k] = edits[k]; });
      var saved = save_('entry', entry);
      m.status = 'added'; m.entryId = saved.id; m.updated = now;
      writeRow_(tab, tab.rows[i].r, m);
      added++;
    }
  });
  return added;
}

/* Reads waiting Inbox items again with the current reader (after an improvement). */
function reparseInbox() { Logger.log('Re-read ' + reparseInbox_() + ' waiting items.'); }
function reparseInbox_() {
  var tab = rows_('inbox'), n = 0, now = new Date().toISOString();
  tab.rows.forEach(function (row) {
    var m = row.obj;
    if (m.status !== 'new' || !m.raw) return;
    var p = ExpenseParser.parse(m.raw, new Date(m.date + 'T12:00:00'));
    if (!p) return;
    ['date', 'time', 'type', 'amount', 'category', 'description', 'party', 'account', 'bank', 'mode', 'ref'].forEach(function (k) { m[k] = p[k]; });
    m.balance = p.balance === null ? '' : p.balance;
    m.updated = now;
    writeRow_(tab, row.r, m); n++;
  });
  return n;
}

function setInboxStatus_(ids, status) {
  var tab = rows_('inbox'), now = new Date().toISOString(), want = {};
  ids.forEach(function (id) { want[String(id)] = 1; });
  tab.rows.forEach(function (row) {
    if (want[row.obj.id] && row.obj.status === 'new') { row.obj.status = status; row.obj.updated = now; writeRow_(tab, row.r, row.obj); }
  });
}

/* ---------- entries and holdings ---------- */
function save_(kind, input) {
  if (kind !== 'entry' && kind !== 'holding') throw new Error('Unknown record type.');
  var fields = kind === 'entry' ? ENTRY_FIELDS : HOLDING_FIELDS;
  var clean = {};
  fields.forEach(function (k) { if (input[k] !== undefined && input[k] !== null) clean[k] = NUMERIC[k] ? toNum_(input[k]) : String(input[k]); });

  var tab = rows_(kind), now = new Date().toISOString();
  var existing = null;
  if (input.id) for (var i = 0; i < tab.rows.length; i++) if (tab.rows[i].obj.id === String(input.id)) { existing = tab.rows[i]; break; }

  var obj = existing ? existing.obj : { id: String(input.id || Utilities.getUuid()), created: now };
  Object.keys(clean).forEach(function (k) { obj[k] = clean[k]; });
  obj.updated = now;
  if (kind === 'entry') {
    if (!obj.source) obj.source = 'manual';
    obj.status = 'confirmed';
    validateEntry_(obj);
  } else {
    if (!obj.status) obj.status = 'active';
    validateHolding_(obj);
  }
  if (existing) writeRow_(tab, existing.r, obj); else append_(kind, obj);
  return obj;
}

function validateEntry_(o) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || ''))) throw new Error('A valid date is required.');
  if (!(Number(o.amount) > 0)) throw new Error('Amount must be greater than zero.');
  if (o.type !== 'expense' && o.type !== 'income') throw new Error('Type must be expense or income.');
}

function validateHolding_(o) {
  if (!String(o.name || '').trim()) throw new Error('Please give the item a name.');
  if (!String(o.type || '').trim()) throw new Error('Please choose a type.');
  if (o.side !== 'asset' && o.side !== 'liability') throw new Error('Side must be asset or liability.');
  ['start', 'end', 'nextDue'].forEach(function (k) {
    if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error('Dates must be valid.');
  });
}

function remove_(kind, id) {
  if (kind !== 'entry' && kind !== 'holding') throw new Error('Unknown record type.');
  var tab = rows_(kind);
  for (var i = tab.rows.length - 1; i >= 0; i--) {
    if (tab.rows[i].obj.id === String(id)) { tab.sheet.deleteRow(tab.rows[i].r); return true; }
  }
  return false;
}

/* Moves "pending" rows written by version 1 into the new Inbox, once. */
function migrate_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATED_V2')) return;
  var tab = rows_('entry'), moved = 0;
  for (var i = tab.rows.length - 1; i >= 0; i--) {
    var e = tab.rows[i].obj;
    if (e.status !== 'pending') continue;
    var item = {};
    KINDS.inbox.headers.forEach(function (h) { if (e[h] !== undefined) item[h] = e[h]; });
    item.status = 'new';
    item.msgId = /^gmail:/.test(e.note || '') ? e.note.slice(6) : '';
    item.received = e.created || new Date().toISOString();
    append_('inbox', item);
    tab.sheet.deleteRow(tab.rows[i].r);
    moved++;
  }
  props.setProperty('MIGRATED_V2', String(moved));
}

/* ---------- sheet helpers ---------- */
function getSheet_(kind) {
  var def = KINDS[kind];
  var ss = ss_();
  var sheet = ss.getSheetByName(def.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(def.sheet);
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    var have = sheet.getDataRange().getValues()[0].map(String);
    var missing = def.headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  var heads = sheet.getDataRange().getValues()[0].map(String);
  heads.forEach(function (h, i) {
    if (!NUMERIC[h]) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  return sheet;
}

var sheetCache_ = {};
function sheetFor_(kind) { return sheetCache_[kind] || (sheetCache_[kind] = getSheet_(kind)); }

function rows_(kind) {
  var sheet = sheetFor_(kind), data = sheet.getDataRange().getValues();
  var headers = data[0].map(String), rows = [];
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === '' || data[r][0] === null) continue;
    rows.push({ r: r + 1, obj: rowToObj_(headers, data[r]) });
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function readAll_(kind) { return rows_(kind).rows.map(function (x) { return x.obj; }); }

function append_(kind, obj) {
  var sheet = sheetFor_(kind), headers = sheet.getDataRange().getValues()[0].map(String);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([objToRow_(headers, obj)]);
}

function writeRow_(tab, r, obj) {
  tab.sheet.getRange(r, 1, 1, tab.headers.length).setValues([objToRow_(tab.headers, obj)]);
}

function rowToObj_(headers, row) {
  var o = {}, tz = Session.getScriptTimeZone();
  headers.forEach(function (h, i) {
    var v = row[i];
    if (v instanceof Date) {
      v = h === 'time' ? Utilities.formatDate(v, tz, 'HH:mm') : DATE_KEYS[h] ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
    }
    o[h] = NUMERIC[h] ? (v === '' || v === null || v === undefined ? '' : Number(v)) : (v === null || v === undefined ? '' : String(v));
  });
  return o;
}

function objToRow_(headers, o) {
  return headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
}

function toNum_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? '' : Math.round(n * 100) / 100;
}

function emailCore_(body) {
  var t = String(body || '').replace(/\s+/g, ' ');
  var cut = t.search(/disclaimer|this is a system[- ]generated|please do not reply|do not reply to this/i);
  if (cut > 80) t = t.slice(0, cut);
  return t.slice(0, 900);
}

function stripHtml_(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8377;|&#x20b9;/gi, 'Rs ');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

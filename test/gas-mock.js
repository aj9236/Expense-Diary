// In-memory stand-ins for the Google services the back end uses.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');

function makeSheet(name) {
  const rows = [];
  const sheet = {
    name, rows,
    getName: () => name,
    getMaxRows: () => 1000,
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.length ? rows.map(r => r.slice()) : [[]] }),
    getRange: (r, c) => ({
      setValues(v) {
        v.forEach((vals, i) => {
          while (rows.length < r + i) rows.push([]);
          const row = rows[r + i - 1];
          vals.forEach((x, j) => { row[c - 1 + j] = x; });
        });
        return this;
      },
      setFontWeight() { return this; }, setNumberFormat() { return this; }
    }),
    deleteRow: (n) => rows.splice(n - 1, 1)
  };
  return sheet;
}

function load(codePath, opts = {}) {
  const props = Object.assign({}, opts.props || {});
  const sheets = {};
  (opts.presetSheets || []).forEach(([name, rows]) => { const s = makeSheet(name); rows.forEach(r => s.rows.push(r)); sheets[name] = s; });
  const gmail = { threads: [] };
  const ctx = {
    console, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    GmailApp: { getUserLabelByName: () => ({}), createLabel: () => ({}), search: () => gmail.threads.splice(0) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate: d => d.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return s; } }) },
    Logger: { log: m => opts.log && console.log('   [log]', m) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }));
  return { ctx, props, sheets, gmail, post };
}
module.exports = { load };

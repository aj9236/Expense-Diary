/* ------------------------------------------------------------------
 * Expense Diary - bank alert parser
 * Reads an Indian bank SMS or alert e-mail and returns a transaction,
 * or null when the text is not a completed debit/credit (OTP, dues,
 * promotions, collect requests and the like).
 * The same code runs in the iPhone app and in Google Apps Script.
 * ------------------------------------------------------------------ */
var ExpenseParser = (function () {
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  var BANKS = [
    [/\bHDFC\b/i, 'HDFC Bank'], [/\bFederal\s*Bank\b|\bFEDBNK\b|-\s*Federal\b/i, 'Federal Bank'],
    [/\bSBI\b|\bState Bank\b/i, 'SBI'], [/\bICICI\b/i, 'ICICI Bank'], [/\bAxis\b/i, 'Axis Bank'],
    [/\bKotak\b/i, 'Kotak Bank'], [/\bCanara\b/i, 'Canara Bank'], [/\bIDFC\b/i, 'IDFC First Bank'],
    [/\bYes\s*Bank\b/i, 'Yes Bank'], [/\bIndusInd\b/i, 'IndusInd Bank'], [/\bBank of Baroda\b|\bBOB\b/i, 'Bank of Baroda'],
    [/\bPNB\b|\bPunjab National\b/i, 'PNB'], [/\bUnion Bank\b/i, 'Union Bank'], [/\bSouth Indian Bank\b|\bSIB\b/i, 'South Indian Bank'],
    [/\bESAF\b/i, 'ESAF Bank'], [/\bCSB\b/i, 'CSB Bank'], [/\bDhanlaxmi\b/i, 'Dhanlaxmi Bank'], [/\bIndian Bank\b/i, 'Indian Bank'],
    [/\bBank of India\b/i, 'Bank of India'], [/\bAU Small\b/i, 'AU Bank'], [/\bPaytm Payments\b/i, 'Paytm Bank']
  ];

  var NOT_A_TRANSACTION = /\bOTP\b|one[\s-]time\s+password|verification code|\bis due\b|\bdue on\b|\bdue date\b|will be debited|to be debited|requested (?:money|rs|inr)|collect request|has requested|\bpre-?approved\b|\bapply now\b|\boffer\b.*\bT&C\b|\bdeclined\b|\bfailed\b|\bunsuccessful\b|\bnot been\b/i;
  var CREDIT_WORDS = /\b(credited|credit alert|received|deposited|refunded|refund of|reversed|reversal|cashback)\b/ig;
  var DEBIT_WORDS = /\b(debited|debit alert|sent|spent|paid|withdrawn|withdrawal|purchase|charged|transferred to|txn of)\b/ig;
  var AMOUNT = /(?:^|[^a-z])(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d+)?)/ig;
  var BALANCE = /(?:avl\.?\s*|available\s*|clr\.?\s*)?bal(?:ance)?\.?\s*(?:is|:|-|=)?\s*(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d+)?)/i;

  var CATEGORY_RULES = {
    expense: [
      [/\bchit|chitty|\bkuri\b|\bksfe\b/i, 'Chitty'],
      [/credit card (?:bill|payment)|\bcc bill\b|card bill payment/i, 'Credit Card Bill'],
      [/swiggy|zomato|restaurant|hotel|cafe|café|bakery|biryani|kitchen|food|tea\b|juice/i, 'Food & Dining'],
      [/supermarket|hypermarket|mart\b|bigbasket|blinkit|zepto|grocer|stores?\b|provision|vegetable|fish|meat|milma|dmart|reliance fresh/i, 'Groceries'],
      [/petrol|fuel|diesel|hpcl|bpcl|iocl|indian oil|bharat petroleum|hp pay|filling station/i, 'Fuel'],
      [/uber|ola\b|rapido|irctc|ksrtc|metro|railway|redbus|makemytrip|airline|indigo|fastag|parking|toll/i, 'Travel'],
      [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|lulu|decathlon/i, 'Shopping'],
      [/electricity|kseb|water authority|airtel|jio|vodafone|\bvi\b|bsnl|recharge|broadband|dth|tata play|gas\b|lpg|bill\s*pay|billdesk/i, 'Bills & Utilities'],
      [/pharma|medical|hospital|clinic|apollo|lab\b|diagnostic|medplus|chemist|doctor/i, 'Health'],
      [/netflix|hotstar|prime video|spotify|bookmyshow|youtube|cinema|pvr|inox/i, 'Entertainment'],
      [/\brent\b/i, 'Rent'], [/\bemi\b|loan|nach|\becs\b/i, 'EMI & Loans'],
      [/insurance|lic\b|premium/i, 'Insurance'], [/school|college|tuition|fees|course|udemy|byju/i, 'Education'],
      [/zerodha|groww|upstox|dhan\b|mutual fund|\bsip\b|smallcase|kuvera|nps\b|ppf/i, 'Investments'],
      [/\batm\b|cash withdrawal/i, 'Cash Withdrawal']
    ],
    income: [
      [/salary|\bsal\b|payroll/i, 'Salary'], [/\bchit|chitty|\bkuri\b|\bksfe\b/i, 'Chitty'], [/interest|\bint\.?\s*pd\b/i, 'Interest'],
      [/refund|reversal|reversed|cashback/i, 'Refund & Cashback'], [/dividend/i, 'Dividend'],
      [/zerodha|groww|upstox|dhan\b|redemption|mutual fund/i, 'Investments']
    ]
  };

  function num(s) { return parseFloat(String(s).replace(/,/g, '')); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function fullYear(y) { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; }

  function firstIndex(re, text) {
    re.lastIndex = 0; var m = re.exec(text); re.lastIndex = 0;
    return m ? m.index : -1;
  }

  function findDate(text, now) {
    var candidates = [];
    var m, re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
    while ((m = re.exec(text))) {
      var d = +m[1], mo = +m[2], y = fullYear(m[3]);
      if (validDate(y, mo, d)) candidates.push({ i: m.index, v: iso(y, mo, d) });
    }
    re = /\b(\d{1,2})[\s\-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-,]*(\d{2,4})(?!\d)/ig;
    while ((m = re.exec(text))) {
      var d2 = +m[1], mo2 = MONTHS[m[2].toLowerCase()], y2 = fullYear(m[3]);
      if (validDate(y2, mo2, d2)) candidates.push({ i: m.index, v: iso(y2, mo2, d2) });
    }
    re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re.exec(text))) {
      if (validDate(+m[1], +m[2], +m[3])) candidates.push({ i: m.index, v: iso(+m[1], +m[2], +m[3]) });
    }
    candidates.sort(function (a, b) { return a.i - b.i; });
    var limit = new Date(now.getTime() + 2 * 86400000);
    for (var k = 0; k < candidates.length; k++) {
      var p = candidates[k].v.split('-');
      if (new Date(+p[0], +p[1] - 1, +p[2]) <= limit) return candidates[k].v;
    }
    return null;
  }

  function findTime(text) {
    var m = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?\b/i.exec(text);
    if (!m) return '';
    var h = +m[1];
    if (m[3]) { var pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return pad(h) + ':' + m[2];
  }

  var STOP = '(?=\\s+on\\s|\\s+On\\b|\\s+ON\\b|\\n|\\.\\s*Ref|\\s+Ref\\w*|\\s+If\\b|\\s+Avl\\b|\\s*\\(|\\.\\s+[A-Z]|\\.\\s*$|\\s+via\\b|\\s+using\\b|\\s+at\\s+\\d|\\s+for\\s|,|;|\\s*$)';
  function cleanParty(s) {
    if (!s) return '';
    s = s.replace(/\s+/g, ' ').replace(/^[\s:.\-]+|[\s:.\-]+$/g, '');
    s = s.replace(/^(?:NEFT|IMPS|UPI|RTGS|NACH)\s+(?:from|to|by)?\s*/i, '');
    if (/^(?:your\b|a\/c|ac\b|acct|account|card\b|\d+$|beneficiary$|ATM\b|POS\b|NEFT$|IMPS$|UPI$|RTGS$)/i.test(s)) return '';
    if (/\ba\/c\b|\baccount\b/i.test(s)) return '';
    return s.length > 60 ? s.slice(0, 60) : s;
  }
  function findParty(text, type) {
    var tries = type === 'expense'
      ? [new RegExp('\\b(?:to|towards|at|for)\\s*:?\\s*(?:VPA\\s+)?(.+?)' + STOP, 'i'), new RegExp('\\bInfo\\s*:?\\s*(.+?)' + STOP, 'i')]
      : [new RegExp('\\b(?:from|by)\\s*:?\\s*(?:VPA\\s+)?(.+?)' + STOP, 'i'), new RegExp('\\bInfo\\s*:?\\s*(.+?)' + STOP, 'i')];
    // Card spends: "... on 28-Oct-26 on AMAZON PAY IN."
    if (type === 'expense') tries.push(/\bon\s+(?!\d)([A-Z][A-Z0-9 &*'._\-]{2,}?)(?=\.\s|\.$|\s+Avl|\s*$)/);
    for (var i = 0; i < tries.length; i++) {
      var re = tries[i], src = text, guard = 0;
      while (guard++ < 6) {
        var m = re.exec(src);
        if (!m) break;
        var c = cleanParty(m[1]);
        if (c && !/^(?:rs\.?|inr|₹)?\s*[\d,.]+$/i.test(c)) return c;
        src = src.slice(m.index + m[0].length);
      }
    }
    return '';
  }

  function findAccount(text) {
    var m = /\b(?:a\/c|acct|account|ac)\b\.?\s*(?:no\.?|number)?\s*[:\-]?\s*(?:ending\s*(?:with|in)?\s*)?[*xX#.\s]*(\d{3,6})\b/i.exec(text);
    if (m) return m[1];
    m = /\bcard\b\s*(?:no\.?)?\s*(?:ending\s*(?:with|in)?\s*)?[*xX#.\s]*(\d{4})\b/i.exec(text);
    return m ? m[1] : '';
  }

  function findBank(text) {
    var best = null;
    for (var i = 0; i < BANKS.length; i++) {
      var m = BANKS[i][0].exec(text);
      if (m && (!best || m.index < best.i)) best = { i: m.index, v: BANKS[i][1] };
    }
    return best ? best.v : '';
  }

  function findMode(text) {
    var m = /\b(UPI|NEFT|IMPS|RTGS|ATM|POS|NACH|ECS|cheque|debit card|credit card|card)\b/i.exec(text);
    if (!m) return '';
    var v = m[1].toLowerCase();
    if (v === 'cheque') return 'Cheque';
    if (v.indexOf('card') >= 0) return 'Card';
    return m[1].toUpperCase();
  }

  function findRef(text) {
    var m = /\b(?:ref(?:erence)?(?:\s*(?:no|number))?\.?(?:\s*is)?|utr(?:\s*no)?|upi(?:\s*ref)?(?:\s*no)?|txn\s*(?:id|no)?|rrn)\s*[.:#\-]?\s*(\d{6,})/i.exec(text);
    return m ? m[1] : '';
  }

  function guessCategory(type, hay) {
    var rules = CATEGORY_RULES[type] || [];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(hay)) return rules[i][1];
    return 'Others';
  }

  function parse(raw, now) {
    if (!raw) return null;
    now = now || new Date();
    var text = String(raw).replace(/\r/g, '').replace(/[ \t ]+/g, ' ').trim();
    // Safety footers ("Never share your OTP/PIN") must not hide a real transaction
    var screened = text.replace(/(?:never|do not|don'?t|pls don'?t|please do not)\s+(?:ever\s+)?share[^.\n]*/gi, ' ');
    if (NOT_A_TRANSACTION.test(screened)) return null;

    var ci = firstIndex(CREDIT_WORDS, text), di = firstIndex(DEBIT_WORDS, text);
    var type = null;
    if (ci >= 0 && (di < 0 || ci < di)) type = 'income';
    else if (di >= 0) type = 'expense';
    if (!type) return null;

    var bal = BALANCE.exec(text), balance = bal ? num(bal[1]) : null;
    var balStart = bal ? bal.index : -1, balEnd = bal ? bal.index + bal[0].length : -1;
    var amount = null, m;
    AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(text))) {
      if (bal && m.index >= balStart - 1 && m.index < balEnd) continue;
      var v = num(m[1]);
      if (v > 0) { amount = v; break; }
    }
    AMOUNT.lastIndex = 0;
    if (amount === null) {
      // e.g. SBI: "A/C X1234 debited by 250.0 on date ..."
      var f = /\b(?:debited|credited|spent|paid|sent)\s*(?:by|with|for|of)?\s*:?\s*([\d,]*\d\.\d{1,2}|[\d,]*\d)(?![\d\/\-])/i.exec(text);
      if (f && num(f[1]) > 0) amount = num(f[1]);
    }
    if (amount === null) return null;

    var date = findDate(text, now), dateFound = !!date;
    if (!date) date = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
    var party = findParty(text, type), mode = findMode(text);
    var description = mode === 'ATM' && type === 'expense' ? 'ATM withdrawal' : party ? (mode ? mode + (type === 'income' ? ' from ' : mode === 'Card' ? ' at ' : ' to ') : '') + party : (type === 'expense' ? 'Debit' : 'Credit') + (mode ? ' via ' + mode : '');

    return {
      type: type,
      amount: Math.round(amount * 100) / 100,
      date: date,
      time: findTime(text),
      party: party,
      description: description,
      account: findAccount(text),
      bank: findBank(text),
      mode: mode,
      ref: findRef(text),
      balance: balance,
      category: guessCategory(type, party + ' ' + text),
      confidence: dateFound && party ? 'high' : 'low'
    };
  }

  return { parse: parse, guessCategory: guessCategory, categories: CATEGORY_RULES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ExpenseParser;

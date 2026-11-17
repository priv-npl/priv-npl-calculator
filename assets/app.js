/* =========================================================
   PRIV 경매·NPL 실전 계산기 — 계산 및 화면 로직
   외부 라이브러리 없음. 모든 계산은 브라우저 안에서만.
   ========================================================= */
(function () {
  'use strict';

  /* ------------------------- 공통 유틸 ------------------------- */
  var nf = new Intl.NumberFormat('ko-KR');
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function cut10(v) { return Math.floor(v / 10) * 10; }
  function num(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var digits = String(el.value || '').replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }
  function dec(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var v = parseFloat(String(el.value || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(v) ? v : 0;
  }
  function wonText(v) { return nf.format(Math.round(v)); }

  /** 17억 7,000만 원 형태 */
  function eok(v) {
    var neg = v < 0;
    var n = Math.abs(Math.round(v));
    if (!n) return '0원';
    var jo = Math.floor(n / 1e12);
    var eokv = Math.floor((n % 1e12) / 1e8);
    var man = Math.floor((n % 1e8) / 1e4);
    var rest = n % 1e4;
    var out = [];
    if (jo) out.push(jo + '조');
    if (eokv) out.push(eokv + '억');
    if (man) out.push(nf.format(man) + '만');
    if (rest && !jo && !eokv) out.push(nf.format(rest));
    return (neg ? '-' : '') + out.join(' ') + ' 원';
  }

  function pctText(v, d) {
    if (!isFinite(v)) return '–';
    d = d === undefined ? 2 : d;
    return v.toFixed(d) + '%';
  }

  function rateText(v) {
    if (!isFinite(v)) return '0%';
    var s = (Math.round(v * 1000) / 1000).toString();
    return s + '%';
  }

  function row(k, v, cls) {
    return '<div class="kv' + (cls ? ' ' + cls : '') + '"><span class="kv__k">' + k + '</span><span class="kv__v">' + v + '</span></div>';
  }

  function group(title) {
    return '<p class="result__group">' + title + '</p>';
  }

  /* ------------------------- 입력 초기화값 보관 ------------------------- */
  var defaults = [];
  function captureDefaults() {
    $$('input, select').forEach(function (el) {
      if (el.type === 'checkbox') {
        defaults.push({ el: el, kind: 'check', v: el.defaultChecked });
      } else if (el.tagName === 'SELECT') {
        var idx = 0;
        for (var i = 0; i < el.options.length; i++) { if (el.options[i].defaultSelected) { idx = i; break; } }
        defaults.push({ el: el, kind: 'select', v: idx });
      } else {
        defaults.push({ el: el, kind: 'value', v: el.defaultValue });
      }
    });
  }
  function resetAll() {
    defaults.forEach(function (d) {
      if (d.kind === 'check') d.el.checked = d.v;
      else if (d.kind === 'select') d.el.selectedIndex = d.v;
      else d.el.value = d.v;
    });
    refreshHints();
    calcAll();
    toast('입력값을 처음 상태로 되돌렸습니다');
  }

  /* ------------------------- 취득세 ------------------------- */
  /**
   * 지방세법 기준 자동 세율.
   *  - 주택 1주택: 6억 이하 1%, 6~9억 누진(가액×2/3억−3)%, 9억 초과 3%
   *  - 주택 중과: 8%(조정 2주택·비조정 3주택), 12%(조정 3주택+·법인)
   *  - 지방교육세: 1~3% 구간은 취득세율의 10%, 중과는 0.4% 고정
   *  - 농어촌특별세: 85㎡ 초과 주택에 0.2% / 8% 중과 0.6% / 12% 중과 1.0%
   *  - 오피스텔·상가·토지: 4% + 0.4% + 0.2% = 4.6%
   */
  function taxFor(type, price, over85) {
    var base, eduPct, ruralPct;
    if (type === 'nonres') {
      base = 4; eduPct = 0.4; ruralPct = 0.2;
    } else {
      if (type === 'home2') base = 8;
      else if (type === 'home3') base = 12;
      else {
        if (price <= 600000000) base = 1;
        else if (price <= 900000000) base = Math.round((price / 1e8 * 2 / 3 - 3) * 100) / 100;
        else base = 3;
      }
      eduPct = base >= 8 ? 0.4 : base / 10;
      ruralPct = over85 ? (base >= 12 ? 1.0 : base >= 8 ? 0.6 : 0.2) : 0;
    }
    var baseAmt = cut10(price * base / 100);
    var eduAmt = base >= 8 ? cut10(price * 0.4 / 100) : cut10(baseAmt * 0.1);
    var ruralAmt = cut10(price * ruralPct / 100);
    return {
      base: base, eduPct: eduPct, ruralPct: ruralPct,
      baseAmt: baseAmt, eduAmt: eduAmt, ruralAmt: ruralAmt,
      total: baseAmt + eduAmt + ruralAmt,
      effective: price > 0 ? (baseAmt + eduAmt + ruralAmt) / price * 100 : 0
    };
  }

  /* ------------------------- 탭 1 ------------------------- */
  function calc1() {
    var type = $('#i1-type').value;
    var over85 = $('#i1-over85').checked;
    var appraisal = num('i1-appraisal');
    var minPrice = num('i1-min');
    var bid = num('i1-bid');
    var ltv1 = dec('i1-ltv1');
    var ltv2 = dec('i1-ltv2');
    var bang = num('i1-bang');
    var legal = num('i1-legal');
    var evict = num('i1-evict');
    var repair = num('i1-repair');
    var rent = num('i1-rent');
    var loanRate = dec('i1-rate');

    var bidRate = appraisal > 0 ? bid / appraisal * 100 : 0;
    var capA = appraisal * ltv1 / 100;
    var capB = bid * ltv2 / 100;
    var capMin = Math.min(capA, capB);
    var binding = capA <= capB ? '감정가 기준' : '낙찰가 기준';
    var loan = Math.max(0, Math.round(capMin - bang));
    var loanLtv = appraisal > 0 ? loan / appraisal * 100 : 0;
    var loanVsBid = bid > 0 ? loan / bid * 100 : 0;

    var equity = bid - loan;
    var tax = taxFor(type, bid, over85);
    var extra = legal + evict + repair;
    var cash = equity + tax.total + extra;

    var interest = loan * loanRate / 100;
    var annualRent = rent * 12;
    var net = annualRent - interest;
    var yieldRate = cash > 0 ? net / cash * 100 : 0;

    var typeLabel = {
      home1: '주택 · 1주택', home2: '주택 · 조정 2주택 / 비조정 3주택',
      home3: '주택 · 조정 3주택 이상 / 법인', nonres: '오피스텔·상가·토지'
    }[type];

    /* ---- 결과 HTML ---- */
    var h = '';
    h += '<div class="metric">';
    h += '<p class="metric__label">총 필요 현금 <span style="font-weight:600;opacity:.8">(낙찰가 − 대출 + 취득세 + 부대비용)</span></p>';
    h += '<p class="metric__value">' + (bid ? eok(cash) : '–') + '</p>';
    h += '<p class="metric__sub">' + (bid
      ? '낙찰가 ' + eok(bid) + ' · 대출 ' + eok(loan) + ' · 자기자금 ' + eok(equity)
      : '감정가와 입찰가를 입력하면 바로 계산됩니다') + '</p>';
    h += '</div>';

    h += '<div class="result__card">';
    h += group('낙찰가');
    h += row('낙찰가율 <em>감정가 대비</em>', bidRate ? pctText(bidRate) : '–');
    h += row('감정가 대비 할인', bidRate ? pctText(100 - bidRate) : '–');
    h += row('최저매각가 대비', minPrice > 0 && bid > 0 ? (bid >= minPrice ? '+' : '') + pctText((bid / minPrice - 1) * 100) : '–');
    h += row('낙찰가', bid ? wonText(bid) + ' 원' : '–');
    h += '</div>';

    h += '<div class="result__card">';
    h += group('경락잔금대출');
    h += row('감정가 기준 한도 <em>' + pctText(ltv1, ltv1 % 1 ? 1 : 0) + '</em>', eok(capA));
    h += row('낙찰가 기준 한도 <em>' + pctText(ltv2, ltv2 % 1 ? 1 : 0) + '</em>', eok(capB));
    h += row('방공제 차감', bang ? '−' + eok(bang) : '0원');
    h += row('적용 대출한도 <em>' + binding + '</em>', eok(loan), 'kv--strong');
    h += row('감정가 기준 LTV', appraisal > 0 ? pctText(loanLtv) : '–');
    h += row('낙찰가 대비 대출비율', bid > 0 ? pctText(loanVsBid) : '–');
    h += row('자기자금 <em>낙찰가 − 대출</em>', bid ? eok(equity) : '–');
    h += '</div>';

    h += '<div class="result__card">';
    h += group('취득세 · 등기 부대비용');
    h += '<div class="chips">';
    h += '<span class="chip">취득세 <b>' + rateText(tax.base) + '</b></span>';
    h += '<span class="chip">지방교육세 <b>' + rateText(tax.eduPct) + '</b></span>';
    h += '<span class="chip">농특세 <b>' + rateText(tax.ruralPct) + '</b></span>';
    h += '<span class="chip">실효 <b>' + pctText(tax.effective) + '</b></span>';
    h += '</div>';
    h += row('취득세 본세', eok(tax.baseAmt));
    h += row('지방교육세', eok(tax.eduAmt));
    h += row('농어촌특별세', eok(tax.ruralAmt));
    h += row('취득세 합계 <em>' + typeLabel + '</em>', eok(tax.total), 'kv--strong');
    h += row('법무사·등기비', eok(legal));
    h += row('명도비', eok(evict));
    h += row('수리비', eok(repair));
    h += row('부대비용 합계', eok(extra));
    h += '</div>';

    h += '<div class="result__card">';
    h += group('수익성');
    h += row('연 임대수익 <em>월 ' + eok(rent) + '</em>', eok(annualRent));
    h += row('연 이자비용 <em>대출금리 ' + pctText(loanRate, loanRate % 1 ? 1 : 0) + '</em>', '−' + eok(interest));
    h += row('연 순수익', eok(net), net >= 0 ? 'kv--pos' : 'kv--neg');
    h += row('연 순수익률 <em>총 필요 현금 대비</em>', pctText(yieldRate), yieldRate >= 0 ? 'kv--pos' : 'kv--neg');
    h += row('월 현금흐름', eok(net / 12));
    h += '</div>';

    h += '<p class="result__foot">취득세율은 지방세법 기준 자동 적용(과세표준 = 낙찰가)이며, 실제 신고액은 위택스에서 확인해야 합니다. 대출한도는 1금융권 관행(감정가 70%·낙찰가 80%)이고 LTV·DSR·절대한도 규제로 더 줄 수 있습니다.</p>';
    h += '<div class="result__actions"><button type="button" class="btn btn--soft" data-print="1">결과 인쇄 · PDF</button></div>';

    $('#result-1').innerHTML = h;
    BAR[1] = ['총 필요 현금', bid ? eok(cash) : '–', '연 수익률', bid ? pctText(yieldRate) : '–'];

    return {
      title: '경매 낙찰 · 취득세',
      summary: [
        ['물건 유형', typeLabel + (over85 ? ' (85㎡ 초과)' : ' (85㎡ 이하)')],
        ['감정가', eok(appraisal)],
        ['최저매각가', eok(minPrice)],
        ['입찰가', eok(bid)],
        ['낙찰가율', bidRate ? pctText(bidRate) : '–']
      ],
      sections: [
        ['경락잔금대출', [
          ['감정가 기준 한도 (' + pctText(ltv1, ltv1 % 1 ? 1 : 0) + ')', eok(capA)],
          ['낙찰가 기준 한도 (' + pctText(ltv2, ltv2 % 1 ? 1 : 0) + ')', eok(capB)],
          ['방공제 차감', bang ? '−' + eok(bang) : '0원'],
          ['적용 대출한도 (' + binding + ')', eok(loan), true],
          ['감정가 기준 LTV', pctText(loanLtv)],
          ['자기자금 (낙찰가 − 대출)', eok(equity)]
        ]],
        ['취득세·부대비용', [
          ['취득세 본세 (' + rateText(tax.base) + ')', eok(tax.baseAmt)],
          ['지방교육세 (' + rateText(tax.eduPct) + ')', eok(tax.eduAmt)],
          ['농어촌특별세 (' + rateText(tax.ruralPct) + ')', eok(tax.ruralAmt)],
          ['취득세 합계 (실효 ' + pctText(tax.effective) + ')', eok(tax.total), true],
          ['법무사·등기비', eok(legal)],
          ['명도비', eok(evict)],
          ['수리비', eok(repair)]
        ]],
        ['필요현금·수익성', [
          ['총 필요 현금', eok(cash), true],
          ['연 임대수익', eok(annualRent)],
          ['연 이자비용', '−' + eok(interest)],
          ['연 순수익', eok(net)],
          ['연 순수익률', pctText(yieldRate), true],
          ['월 현금흐름', eok(net / 12)]
        ]]
      ],
      inquiry: '· 문의 구분: 경매 낙찰 · 잔금대출 · 취득세\n'
        + '· 물건 유형: ' + typeLabel + (over85 ? ' (전용 85㎡ 초과)' : ' (전용 85㎡ 이하)') + '\n'
        + '· 감정가 ' + eok(appraisal) + ' / 최저가 ' + eok(minPrice) + ' / 입찰가 ' + eok(bid) + (bidRate ? ' (낙찰가율 ' + pctText(bidRate) + ')' : '') + '\n'
        + '· 경락잔금대출 한도 ' + eok(loan) + ' (감정가 LTV ' + pctText(loanLtv) + ', ' + binding + ')\n'
        + '· 취득세 ' + eok(tax.total) + ' 포함 총 필요 현금 ' + eok(cash) + '\n'
        + '· 예상 연 순수익 ' + eok(net) + ' / 연 수익률 ' + pctText(yieldRate) + '\n'
    };
  }

  /* ------------------------- 탭 2 ------------------------- */
  function calc2() {
    var appraisal = num('i2-appraisal');
    var opb = num('i2-opb');
    var price = num('i2-price');
    var cost = num('i2-cost');
    var basis = $('#i2-basis').value;
    var ltv = dec('i2-ltv');
    var loanRate = dec('i2-loanrate');
    var bondRate = dec('i2-bond');
    var months = dec('i2-months');
    var recovery = dec('i2-recovery');

    var basisVal = basis === 'appraisal' ? appraisal : price;
    var loan = Math.round(basisVal * ltv / 100);
    var loanLtvPrice = price > 0 ? loan / price * 100 : 0;
    var loanLtvAppraisal = appraisal > 0 ? loan / appraisal * 100 : 0;

    var equity = price + cost - loan;
    var principalRecovered = opb * recovery / 100;
    var bondInterest = opb * bondRate / 100 * months / 12;
    var totalRecover = principalRecovered + bondInterest;
    var loanInterest = loan * loanRate / 100 * months / 12;
    var profit = totalRecover - price - loanInterest - cost;
    var roe = equity > 0 ? profit / equity * 100 : 0;
    var roeAnnual = months > 0 ? roe * 12 / months : 0;
    var discount = opb > 0 ? (opb - price) / opb * 100 : 0;
    var cashOnCash = equity > 0 ? profit / equity * 100 : 0;

    var h = '';
    h += '<div class="metric">';
    h += '<p class="metric__label">연환산 자기자본수익률 (ROE)</p>';
    h += '<p class="metric__value">' + (price ? pctText(roeAnnual) : '–') + '</p>';
    h += '<p class="metric__sub">' + (price
      ? months + '개월 순수익 ' + eok(profit) + ' · 투입 자기자본 ' + eok(equity)
      : '채권 원금과 매입가를 입력하면 바로 계산됩니다') + '</p>';
    h += '</div>';

    if (equity <= 0 && price > 0) {
      h += '<div class="result__card">' + row('확인 필요', '대출이 투입금액을 넘습니다', 'kv--neg') + '</div>';
    }

    h += '<div class="result__card">';
    h += group('채권 매입');
    h += row('채권원금(OPB)', eok(opb));
    h += row('채권매입가', eok(price));
    h += row('OPB 대비 매입 할인율', price > 0 ? pctText(discount) : '–');
    h += row('담보 감정가', eok(appraisal));
    h += row('매입 부대비용', eok(cost));
    h += '</div>';

    h += '<div class="result__card">';
    h += group('질권대출');
    h += row('대출 기준', basis === 'appraisal' ? '담보 감정가' : '채권매입가');
    h += row('질권대출액 <em>LTV ' + pctText(ltv, ltv % 1 ? 1 : 0) + '</em>', eok(loan), 'kv--strong');
    h += row('매입가 대비 LTV', price > 0 ? pctText(loanLtvPrice) : '–');
    h += row('감정가 대비 LTV', appraisal > 0 ? pctText(loanLtvAppraisal) : '–');
    h += row('투입 자기자본 <em>매입가 + 비용 − 대출</em>', eok(equity), equity <= 0 ? 'kv--neg' : '');
    h += '</div>';

    h += '<div class="result__card">';
    h += group('회수 (' + months + '개월)');
    h += row('회수 원금 <em>회수율 ' + pctText(recovery, recovery % 1 ? 1 : 0) + '</em>', eok(principalRecovered));
    h += row('채권이자 수익 <em>연 ' + pctText(bondRate, bondRate % 1 ? 1 : 0) + '</em>', eok(bondInterest));
    h += row('총 회수액', eok(totalRecover), 'kv--strong');
    h += row('질권대출 이자비용 <em>연 ' + pctText(loanRate, loanRate % 1 ? 1 : 0) + '</em>', '−' + eok(loanInterest));
    h += row('매입 부대비용', '−' + eok(cost));
    h += row('순수익', eok(profit), profit >= 0 ? 'kv--pos' : 'kv--neg');
    h += row('기간 ROE', pctText(cashOnCash), profit >= 0 ? 'kv--pos' : 'kv--neg');
    h += row('연환산 ROE', pctText(roeAnnual), roeAnnual >= 0 ? 'kv--pos' : 'kv--neg');
    h += '</div>';

    h += '<p class="result__foot">채권이자는 회수 기간 동안 채권원금 전액 기준으로 계산합니다(회수율과 별개). 질권대출 이자는 기간 이자 단순 계산이며, 실제 상품의 중도상환·연체이자·취급수수료는 반영되지 않습니다.</p>';
    h += '<div class="result__actions"><button type="button" class="btn btn--soft" data-print="2">결과 인쇄 · PDF</button></div>';

    $('#result-2').innerHTML = h;
    BAR[2] = ['연환산 ROE', price ? pctText(roeAnnual) : '–', '순수익', price ? eok(profit) : '–'];

    return {
      title: 'NPL 질권대출 · ROE',
      summary: [
        ['채권원금(OPB)', eok(opb)],
        ['채권매입가', eok(price)],
        ['OPB 대비 할인율', price > 0 ? pctText(discount) : '–'],
        ['담보 감정가', eok(appraisal)]
      ],
      sections: [
        ['질권대출', [
          ['대출 기준', basis === 'appraisal' ? '담보 감정가' : '채권매입가'],
          ['질권대출액 (LTV ' + pctText(ltv, ltv % 1 ? 1 : 0) + ')', eok(loan), true],
          ['매입가 대비 LTV', pctText(loanLtvPrice)],
          ['감정가 대비 LTV', pctText(loanLtvAppraisal)],
          ['투입 자기자본', eok(equity), true]
        ]],
        ['회수 (' + months + '개월)', [
          ['회수 원금 (회수율 ' + pctText(recovery, recovery % 1 ? 1 : 0) + ')', eok(principalRecovered)],
          ['채권이자 수익', eok(bondInterest)],
          ['총 회수액', eok(totalRecover)],
          ['질권대출 이자비용', '−' + eok(loanInterest)],
          ['매입 부대비용', '−' + eok(cost)]
        ]],
        ['수익성', [
          ['순수익', eok(profit), true],
          ['기간 ROE', pctText(cashOnCash)],
          ['연환산 ROE', pctText(roeAnnual), true]
        ]]
      ],
      inquiry: '· 문의 구분: NPL 채권 매입 · 질권대출\n'
        + '· 채권원금 ' + eok(opb) + ' / 매입가 ' + eok(price) + ' (OPB 대비 ' + pctText(discount) + ')\n'
        + '· 담보 감정가 ' + eok(appraisal) + ', 대출 기준 ' + (basis === 'appraisal' ? '감정가' : '매입가') + ' LTV ' + pctText(ltv, ltv % 1 ? 1 : 0) + ' → 질권대출 ' + eok(loan) + '\n'
        + '· 회수 ' + months + '개월 · 회수율 ' + pctText(recovery, recovery % 1 ? 1 : 0) + ' · 채권이자 연 ' + pctText(bondRate, bondRate % 1 ? 1 : 0) + '\n'
        + '· 투입 자기자본 ' + eok(equity) + ' / 순수익 ' + eok(profit) + ' / 연환산 ROE ' + pctText(roeAnnual) + '\n'
    };
  }

  /* ------------------------- 탭 3 ------------------------- */
  function calc3() {
    var bid = num('i3-bid');
    var cost = num('i3-cost');
    var tax = num('i3-tax');
    var small = num('i3-small');
    var senior = num('i3-senior');
    var mortgage = num('i3-mortgage');
    var claim = num('i3-claim');

    var left = bid;
    var rows = [];
    function alloc(name, amount, note, target) {
      var paid = Math.max(0, Math.min(left, amount));
      left -= paid;
      rows.push({ name: name, amount: amount, paid: paid, note: note || '', target: !!target, short: paid < amount });
      return paid;
    }
    alloc('경매 집행비용', cost, '법원·감정·송달료');
    alloc('당해세', tax, '재산세·종부세 등');
    alloc('소액임차인 최우선변제', small, '주임법 제8조');
    alloc('선순위 임차인 보증금', senior, '확정일자 임차인');
    var mortgagePaid = alloc('1순위 근저당', mortgage, '채권최고액', true);

    var recoveryRate = mortgage > 0 ? mortgagePaid / mortgage * 100 : 0;
    var claimRate = claim > 0 ? mortgagePaid / claim * 100 : 0;
    var shortfall = Math.max(0, (claim > 0 ? claim : mortgage) - mortgagePaid);
    var surplus = Math.max(0, left);

    var h = '';
    h += '<div class="metric">';
    h += '<p class="metric__label">1순위 근저당 회수율</p>';
    h += '<p class="metric__value">' + (bid ? pctText(recoveryRate) : '–') + '</p>';
    h += '<p class="metric__sub">' + (bid
      ? '배당 ' + eok(mortgagePaid) + ' / 채권최고액 ' + eok(mortgage) + (claim > 0 ? ' · 실채권 기준 ' + pctText(claimRate) : '')
      : '예상 낙찰가를 입력하면 배당표가 만들어집니다') + '</p>';
    h += '</div>';

    h += '<div class="result__card">';
    h += group('배당 재원');
    h += row('예상 낙찰가 (매각대금)', eok(bid), 'kv--strong');
    h += row('집행비용·당해세', '−' + eok(Math.min(bid, cost + tax)));
    h += row('최우선변제·선순위 임차', '−' + eok(Math.min(Math.max(0, bid - cost - tax), small + senior)));
    h += row('근저당 배당 재원', eok(mortgagePaid));
    h += '</div>';

    h += '<div class="result__card">';
    h += group('순위별 배당표');
    h += '<table class="dist"><thead><tr><th>순위 · 항목</th><th>청구액(원)</th><th>배당액(원)</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var cls = r.target ? 'is-target' : (r.short ? 'is-short' : '');
      h += '<tr class="' + cls + '">';
      h += '<td>' + (i + 1) + '. ' + r.name + (r.note ? '<span>' + r.note + '</span>' : '') + '</td>';
      h += '<td>' + wonText(r.amount) + '</td>';
      h += '<td>' + wonText(r.paid) + '</td>';
      h += '</tr>';
    });
    if (surplus > 0) {
      h += '<tr><td>잔여금<span>채무자에게 반환</span></td><td>–</td><td>' + wonText(surplus) + '</td></tr>';
    }
    h += '</tbody></table>';
    h += '</div>';

    h += '<div class="result__card">';
    h += group('1순위 근저당');
    h += row('채권최고액', eok(mortgage));
    if (claim > 0) h += row('실제 채권액', eok(claim));
    h += row('배당받는 금액', eok(mortgagePaid), 'kv--strong');
    h += row('회수율 <em>채권최고액 대비</em>', pctText(recoveryRate), recoveryRate >= 100 ? 'kv--pos' : 'kv--neg');
    if (claim > 0) h += row('회수율 <em>실제 채권액 대비</em>', pctText(claimRate), claimRate >= 100 ? 'kv--pos' : 'kv--neg');
    h += row('부족액', shortfall ? eok(shortfall) : '0원', shortfall ? 'kv--neg' : '');
    if (surplus > 0) h += row('잔여금 <em>채무자 반환</em>', eok(surplus));
    h += '</div>';

    h += '<p class="result__foot">배당 순서는 실무 관행(집행비용 → 당해세 → 소액임차인 최우선변제 → 확정일자 임차인 → 근저당)을 단순화한 것입니다. 실제 배당은 법원 배당표와 권리관계·확정일자·전입일자에 따라 달라지므로, 매각물건명세서·등기사항전부증명서 확인이 필요합니다.</p>';
    h += '<div class="result__actions"><button type="button" class="btn btn--soft" data-print="3">결과 인쇄 · PDF</button></div>';

    $('#result-3').innerHTML = h;
    BAR[3] = ['1순위 회수율', bid ? pctText(recoveryRate) : '–', '근저당 배당', bid ? eok(mortgagePaid) : '–'];

    var tableRows = rows.map(function (r, i) {
      return [(i + 1) + '. ' + r.name, wonText(r.amount) + ' / ' + wonText(r.paid), r.target];
    });

    return {
      title: '순위별 배당표',
      summary: [
        ['예상 낙찰가', eok(bid)],
        ['집행비용', eok(cost)],
        ['당해세', eok(tax)],
        ['소액임차인 최우선변제', eok(small)],
        ['선순위 임차인 보증금', eok(senior)]
      ],
      sections: [
        ['순위별 배당 (청구액 / 배당액)', tableRows.concat(surplus > 0 ? [['잔여금 (채무자 반환)', wonText(surplus)]] : [])],
        ['1순위 근저당', [
          ['채권최고액', eok(mortgage)],
          ['실제 채권액', claim > 0 ? eok(claim) : '–'],
          ['배당액', eok(mortgagePaid), true],
          ['회수율 (채권최고액 대비)', pctText(recoveryRate), true],
          ['부족액', shortfall ? eok(shortfall) : '0원']
        ]]
      ],
      inquiry: '· 문의 구분: 경매 배당 분석\n'
        + '· 예상 낙찰가 ' + eok(bid) + '\n'
        + '· 집행비용 ' + eok(cost) + ' / 당해세 ' + eok(tax) + ' / 최우선변제 ' + eok(small) + ' / 선순위 임차 ' + eok(senior) + '\n'
        + '· 1순위 근저당 채권최고액 ' + eok(mortgage) + (claim > 0 ? ' (실채권 ' + eok(claim) + ')' : '') + '\n'
        + '· 1순위 배당 ' + eok(mortgagePaid) + ' / 회수율 ' + pctText(recoveryRate) + '\n'
    };
  }

  /* ------------------------- 렌더/공통 갱신 ------------------------- */
  var last = { 1: null, 2: null, 3: null };
  var BAR = {};
  var activeTab = 1;

  function calcAll() {
    last[1] = calc1();
    last[2] = calc2();
    last[3] = calc3();
    updateInquiry();
    updateBar();
  }

  function updateBar() {
    var b = BAR[activeTab];
    if (!b) return;
    setMobileBar(b[0], b[1], b[2], b[3]);
  }

  function setMobileBar(l1, v1, l2, v2) {
    var a = document.getElementById('mbLabel-1');
    var b = document.getElementById('mbValue-1');
    var c = document.getElementById('mbLabel-2');
    var d = document.getElementById('mbValue-2');
    if (a) a.textContent = l1;
    if (b) b.textContent = v1;
    if (c) c.textContent = l2;
    if (d) d.textContent = v2;
  }

  /* ------------------------- 문의 텍스트 ------------------------- */
  var CONTACT_PLACEHOLDER = '· 연락처: ';
  function inquiryBody() {
    var d = last[activeTab] || last[1];
    var head = '[PRIV 실전 계산기 문의] ' + d.title + '\n\n';
    return head + d.inquiry + CONTACT_PLACEHOLDER + '(이름 / 연락처)\n';
  }

  function updateInquiry() {
    var ta = $('#inquiryText');
    if (!ta) return;
    var keep = ta.value;
    var next = inquiryBody();
    // 사용자가 연락처를 적었다면 유지
    var idx = keep.indexOf(CONTACT_PLACEHOLDER);
    if (idx !== -1) {
      var tail = keep.slice(idx + CONTACT_PLACEHOLDER.length).trim();
      if (tail && tail !== '(이름 / 연락처)') {
        next = next.replace(CONTACT_PLACEHOLDER + '(이름 / 연락처)', CONTACT_PLACEHOLDER + tail);
      }
    }
    ta.value = next;

    var sms = 'sms:01096569764&body=' + encodeURIComponent(inquiryBody().slice(0, 600));
    var mail = 'mailto:soosoo8989@nate.com?subject=' + encodeURIComponent('[PRIV] ' + (last[activeTab] || last[1]).title + ' 문의')
      + '&body=' + encodeURIComponent(inquiryBody());
    var s = document.getElementById('smsLink');
    var m = document.getElementById('mailInquiry');
    var ml = document.getElementById('mailLink');
    if (s) s.setAttribute('href', sms);
    if (m) m.setAttribute('href', mail);
    if (ml) ml.setAttribute('href', mail);
  }

  /* ------------------------- 인쇄 ------------------------- */
  function buildPrint() {
    var d = last[activeTab] || last[1];
    var now = new Date();
    var stamp = now.getFullYear() + '. ' + (now.getMonth() + 1) + '. ' + now.getDate() + '. '
      + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    var h = '';
    h += '<div class="print-head">';
    h += '<p class="print-brand">PRIV · NPL · 신탁공매</p>';
    h += '<h1>' + d.title + ' 계산 결과</h1>';
    h += '<p>출력 ' + stamp + ' · 입력값 기준 참고용 자료</p>';
    h += '</div>';

    h += '<div class="print-section"><h2>입력 조건</h2><table class="print-table"><tbody>';
    d.summary.forEach(function (r) {
      h += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    });
    h += '</tbody></table></div>';

    d.sections.forEach(function (sec) {
      h += '<div class="print-section"><h2>' + sec[0] + '</h2><table class="print-table"><tbody>';
      sec[1].forEach(function (r) {
        h += '<tr' + (r[2] ? ' class="is-strong"' : '') + '><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });

    h += '<p class="print-note">본 계산 결과는 참고용입니다. 대출 한도·금리, 취득세율, 배당 순위는 금융사 심사·관할 지자체 신고·법원 실무에 따라 달라질 수 있습니다.</p>';
    h += '<div class="print-foot"><b>PRIV</b> 신탁공매 · NPL 전문<br>업무 문의 010-9656-9764 · soosoo8989@nate.com</div>';

    $('#printArea').innerHTML = h;
  }

  /* ------------------------- 탭 전환 ------------------------- */
  function setTab(n, opts) {
    activeTab = n;
    $$('.tab').forEach(function (b) {
      var on = Number(b.dataset.tab) === n;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('.panel').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'panel-' + n);
    });
    updateInquiry();
    updateBar();
    if (opts && opts.scroll) {
      var bar = $('.tabbar');
      var y = bar ? bar.getBoundingClientRect().height + 8 : 8;
      var panel = document.getElementById('panel-' + n);
      var top = panel.getBoundingClientRect().top + window.pageYOffset - y;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /* ------------------------- 예시 프리셋 ------------------------- */
  var PRESETS = {
    auction: {
      tab: 1,
      values: {
        'i1-appraisal': 1770000000, 'i1-min': 1239000000, 'i1-bid': 1500000000,
        'i1-ltv1': '70', 'i1-ltv2': '80', 'i1-bang': 0,
        'i1-legal': 1200000, 'i1-evict': 3000000, 'i1-repair': 10000000,
        'i1-rent': 6000000, 'i1-rate': '4.5'
      },
      select: { 'i1-type': 'home1' },
      check: { 'i1-over85': true }
    },
    npl: {
      tab: 2,
      values: {
        'i2-appraisal': 1400000000, 'i2-opb': 900000000, 'i2-price': 630000000,
        'i2-cost': 5000000, 'i2-ltv': '70', 'i2-loanrate': '9.5',
        'i2-bond': '12', 'i2-months': '12', 'i2-recovery': '100'
      },
      select: { 'i2-basis': 'price' }
    },
    dist: {
      tab: 3,
      values: {
        'i3-bid': 1260000000, 'i3-cost': 3500000, 'i3-tax': 8500000,
        'i3-small': 55000000, 'i3-senior': 120000000, 'i3-mortgage': 1200000000,
        'i3-claim': 1000000000
      }
    }
  };

  function applyPreset(key) {
    var p = PRESETS[key];
    if (!p) return;
    Object.keys(p.values).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = p.values[id];
      el.value = typeof v === 'number' ? nf.format(v) : v;
    });
    Object.keys(p.select || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = p.select[id];
    });
    Object.keys(p.check || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.checked = p.check[id];
    });
    refreshHints();
    calcAll();
    setTab(p.tab, { scroll: true });
    toast('실전 예시를 불러왔습니다');
  }

  /* ------------------------- 금액 입력 포맷 ------------------------- */
  function formatAmount(el) {
    var digits = String(el.value || '').replace(/[^\d]/g, '').slice(0, 15);
    el.value = digits ? nf.format(Number(digits)) : '';
  }

  function formatDecimal(el) {
    var v = String(el.value || '').replace(/[^0-9.]/g, '');
    var parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    el.value = v;
  }

  function refreshHints() {
    $$('input.amount').forEach(function (el) {
      var hint = document.querySelector('[data-hint-for="' + el.id + '"]');
      if (!hint || hint.hasAttribute('data-static')) return;
      var n = num(el.id);
      var fixed = hint.getAttribute('data-fixed');
      if (n) hint.textContent = eok(n) + (fixed ? ' · ' + fixed : '');
      else hint.textContent = fixed || '';
    });
  }

  /* ------------------------- 이벤트 ------------------------- */
  function bind() {
    $$('input.amount').forEach(function (el) {
      el.addEventListener('input', function () {
        var pos = el.value.length;
        formatAmount(el);
        refreshHints();
        calcAll();
      });
      el.addEventListener('blur', function () {
        formatAmount(el);
        refreshHints();
        calcAll();
      });
    });

    $$('input.num').forEach(function (el) {
      el.addEventListener('input', function () {
        formatDecimal(el);
        calcAll();
      });
    });

    $$('select, input[type="checkbox"]').forEach(function (el) {
      el.addEventListener('change', function () { calcAll(); });
    });

    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(Number(b.dataset.tab)); });
      b.addEventListener('keydown', function (e) {
        var n = Number(b.dataset.tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var next = e.key === 'ArrowRight' ? (n % 3) + 1 : ((n + 1) % 3) + 1;
          setTab(next);
          document.getElementById('tabbtn-' + next).focus();
        }
      });
    });

    $$('.preset').forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(b.dataset.preset); });
    });

    $$('[data-reset]').forEach(function (b) {
      b.addEventListener('click', resetAll);
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-print]');
      if (t) {
        buildPrint();
        setTimeout(function () { window.print(); }, 60);
      }
    });

    var copyBtn = $('#copyInquiry');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = $('#inquiryText').value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            toast('문의 내용을 복사했습니다');
          }, function () { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
      });
    }

    var jump = $('#mbJump');
    if (jump) {
      jump.addEventListener('click', function () {
        var aside = document.querySelector('#panel-' + activeTab + ' .col-result');
        if (aside) aside.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    var ta = $('#inquiryText');
    if (ta) {
      ta.addEventListener('input', function () { /* 사용자가 적은 연락처는 그대로 둔다 */ });
    }
  }

  function fallbackCopy(text) {
    var ta = $('#inquiryText');
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      toast('문의 내용을 복사했습니다');
    } catch (err) {
      toast('복사가 막혔습니다. 직접 선택해 주세요');
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2200);
  }

  /* ------------------------- 시작 ------------------------- */
  function init() {
    captureDefaults();
    $$('input.amount').forEach(formatAmount);
    refreshHints();
    bind();
    calcAll();
    setTab(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

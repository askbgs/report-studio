/* Report Studio – HR / letter templates (offer letter, medical claim, service letter, payslip, experience letter)
 * Each source is defined as sample rows; tools/build-templates.js turns them into SQL (select … from dual),
 * export bundles for the designer's Import, an install script, and mock data for the offline demo. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RptTemplates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var A4W = 595.28, M = 56.69;              // 20 mm margins for letters
  var CW = r2(A4W - 2 * M);                 // 481.9
  var navy = '#1f3a5f', muted = '#6b7686', rule = '#cfd6df', soft = '#f5f7fa';
  var SANS = 'Noto Sans', SERIF = 'Noto Serif';
  function r2(v) { return Math.round(v * 100) / 100; }

  function T(x, y, w, h, text, style, extra) {
    var e = { type: 'text', x: x, y: y, w: w, h: h, text: text, style: style || {} };
    for (var k in (extra || {})) e[k] = extra[k];
    return e;
  }
  function P(x, y, w, h, text, style) { return T(x, y, w, h, text, Object.assign({ align: 'justify', lineHeight: 1.45 }, style || {}), { canGrow: true }); }
  function L(x, y, w, style) { return { type: 'line', x: x, y: y, w: w, h: 4, dir: 'h', style: style || { lineWidth: 0.6, color: rule } }; }
  function R(x, y, w, h, style) { return { type: 'rect', x: x, y: y, w: w, h: h, style: style || {} }; }
  function H(x, y, w, text) { return T(x, y, w, 14, text, { fontFamily: SANS, bold: true, fontSize: 9.5, color: navy }); }
  function sigLine(x, y, w, label) {
    return [L(x, y, w, { lineWidth: 0.6, color: '#555555' }), T(x, y + 5, w, 12, label, { fontFamily: SANS, fontSize: 7.5, color: muted, align: 'center' })];
  }
  function flat(a) { return [].concat.apply([], a); }

  function letterhead(cw, dept) {
    return { type: 'pageHeader', height: 70, elements: [
      { type: 'image', x: 0, y: 0, w: 44, h: 44, src: 'LOGO', fit: 'contain', style: {} },
      T(54, 1, 260, 18, 'Lanka Traders (Pvt) Ltd', { fontFamily: SANS, fontSize: 14, bold: true, color: navy }),
      T(54, 20, 260, 24, 'No. 12, Main Street, Trincomalee 31000, Sri Lanka\nwww.lankatraders.lk · Company Reg. PV 12345', { fontFamily: SANS, fontSize: 7.5, color: muted }),
      T(r2(cw - 200), 1, 200, 40, (dept || 'Human Resources Department') + '\nTel +94 26 222 0000\nhr@lankatraders.lk', { fontFamily: SANS, fontSize: 7.5, color: muted, align: 'right' }),
      L(0, 54, cw, { lineWidth: 1.2, color: navy })
    ] };
  }
  function footer(cw, code) {
    return { type: 'pageFooter', height: 24, elements: [
      L(0, 0, cw, { lineWidth: 0.5, color: rule }),
      T(0, 7, 330, 12, 'Lanka Traders (Pvt) Ltd · ' + code + ' · {{REF_NO}}', { fontFamily: SANS, fontSize: 6.5, color: '#8a94a6' }),
      T(r2(cw - 150), 7, 150, 12, 'Page {{PAGE}} of {{PAGES}}', { fontFamily: SANS, fontSize: 6.5, color: '#8a94a6', align: 'right' })
    ] };
  }
  function page(margin) {
    return { size: 'A4', orientation: 'portrait', unit: 'mm', margin: { top: margin || 42.52, right: M, bottom: 34.02, left: M } };
  }
  var SIGN = { type: 'image', w: 120, h: 40, src: 'SIGN_HR', fit: 'contain', style: {} };
  function sign(x, y) { var s = JSON.parse(JSON.stringify(SIGN)); s.x = x; s.y = y; return s; }

  // ------------------------------------------------------------------ 1. offer letter
  var offer = {
    report: { code: 'OFFER_LETTER', name: 'Employment Offer Letter', status: 'PUBLISHED',
      description: 'Offer of employment: remuneration table, numbered terms (flow across pages), acceptance section' },
    sources: [
      { name: 'CANDIDATE', params: { CANDIDATE_ID: 'C-118' }, where: 'candidate_id = nvl(:CANDIDATE_ID, candidate_id)', types: { LETTER_DATE: 'date', START_DATE: 'date', VALID_UNTIL: 'date', PROBATION_MONTHS: 'number' },
        rows: [{ CANDIDATE_ID: 'C-118', REF_NO: 'LT/HR/OL/2026/118', LETTER_DATE: { sql: 'trunc(sysdate)', mock: 'today' }, SALUTATION: 'Ms. Rajendran',
          CANDIDATE_NAME: 'Ms. Kavitha Rajendran', ADDRESS: 'No. 14, Orr\'s Hill Road\nTrincomalee 31000',
          POSITION: 'Senior Software Engineer', DEPARTMENT: 'Information Technology', REPORTS_TO: 'Head of Information Technology',
          GRADE: 'M2', START_DATE: '2026-12-01', PROBATION_MONTHS: 6, VALID_UNTIL: '2026-11-25',
          HR_MANAGER: 'Nirmala Fernando', HR_TITLE: 'Manager – Human Resources' }] },
      { name: 'PAY', params: {}, types: { MONTHLY: 'number', SEQ: 'number' }, order: 'seq', rows: [
        { SEQ: 1, COMPONENT: 'Basic salary', MONTHLY: 285000 },
        { SEQ: 2, COMPONENT: 'Performance allowance', MONTHLY: 35000 },
        { SEQ: 3, COMPONENT: 'Transport allowance', MONTHLY: 25000 },
        { SEQ: 4, COMPONENT: 'Mobile & internet allowance', MONTHLY: 5000 }] },
      { name: 'TERMS', params: {}, types: { SEQ: 'number' }, order: 'seq', rows: [
        { SEQ: 1, CLAUSE_NO: '2.1', TITLE: 'Probation', CLAUSE_TEXT: 'You will be on probation for six months from your date of joining. On satisfactory completion your appointment will be confirmed in writing. During probation either party may end the employment with two weeks\' written notice.' },
        { SEQ: 2, CLAUSE_NO: '2.2', TITLE: 'Working hours', CLAUSE_TEXT: 'Normal working hours are 8.30 a.m. to 5.00 p.m., Monday to Friday. Your role may occasionally require work outside these hours, including support during system releases.' },
        { SEQ: 3, CLAUSE_NO: '2.3', TITLE: 'Leave', CLAUSE_TEXT: 'You are entitled to 14 days of annual leave, 7 days of casual leave and medical leave in accordance with the Shop and Office Employees Act and company policy. Annual leave accrues from your first full calendar year of service.' },
        { SEQ: 4, CLAUSE_NO: '2.4', TITLE: 'EPF and ETF', CLAUSE_TEXT: 'You will be a member of the Employees\' Provident Fund. You will contribute 8% of your basic salary; the company will contribute 12% to the EPF and 3% to the Employees\' Trust Fund.' },
        { SEQ: 5, CLAUSE_NO: '2.5', TITLE: 'Medical cover', CLAUSE_TEXT: 'You and your immediate family will be covered by the company\'s group health insurance (Plan B) after confirmation, including hospitalisation and an annual out-patient limit of LKR 150,000.' },
        { SEQ: 6, CLAUSE_NO: '2.6', TITLE: 'Confidentiality', CLAUSE_TEXT: 'You must not disclose any confidential information about the company, its customers or its systems during or after your employment. All work you produce in the course of employment belongs to the company.' },
        { SEQ: 7, CLAUSE_NO: '2.7', TITLE: 'Notice period', CLAUSE_TEXT: 'After confirmation, either party may terminate the employment by giving one month\'s written notice or one month\'s basic salary in lieu of notice.' },
        { SEQ: 8, CLAUSE_NO: '2.8', TITLE: 'Code of conduct', CLAUSE_TEXT: 'You agree to follow the company\'s code of conduct, information security policy and other policies issued from time to time, which form part of your terms of employment.' },
        { SEQ: 9, CLAUSE_NO: '2.9', TITLE: 'Documents', CLAUSE_TEXT: 'Please bring your National Identity Card, original educational and professional certificates, a recent service letter from your previous employer and two passport-size photographs on your first day.' }] }
    ],
    layout: {
      version: 1, page: page(), defaults: { fontFamily: SERIF, fontSize: 10, color: '#1f2a37' },
      detailSource: 'TERMS', groups: [], batch: { source: '', key: '' },
      bands: [
        letterhead(CW),
        { type: 'reportHeader', height: 312, elements: [
          T(0, 4, 260, 14, 'Our ref: {{REF_NO}}', { fontFamily: SANS, fontSize: 8.5, color: muted }),
          T(r2(CW - 200), 4, 200, 14, '{{LETTER_DATE|DD Month YYYY}}', { align: 'right' }),
          T(0, 22, 260, 12, 'PRIVATE & CONFIDENTIAL', { fontFamily: SANS, fontSize: 7.5, bold: true, color: '#b23a2e' }),
          T(0, 40, 280, 40, '{{CANDIDATE_NAME}}\n{{ADDRESS}}', { lineHeight: 1.35 }, { canGrow: true }),
          T(0, 92, 300, 14, 'Dear {{SALUTATION}},'),
          T(0, 112, CW, 14, 'Offer of employment – {{POSITION}}', { bold: true, underline: true }),
          P(0, 132, CW, 44, 'We are pleased to offer you the position of {{POSITION}} (grade {{GRADE}}) in our {{DEPARTMENT}} department, reporting to the {{REPORTS_TO}}. Your appointment will begin on {{START_DATE|DD Month YYYY}} and is subject to the terms and conditions set out in this letter.'),
          H(0, 186, CW, '1. Remuneration'),
          { type: 'table', x: 12, y: 204, w: 380, h: 50, source: 'PAY', headerHeight: 17, rowHeight: 16, zebra: false, grid: 'horizontal',
            borderWidth: 0.5, borderColor: rule, repeatHeader: true, canGrow: true, totalLabel: 'Total gross salary',
            headerStyle: { fontFamily: SANS, bg: soft, bold: true, fontSize: 8, color: navy }, rowStyle: { fontSize: 9.5 }, totalStyle: { bg: soft, fontSize: 9.5 },
            columns: [
              { header: 'Component', value: '{{COMPONENT}}', width: 180, align: 'left', total: 'none' },
              { header: 'Monthly (LKR)', value: '{{MONTHLY|#,##0.00}}', width: 100, align: 'right', total: 'sum' },
              { header: 'Annual (LKR)', value: '{{MONTHLY*12|#,##0.00}}', width: 100, align: 'right', total: 'sum' }] },
          P(0, 262, CW, 28, 'Your salary will be paid monthly into your bank account, after deduction of your EPF contribution and any taxes required by law. Salaries are reviewed annually based on performance.'),
          H(0, 296, CW, '2. Terms and conditions')
        ] },
        { type: 'detail', height: 40, elements: [
          T(12, 3, 470, 13, '{{CLAUSE_NO}}  {{TITLE}}', { fontFamily: SANS, bold: true, fontSize: 8.5, color: '#3b4656' }),
          P(30, 17, r2(CW - 30), 18, '{{CLAUSE_TEXT}}', { fontSize: 9.5 })
        ] },
        { type: 'summary', height: 300, elements: [
          P(0, 10, CW, 42, 'If you accept this offer, please sign and return a copy of this letter on or before {{VALID_UNTIL|DD Month YYYY}}. This offer lapses if it has not been accepted by that date. We look forward to welcoming you to Lanka Traders.'),
          T(0, 60, 200, 14, 'Yours sincerely,'),
          sign(0, 76),
          T(0, 118, 260, 28, '{{HR_MANAGER}}\n{{HR_TITLE}}', { lineHeight: 1.35 }),
          R(0, 160, CW, 130, { bg: soft, radius: 4 }),
          T(14, 170, 300, 14, 'ACCEPTANCE OF OFFER', { fontFamily: SANS, bold: true, fontSize: 8.5, color: navy }),
          P(14, 188, r2(CW - 28), 30, 'I, {{CANDIDATE_NAME}}, accept the offer of employment as {{POSITION}} on the terms and conditions set out in this letter, and will report for duty on {{START_DATE|DD Month YYYY}}.', { fontSize: 9.5 }),
          sigLine(14, 252, 150, 'Signature'),
          sigLine(r2(14 + 150 + 20), 252, 120, 'NIC number'),
          sigLine(r2(14 + 150 + 20 + 120 + 20), 252, r2(CW - 28 - 310), 'Date')
        ].reduce(function (a, b) { return a.concat(b); }, []) },
        footer(CW, 'Offer of employment')
      ]
    }
  };

  // ------------------------------------------------------------------ 2. medical claim
  var claim = {
    report: { code: 'MEDICAL_CLAIM', name: 'Medical Claim Letter', status: 'PUBLISHED',
      description: 'Medical reimbursement claim: covering letter, itemised bills with total, entitlement balance, declaration and approvals' },
    sources: [
      { name: 'CLAIM', params: { CLAIM_NO: 'MC-2026-0457' }, where: 'ref_no = nvl(:CLAIM_NO, ref_no)', types: { CLAIM_DATE: 'date', ANNUAL_LIMIT: 'number', CLAIMED_TO_DATE: 'number' },
        rows: [{ REF_NO: 'MC-2026-0457', CLAIM_DATE: { sql: 'trunc(sysdate)', mock: 'today' }, EMP_NO: 'E-1042', EMP_NAME: 'S. Tharmalingam',
          DESIGNATION: 'Accounts Executive', DEPARTMENT: 'Finance', PATIENT: 'Mrs. P. Tharmalingam', RELATIONSHIP: 'Spouse',
          TREATMENT: 'Out-patient treatment and follow-up tests', TREATMENT_PERIOD: '02 October 2026 to 24 October 2026',
          POLICY: 'Group Health Insurance – Plan B', POLICY_NO: 'GH-88231-07', ANNUAL_LIMIT: 150000, CLAIMED_TO_DATE: 42500,
          BANK: 'Salary account (ending 4417)' }] },
      { name: 'BILLS', params: {}, types: { BILL_DATE: 'date', AMOUNT: 'number', SEQ: 'number' }, order: 'seq', rows: [
        { SEQ: 1, BILL_DATE: '2026-10-02', PROVIDER: 'Trinco Medical Centre', BILL_NO: 'TMC/55821', DESCRIPTION: 'Consultation – specialist physician', AMOUNT: 4500 },
        { SEQ: 2, BILL_DATE: '2026-10-02', PROVIDER: 'Lanka Diagnostics Laboratory', BILL_NO: 'LDL-20931', DESCRIPTION: 'Full blood count, lipid profile, HbA1c', AMOUNT: 7850 },
        { SEQ: 3, BILL_DATE: '2026-10-03', PROVIDER: 'City Pharmacy', BILL_NO: 'CP-77410', DESCRIPTION: 'Prescribed medicines (30 days)', AMOUNT: 12340.5 },
        { SEQ: 4, BILL_DATE: '2026-10-17', PROVIDER: 'Trinco Medical Centre', BILL_NO: 'TMC/56390', DESCRIPTION: 'Follow-up consultation', AMOUNT: 3500 },
        { SEQ: 5, BILL_DATE: '2026-10-24', PROVIDER: 'Harbour Physio Clinic', BILL_NO: 'HPC-1187', DESCRIPTION: 'Physiotherapy – 3 sessions', AMOUNT: 9000 }] }
    ],
    layout: {
      version: 1, page: page(), defaults: { fontFamily: SERIF, fontSize: 10, color: '#1f2a37' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        letterhead(CW, 'Employee claim'),
        { type: 'reportHeader', height: 250, elements: [
          T(0, 4, 260, 14, 'Claim no: {{REF_NO}}', { fontFamily: SANS, fontSize: 8.5, color: muted }),
          T(r2(CW - 200), 4, 200, 14, '{{CLAIM_DATE|DD Month YYYY}}', { align: 'right' }),
          T(0, 26, 300, 42, 'The Manager – Human Resources\nLanka Traders (Pvt) Ltd\nTrincomalee', { lineHeight: 1.35 }),
          T(0, 78, 300, 14, 'Dear Sir / Madam,'),
          T(0, 98, CW, 14, 'Claim for reimbursement of medical expenses', { bold: true, underline: true }),
          P(0, 118, CW, 58, 'I submit my claim for reimbursement of medical expenses of LKR {{SUM(BILLS.AMOUNT)|#,##0.00}} ({{WORDS(SUM(BILLS.AMOUNT),\'Rupees\',\'Cents\')}} only), incurred for {{PATIENT}} ({{RELATIONSHIP}}) for {{TREATMENT}} between {{TREATMENT_PERIOD}}. The original bills and the doctor\'s report are attached.'),
          R(0, 180, CW, 66, { bg: soft, radius: 4 }),
          T(12, 186, 110, 14, 'Employee', { fontFamily: SANS, fontSize: 7.5, color: muted }),
          T(12, 199, 210, 14, '{{EMP_NAME}} ({{EMP_NO}})', { bold: true }),
          T(12, 213, 210, 28, '{{DESIGNATION}}\n{{DEPARTMENT}} department', { fontSize: 9 }),
          T(250, 186, 110, 14, 'Insurance policy', { fontFamily: SANS, fontSize: 7.5, color: muted }),
          T(250, 199, 220, 14, '{{POLICY}}', { bold: true, fontSize: 9.5 }),
          T(250, 213, 220, 28, 'Policy no. {{POLICY_NO}}\nPayment to: {{BANK}}', { fontSize: 9 })
        ] },
        { type: 'summary', height: 314, elements: flat([
          H(0, 0, CW, 'Itemised bills'),
          [{ type: 'table', x: 0, y: 18, w: CW, h: 50, source: 'BILLS', headerHeight: 18, rowHeight: 17, zebra: true, zebraColor: '#f7f9fc', grid: 'horizontal',
            borderWidth: 0.5, borderColor: rule, repeatHeader: true, canGrow: true, totalLabel: 'Total claimed ({{COUNT()}} bills)',
            headerStyle: { fontFamily: SANS, bg: navy, color: '#ffffff', bold: true, fontSize: 7.5 }, rowStyle: { fontFamily: SANS, fontSize: 8.5 }, totalStyle: { fontFamily: SANS, bg: '#e8edf3', fontSize: 8.5 },
            columns: [
              { header: 'Date', value: '{{BILL_DATE|DD-Mon-YYYY}}', width: 60, align: 'left', total: 'none' },
              { header: 'Provider', value: '{{PROVIDER}}', width: 122, align: 'left', total: 'none' },
              { header: 'Bill no.', value: '{{BILL_NO}}', width: 62, align: 'left', total: 'none' },
              { header: 'Description', value: '{{DESCRIPTION}}', width: 156, align: 'left', total: 'none' },
              { header: 'Amount (LKR)', value: '{{AMOUNT|#,##0.00}}', width: 81.9, align: 'right', total: 'sum' }] }],
          [R(r2(CW - 230), 80, 230, 78, { bg: soft, radius: 4 }),
            T(r2(CW - 220), 86, 130, 14, 'Annual limit', { fontFamily: SANS, fontSize: 8.5, color: muted }),
            T(r2(CW - 110), 86, 100, 14, '{{ANNUAL_LIMIT|#,##0.00}}', { fontFamily: SANS, fontSize: 8.5, align: 'right' }),
            T(r2(CW - 220), 101, 130, 14, 'Claimed earlier this year', { fontFamily: SANS, fontSize: 8.5, color: muted }),
            T(r2(CW - 110), 101, 100, 14, '{{CLAIMED_TO_DATE|#,##0.00}}', { fontFamily: SANS, fontSize: 8.5, align: 'right' }),
            T(r2(CW - 220), 116, 130, 14, 'This claim', { fontFamily: SANS, fontSize: 8.5, color: muted }),
            T(r2(CW - 110), 116, 100, 14, '{{SUM(BILLS.AMOUNT)|#,##0.00}}', { fontFamily: SANS, fontSize: 8.5, align: 'right' }),
            L(r2(CW - 220), 130, 210, { lineWidth: 0.6, color: '#9aa5b5' }),
            T(r2(CW - 220), 137, 130, 14, 'Balance after this claim', { fontFamily: SANS, fontSize: 8.5, bold: true, color: navy }),
            T(r2(CW - 110), 137, 100, 14, '{{ANNUAL_LIMIT - CLAIMED_TO_DATE - SUM(BILLS.AMOUNT)|#,##0.00}}', { fontFamily: SANS, fontSize: 8.5, bold: true, color: navy, align: 'right' }),
            T(r2(CW - 220), 160, 220, 12, 'Claim exceeds the remaining limit', { fontFamily: SANS, fontSize: 7.5, bold: true, color: '#b23a2e' }, { printWhen: 'ANNUAL_LIMIT - CLAIMED_TO_DATE - SUM(BILLS.AMOUNT) < 0' })],
          [H(0, 80, 220, 'Declaration'),
            P(0, 98, 230, 60, 'I declare that the expenses claimed were incurred for treatment of the person named above, that the bills are genuine, and that I have not claimed them from any other source.', { fontSize: 9 })],
          sigLine(0, 172, 150, 'Employee signature'),
          sigLine(170, 172, 100, 'Date'),
          [H(0, 194, CW, 'Approval')],
          sigLine(0, 236, 140, 'Head of Department'),
          sigLine(r2(CW / 2 - 70), 236, 140, 'Human Resources'),
          sigLine(r2(CW - 140), 236, 140, 'Finance'),
          [T(0, 210, 140, 14, 'Approved: LKR ______________', { fontFamily: SANS, fontSize: 7.5, color: muted, align: 'center' }),
            R(0, 262, CW, 50, { borderWidth: 0.75, borderColor: '#9aa5b5', borderStyle: 'dashed', radius: 3 }),
            T(10, 266, 200, 12, 'FOR OFFICE USE', { fontFamily: SANS, fontSize: 7, bold: true, color: muted }),
            R(12, 282, 9, 9, { borderWidth: 0.75, borderColor: '#555555' }), T(26, 280, 140, 13, 'Bills verified', { fontFamily: SANS, fontSize: 8 }),
            R(130, 282, 9, 9, { borderWidth: 0.75, borderColor: '#555555' }), T(144, 280, 140, 13, 'Within policy limit', { fontFamily: SANS, fontSize: 8 }),
            R(260, 282, 9, 9, { borderWidth: 0.75, borderColor: '#555555' }), T(274, 280, 200, 13, 'Forwarded to insurer', { fontFamily: SANS, fontSize: 8 }),
            T(12, 296, 460, 14, 'Paid on ____________   Voucher no. ____________   Checked by ____________', { fontFamily: SANS, fontSize: 8, color: muted })]
        ]) },
        footer(CW, 'Medical claim')
      ]
    }
  };

  // ------------------------------------------------------------------ 3. service / salary letter
  var service = {
    report: { code: 'SERVICE_LETTER', name: 'Service & Salary Confirmation', status: 'PUBLISHED',
      description: '“To whom it may concern” confirmation of employment and salary (bank loans, visas), with company seal' },
    sources: [
      { name: 'EMPLOYEE', params: { EMP_NO: 'E-0871' }, where: 'emp_no = nvl(:EMP_NO, emp_no)', types: { LETTER_DATE: 'date', JOIN_DATE: 'date', BASIC: 'number', ALLOWANCES: 'number' },
        rows: [{ EMP_NO: 'E-0871', REF_NO: 'LT/HR/SL/2026/0871', LETTER_DATE: { sql: 'trunc(sysdate)', mock: 'today' }, TITLE: 'Mr.', EMP_NAME: 'Mohamed Rizwan Hassan',
          NIC: '198812345678', DESIGNATION: 'Network Operations Supervisor', DEPARTMENT: 'Technical Services', JOIN_DATE: '2019-03-01',
          EMP_TYPE: 'permanent', BASIC: 168000, ALLOWANCES: 42000, PURPOSE: 'an application for a housing loan', PRONOUN: 'he', POSSESSIVE: 'his', OBJ_PRONOUN: 'him',
          SIGNATORY: 'Nirmala Fernando', SIGNATORY_TITLE: 'Manager – Human Resources' }] }
    ],
    layout: {
      version: 1, page: page(), defaults: { fontFamily: SERIF, fontSize: 10.5, color: '#1f2a37' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        letterhead(CW),
        { type: 'reportHeader', height: 560, elements: [
          T(0, 4, 260, 14, 'Our ref: {{REF_NO}}', { fontFamily: SANS, fontSize: 8.5, color: muted }),
          T(r2(CW - 200), 4, 200, 14, '{{LETTER_DATE|DD Month YYYY}}', { align: 'right' }),
          T(0, 40, CW, 18, 'TO WHOM IT MAY CONCERN', { bold: true, fontSize: 12, align: 'center', underline: true }),
          T(0, 70, CW, 14, 'Confirmation of employment and salary – {{TITLE}} {{EMP_NAME}}', { bold: true, align: 'center', fontSize: 10 }),
          P(0, 100, CW, 46, 'This is to certify that {{TITLE}} {{EMP_NAME}} (NIC {{NIC}}, employee no. {{EMP_NO}}) has been employed by Lanka Traders (Pvt) Ltd on a {{EMP_TYPE}} basis since {{JOIN_DATE|DD Month YYYY}}. {{INITCAP(PRONOUN)}} currently holds the position of {{DESIGNATION}} in our {{DEPARTMENT}} department.'),
          P(0, 154, CW, 20, '{{INITCAP(POSSESSIVE)}} current monthly remuneration is as follows:'),
          R(40, 182, 360, 82, { bg: soft, radius: 4 }),
          T(56, 190, 200, 16, 'Basic salary', { fontFamily: SANS, fontSize: 9.5 }),
          T(256, 190, 128, 16, 'LKR {{BASIC|#,##0.00}}', { fontFamily: SANS, fontSize: 9.5, align: 'right' }),
          T(56, 208, 200, 16, 'Fixed allowances', { fontFamily: SANS, fontSize: 9.5 }),
          T(256, 208, 128, 16, 'LKR {{ALLOWANCES|#,##0.00}}', { fontFamily: SANS, fontSize: 9.5, align: 'right' }),
          L(56, 226, 328, { lineWidth: 0.6, color: '#9aa5b5' }),
          T(56, 234, 200, 18, 'Gross monthly salary', { fontFamily: SANS, fontSize: 10, bold: true, color: navy }),
          T(236, 234, 148, 18, 'LKR {{BASIC + ALLOWANCES|#,##0.00}}', { fontFamily: SANS, fontSize: 10, bold: true, color: navy, align: 'right' }),
          P(0, 280, CW, 46, '{{INITCAP(POSSESSIVE)}} salary is credited monthly to {{POSSESSIVE}} bank account and is subject to statutory deductions (EPF 8% and income tax). The company is not aware of any disciplinary matter or notice of resignation pending against {{OBJ_PRONOUN}}.'),
          P(0, 334, CW, 32, 'This letter is issued at {{POSSESSIVE}} request for {{PURPOSE}} and carries no financial liability on the part of the company.'),
          T(0, 386, 200, 14, 'Yours faithfully,'),
          T(0, 402, 260, 14, 'for Lanka Traders (Pvt) Ltd', { fontSize: 9.5, italic: true }),
          sign(0, 420),
          T(0, 464, 260, 30, '{{SIGNATORY}}\n{{SIGNATORY_TITLE}}', { lineHeight: 1.35 }),
          { type: 'ellipse', x: 340, y: 410, w: 92, h: 92, style: { borderWidth: 1.5, borderColor: '#2c4f8a' } },
          { type: 'ellipse', x: 347, y: 417, w: 78, h: 78, style: { borderWidth: 0.6, borderColor: '#2c4f8a' } },
          T(340, 438, 92, 40, 'LANKA\nTRADERS\nTRINCOMALEE', { fontFamily: SANS, fontSize: 7, bold: true, color: '#2c4f8a', align: 'center', lineHeight: 1.3 }),
          T(0, 520, CW, 24, 'Verification: call +94 26 222 0000 or e-mail hr@lankatraders.lk quoting reference {{REF_NO}}.', { fontFamily: SANS, fontSize: 7.5, color: muted })
        ] },
        { type: 'detail', height: 0, elements: [] },
        footer(CW, 'Service letter')
      ]
    }
  };

  // ------------------------------------------------------------------ 4. payslip (A5 landscape)
  var PW = 595.28, PM = 28.35, PCW = r2(PW - 2 * PM);
  var payslip = {
    report: { code: 'PAYSLIP', name: 'Monthly Payslip', status: 'PUBLISHED',
      description: 'A5 payslip: earnings and deductions side by side, EPF 8%/12% and ETF 3%, net pay in words; batch-ready' },
    sources: [
      { name: 'EMP', params: { EMP_NO: 'E-1042', PERIOD: 'October 2026' }, where: 'emp_no = nvl(:EMP_NO, emp_no)', types: { PAY_DATE: 'date', BASIC: 'number', WORK_DAYS: 'number' },
        rows: [{ EMP_NO: 'E-1042', EMP_NAME: 'S. Tharmalingam', DESIGNATION: 'Accounts Executive', DEPARTMENT: 'Finance', EPF_NO: 'EPF 4471',
          PERIOD: { sql: "nvl(:PERIOD, 'October 2026')", mock: 'October 2026' }, PAY_DATE: '2026-10-28', BANK: 'Bank transfer – account ending 4417', BASIC: 145000, WORK_DAYS: 22, REF_NO: 'PAY-2026-10-1042' }] },
      { name: 'LINES', params: {}, types: { SEQ: 'number', EARN_AMT: 'number', DED_AMT: 'number' }, order: 'seq', rows: [
        { SEQ: 1, EARNING: 'Basic salary', EARN_AMT: 145000, DEDUCTION: 'EPF – employee 8%', DED_AMT: 11600 },
        { SEQ: 2, EARNING: 'Budgetary relief allowance', EARN_AMT: 3500, DEDUCTION: 'APIT (income tax)', DED_AMT: 4120 },
        { SEQ: 3, EARNING: 'Transport allowance', EARN_AMT: 18000, DEDUCTION: 'Staff loan instalment', DED_AMT: 8500 },
        { SEQ: 4, EARNING: 'Overtime (6.5 h)', EARN_AMT: 9425, DEDUCTION: 'Welfare society', DED_AMT: 500 },
        { SEQ: 5, EARNING: 'Attendance bonus', EARN_AMT: 5000, DEDUCTION: null, DED_AMT: null }] }
    ],
    layout: {
      version: 1, page: { size: 'A5', orientation: 'landscape', unit: 'mm', margin: { top: PM, right: PM, bottom: PM, left: PM } },
      defaults: { fontFamily: SANS, fontSize: 8.5, color: '#1f2a37' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        { type: 'pageHeader', height: 46, elements: [
          { type: 'image', x: 0, y: 0, w: 34, h: 34, src: 'LOGO', fit: 'contain', style: {} },
          T(42, 0, 260, 16, 'Lanka Traders (Pvt) Ltd', { fontSize: 12, bold: true, color: navy }),
          T(42, 17, 260, 12, 'No. 12, Main Street, Trincomalee · EPF Reg. A/12345', { fontSize: 7, color: muted }),
          T(r2(PCW - 220), 0, 220, 18, 'PAYSLIP', { fontSize: 15, bold: true, color: navy, align: 'right' }),
          T(r2(PCW - 220), 19, 220, 12, '{{PERIOD}}', { fontSize: 8.5, color: muted, align: 'right' }),
          L(0, 38, PCW, { lineWidth: 1, color: navy })
        ] },
        { type: 'reportHeader', height: 226, elements: [
          R(0, 4, PCW, 44, { bg: soft, radius: 3 }),
          T(10, 9, 60, 11, 'Employee', { fontSize: 7, color: muted }), T(10, 21, 170, 14, '{{EMP_NAME}}', { bold: true, fontSize: 9.5 }), T(10, 34, 170, 11, '{{EMP_NO}} · {{EPF_NO}}', { fontSize: 7.5, color: muted }),
          T(190, 9, 60, 11, 'Position', { fontSize: 7, color: muted }), T(190, 21, 170, 14, '{{DESIGNATION}}', { fontSize: 9 }), T(190, 34, 170, 11, '{{DEPARTMENT}}', { fontSize: 7.5, color: muted }),
          T(380, 9, 150, 11, 'Pay date', { fontSize: 7, color: muted }), T(380, 21, 150, 14, '{{PAY_DATE|DD-Mon-YYYY}}', { fontSize: 9 }), T(380, 34, 150, 11, '{{WORK_DAYS}} working days', { fontSize: 7.5, color: muted }),
          { type: 'table', x: 0, y: 58, w: PCW, h: 50, source: 'LINES', headerHeight: 17, rowHeight: 17, zebra: false, grid: 'horizontal',
            borderWidth: 0.5, borderColor: rule, repeatHeader: false, canGrow: true, totalLabel: 'Total earnings',
            headerStyle: { bg: navy, color: '#ffffff', bold: true, fontSize: 7.5 }, rowStyle: { fontSize: 8.5 }, totalStyle: { bg: '#e8edf3', fontSize: 8.5 },
            columns: [
              { header: 'Earnings', value: '{{EARNING}}', width: 170, align: 'left', total: 'none' },
              { header: 'LKR', value: '{{EARN_AMT|#,##0.00}}', width: 94, align: 'right', total: 'sum' },
              { header: 'Deductions', value: '{{DEDUCTION}}', width: 180, align: 'left', total: 'none' },
              { header: 'LKR', value: '{{DED_AMT|#,##0.00}}', width: 94.58, align: 'right', total: 'sum' }] },
          R(r2(PCW - 230), 116, 230, 40, { bg: navy, radius: 3 }),
          T(r2(PCW - 220), 122, 110, 12, 'NET PAY (LKR)', { fontSize: 7.5, bold: true, color: '#c9d6ea' }),
          T(r2(PCW - 220), 134, 210, 18, '{{SUM(LINES.EARN_AMT) - SUM(LINES.DED_AMT)|#,##0.00}}', { fontSize: 14, bold: true, color: '#ffffff' }),
          T(0, 118, 290, 11, 'NET PAY IN WORDS', { fontSize: 7, bold: true, color: muted }),
          T(0, 130, 290, 26, '{{WORDS(SUM(LINES.EARN_AMT) - SUM(LINES.DED_AMT),\'Rupees\',\'Cents\')}} only', { fontSize: 8.5, italic: true }, { canGrow: true }),
          T(0, 164, 60, 11, 'Paid by', { fontSize: 7, color: muted }), T(0, 175, 290, 13, '{{BANK}}', { fontSize: 8.5 }),
          R(r2(PCW - 230), 162, 230, 52, { borderWidth: 0.6, borderColor: rule, radius: 3 }),
          T(r2(PCW - 222), 166, 214, 11, 'EMPLOYER CONTRIBUTIONS (not deducted)', { fontSize: 6.5, bold: true, color: muted }),
          T(r2(PCW - 222), 179, 140, 13, 'EPF – employer 12%', { fontSize: 8 }), T(r2(PCW - 92), 179, 84, 13, '{{ROUND(BASIC*0.12,2)|#,##0.00}}', { fontSize: 8, align: 'right' }),
          T(r2(PCW - 222), 194, 140, 13, 'ETF – employer 3%', { fontSize: 8 }), T(r2(PCW - 92), 194, 84, 13, '{{ROUND(BASIC*0.03,2)|#,##0.00}}', { fontSize: 8, align: 'right' }),
          T(0, 200, 290, 12, 'This is a computer-generated payslip and needs no signature.', { fontSize: 6.5, color: '#8a94a6' })
        ] },
        { type: 'detail', height: 0, elements: [] },
        { type: 'pageFooter', height: 14, elements: [
          T(0, 2, 300, 11, '{{REF_NO}} · confidential', { fontSize: 6.5, color: '#8a94a6' }),
          T(r2(PCW - 150), 2, 150, 11, 'Printed {{NOW|DD-Mon-YYYY HH24:MI}}', { fontSize: 6.5, color: '#8a94a6', align: 'right' })
        ] }
      ]
    }
  };

  // ------------------------------------------------------------------ 5. experience letter
  var experience = {
    report: { code: 'EXPERIENCE_LETTER', name: 'Experience & Relieving Letter', status: 'PUBLISHED',
      description: 'Certificate of service issued when an employee leaves: period of service, positions held, conduct' },
    sources: [
      { name: 'EMPLOYEE', params: { EMP_NO: 'E-0655' }, where: 'emp_no = nvl(:EMP_NO, emp_no)', types: { LETTER_DATE: 'date', JOIN_DATE: 'date', LEAVE_DATE: 'date' },
        rows: [{ EMP_NO: 'E-0655', REF_NO: 'LT/HR/EX/2026/0655', LETTER_DATE: { sql: 'trunc(sysdate)', mock: 'today' }, TITLE: 'Ms.', EMP_NAME: 'Dilini Perera', PRONOUN: 'she', POSSESSIVE: 'her',
          JOIN_DATE: '2021-06-14', LEAVE_DATE: '2026-10-31', LAST_POSITION: 'Senior Business Analyst', DEPARTMENT: 'Information Technology',
          REASON: 'resigned to pursue postgraduate studies overseas', SIGNATORY: 'Nirmala Fernando', SIGNATORY_TITLE: 'Manager – Human Resources' }] },
      { name: 'ROLES', params: {}, types: { SEQ: 'number', FROM_DATE: 'date', TO_DATE: 'date' }, order: 'seq', rows: [
        { SEQ: 1, ROLE_NAME: 'Business Analyst', FROM_DATE: '2021-06-14', TO_DATE: '2023-12-31' },
        { SEQ: 2, ROLE_NAME: 'Senior Business Analyst', FROM_DATE: '2024-01-01', TO_DATE: '2026-10-31' }] }
    ],
    layout: {
      version: 1, page: page(), defaults: { fontFamily: SERIF, fontSize: 10.5, color: '#1f2a37' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        letterhead(CW),
        { type: 'reportHeader', height: 212, elements: [
          T(0, 4, 260, 14, 'Our ref: {{REF_NO}}', { fontFamily: SANS, fontSize: 8.5, color: muted }),
          T(r2(CW - 200), 4, 200, 14, '{{LETTER_DATE|DD Month YYYY}}', { align: 'right' }),
          T(0, 40, CW, 18, 'TO WHOM IT MAY CONCERN', { bold: true, fontSize: 12, align: 'center', underline: true }),
          T(0, 66, CW, 14, 'Certificate of service – {{TITLE}} {{EMP_NAME}}', { bold: true, align: 'center', fontSize: 10 }),
          P(0, 96, CW, 46, 'This is to certify that {{TITLE}} {{EMP_NAME}} (employee no. {{EMP_NO}}) was employed by Lanka Traders (Pvt) Ltd from {{JOIN_DATE|DD Month YYYY}} to {{LEAVE_DATE|DD Month YYYY}}. At the time of leaving {{PRONOUN}} held the position of {{LAST_POSITION}} in our {{DEPARTMENT}} department.'),
          P(0, 150, CW, 18, 'During {{POSSESSIVE}} service {{PRONOUN}} held the following positions:'),
          { type: 'table', x: 40, y: 176, w: 360, h: 34, source: 'ROLES', headerHeight: 17, rowHeight: 16, zebra: false, grid: 'horizontal',
            borderWidth: 0.5, borderColor: rule, repeatHeader: true, canGrow: true,
            headerStyle: { fontFamily: SANS, bg: soft, bold: true, fontSize: 8, color: navy }, rowStyle: { fontSize: 9.5 },
            columns: [
              { header: 'Position', value: '{{ROLE_NAME}}', width: 180, align: 'left', total: 'none' },
              { header: 'From', value: '{{FROM_DATE|DD-Mon-YYYY}}', width: 90, align: 'left', total: 'none' },
              { header: 'To', value: '{{TO_DATE|DD-Mon-YYYY}}', width: 90, align: 'left', total: 'none' }] }
        ] },
        { type: 'summary', height: 220, elements: [
          P(0, 2, CW, 46, '{{INITCAP(PRONOUN)}} has {{REASON}}, and has been relieved of all duties with effect from the close of business on {{LEAVE_DATE|DD Month YYYY}}. All company property and dues have been settled.'),
          P(0, 56, CW, 46, 'Throughout {{POSSESSIVE}} employment {{PRONOUN}} was diligent, reliable and well regarded by colleagues and clients. We thank {{TITLE}} {{EMP_NAME}} for {{POSSESSIVE}} contribution and wish {{POSSESSIVE}} every success in the future.'),
          T(0, 118, 200, 14, 'Yours faithfully,'),
          sign(0, 136),
          T(0, 180, 260, 30, '{{SIGNATORY}}\n{{SIGNATORY_TITLE}}', { lineHeight: 1.35 })
        ] },
        footer(CW, 'Certificate of service')
      ]
    }
  };

  var SIGN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><path d="M12 58c18-34 30-44 36-38 7 8-14 36-6 38 9 2 22-30 32-28 8 2-3 22 4 24 9 2 15-18 24-16 7 2 0 14 7 14 12 0 30-22 46-24 10-1 6 10 14 10 12 0 30-10 50-14" fill="none" stroke="#1c3c78" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M40 66c40-6 100-8 170-12" fill="none" stroke="#1c3c78" stroke-width="1.6" stroke-linecap="round"/></svg>';

  var reports = [offer, claim, service, payslip, experience];

  // mock data for the offline demo / tests (same values the generated SQL returns)
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T00:00:00'; }
  reports.forEach(function (r) {
    r.mock = function (name) {
      var s = r.sources.filter(function (x) { return x.name === name; })[0];
      if (!s) return null;
      var types = s.types || {};
      var cols = Object.keys(s.rows[0]).map(function (c) { return { name: c, type: types[c] === 'number' ? 'NUMBER' : types[c] === 'date' ? 'DATE' : 'VARCHAR2' }; });
      var rows = s.rows.map(function (row) {
        var o = {};
        Object.keys(row).forEach(function (c) {
          var v = row[c];
          if (v && typeof v === 'object') v = v.mock === 'today' ? iso(new Date()) : v.mock;
          else if (types[c] === 'date' && v) v = v + 'T00:00:00';
          o[c] = v;
        });
        return o;
      });
      return { columns: cols, rows: rows };
    };
  });

  var b64 = function (s) { return typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s).toString('base64'); };
  return { reports: reports, signatureSvg: SIGN_SVG, signatureDataUri: 'data:image/svg+xml;base64,' + b64(SIGN_SVG) };
});

// Loan product pop-up for the home page's My Loan Products card (lenders).
// LAYOUT below decides the questions: one per LOAN_PRODUCTS column, plus yes/no questions that open more questions
// (when the answer is no, those columns get a set value instead). Every column comes back filled in for submit(values).
// Columns the API sends that LAYOUT doesn't mention are asked under "Other".
// Uses the same pop-up styles as the income editor: a card on wide screens, a swipe-up sheet on phones.
import { ensureDialogStyles, lockPageScroll } from '/income-editor.js';
import { QUOTE_CREDIT, QUOTE_DTI, QUOTE_LTV, quoteIndex, rateQuotes, markupModel,
    BUYDOWN_POINTS, BUYDOWN_SCENARIO, buydownQuotes, buydownBase, buydownModel } from '/rate-markups.js';
import { MI_CREDIT, MI_DTI, MI_LTV, MI_REQUIRED_ABOVE, MI_REFERENCE, MI_MAX_QUOTE, FHA_UFMIP, VA_FUNDING_FEES, VA_DOWN_LABELS,
    miQuotes, miModel, miSettings, upfrontFactor } from '/mortgage-insurance.js';
import { PROFESSION_GROUPS, CENSUS_DESIGNATIONS, QUALIFICATIONS, qualificationOf, dpaQualifications, groupList } from '/dpa.js';

const CSS = `
.loan-dialog .income-section .type-fields { margin-top: 2px; }
/* A Down Payment Assistance product's questions, or a regular product's (see LAYOUT) */
.loan-dialog .lp-scope { display: contents; }
.loan-dialog .lp-scope[hidden], .loan-dialog .income-section[data-scope][hidden] { display: none; }
/* Questions that show only for some answers (a Down Payment Assistance product's Loan Type, its amount type, ...) */
.loan-dialog .lp-cond { display: contents; }
.loan-dialog .lp-cond[hidden] { display: none; }
/* A dropdown of checkboxes (professions / groups, census designations): pick any number */
.loan-dialog .lp-multi-list { max-height: 320px; overflow-y: auto; }
.loan-dialog .field label.lp-multi-option, .loan-dialog label.lp-multi-option { display: flex; align-items: center; gap: 12px; margin: 0; padding: 10px 12px; font-size: 0.95rem; font-weight: bold; line-height: 1.3; cursor: pointer; }
.loan-dialog .field .lp-multi-option input, .loan-dialog .lp-multi-option input { flex: none; width: 20px; height: 20px; min-height: 0; margin: 0; padding: 0; border-radius: 4px; accent-color: var(--olive); cursor: pointer; }
.loan-dialog .lp-multi-option:has(input:checked) { background: #eef0e6; }
.loan-dialog .lp-multi.is-invalid .lp-picker-btn { border-color: var(--rust); background-color: #fdf2f2; }
/* "4 to 1", "3 years": a number with words after it */
.loan-dialog .lp-ratio { display: flex; align-items: center; gap: 10px; }
.loan-dialog .lp-ratio input { max-width: 140px; }
.loan-dialog .lp-ratio span { font-weight: bold; color: var(--olive); white-space: nowrap; }
/* Qualifications: each one's type, then what it needs */
.loan-dialog .lp-quals { display: grid; gap: 10px; }
.loan-dialog .lp-qual-list { display: grid; gap: 10px; }
.loan-dialog .lp-qual-list:empty { display: none; }
.loan-dialog .lp-qual-row { display: grid; grid-template-columns: minmax(0, 1fr) 40px; gap: 10px 8px; align-items: center; padding: 10px; border: 2px solid rgba(14, 42, 59, 0.18); border-radius: 20px; background: #faf8f5; }
.loan-dialog .lp-qual-value { grid-column: 1 / -1; display: grid; gap: 6px; }
.loan-dialog .lp-qual-value:empty { display: none; }
.loan-dialog .lp-qual-value > label, .loan-dialog .lp-qual-label { margin: 0 0 0 6px; font-size: 0.86rem; font-weight: bold; }
.loan-dialog .lp-qual-none { margin: 0 0 0 6px; font-size: 0.86rem; opacity: 0.75; }
.loan-dialog .lp-add-fee[hidden], .loan-dialog .lp-option[hidden] { display: none; }
/* One question per line (the income editor's sections are two across) */
.loan-dialog .income-section .type-fields, .loan-dialog .income-section .gate-body, .loan-dialog .income-section .lp-tiles { grid-template-columns: 1fr; }
.loan-dialog .field-label { display: block; font-size: 0.9rem; font-weight: bold; margin: 0 0 8px 6px; }
.loan-dialog .type-picker.yes-no { grid-template-columns: 1fr 1fr; margin-bottom: 0; min-height: 54px; align-items: center; }
/* (the general ".field label" style would otherwise pull these to the top-left) */
.loan-dialog .type-picker label { display: flex; align-items: center; justify-content: center; margin: 0; min-height: 44px; font-size: 0.95rem; }
.loan-dialog .type-picker.is-invalid { box-shadow: 0 0 0 2px var(--rust); }
.loan-dialog .field input.pct { padding-right: 38px; }
.loan-dialog .pct-wrap { position: relative; }
.loan-dialog .pct-wrap::after { content: '%'; position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--olive); pointer-events: none; }
.loan-dialog .field[hidden], .loan-dialog .gate-body[hidden] { display: none; }
/* Questions opened by a yes: same two columns as the section */
.loan-dialog .gate-body { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; padding: 4px 0 4px 14px; border-left: 3px solid rgba(78, 81, 62, 0.25); }
.loan-dialog .gate-body .gate-body { border-left-color: rgba(192, 144, 80, 0.45); }
/* Property types: tiles to tick, like the roles on a new client */
.loan-dialog .lp-tiles { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.loan-dialog .lp-tiles-help { grid-column: 1 / -1; margin: -4px 0 0 6px; font-size: 0.86rem; opacity: 0.75; }
.loan-dialog .lp-tile { position: relative; }
.loan-dialog .lp-tile input { position: absolute; opacity: 0; pointer-events: none; }
.loan-dialog .lp-tile label { display: flex; align-items: center; gap: 12px; min-height: 58px; margin: 0; padding: 8px 16px 8px 8px; border: 2px solid rgba(14, 42, 59, 0.35); border-radius: 18px; background: #f7f4f0; color: var(--brown); font-weight: bold; font-size: 0.98rem; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-tile-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #ece5db; color: var(--tan); }
.loan-dialog .lp-tile-icon svg { width: 20px; height: 20px; }
.loan-dialog .lp-tile input:checked + label { background: var(--olive); border-color: var(--olive); color: var(--cream); }
.loan-dialog .lp-tile input:checked + label .lp-tile-icon { background: var(--cream); color: var(--olive); }
.loan-dialog .lp-tile input:focus-visible + label { outline: 3px solid var(--gold); outline-offset: 3px; }
/* Escrow months: - [3] + */
.loan-dialog .lp-stepper { display: flex; align-items: center; gap: 8px; }
.loan-dialog .lp-stepper input { text-align: center; }
.loan-dialog .lp-step { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--navy); background: #f7f4f0; color: var(--olive); font-family: inherit; font-size: 1.4rem; font-weight: bold; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-step:disabled { opacity: 0.35; cursor: default; }
@media (hover: hover) { .loan-dialog .lp-step:not(:disabled):hover { background: var(--olive); color: var(--cream); } }
/* Dropdowns (Product Type, Rate Type, Loan Term): a button that opens its choices in the form, like the Loan Product
   picker on the pages. The real select stays underneath (hidden) and holds the answer. */
.loan-dialog .lp-native { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.loan-dialog .lp-picker { position: relative; }
.loan-dialog .lp-picker-btn { width: 100%; min-height: 54px; display: flex; align-items: center; gap: 12px; padding: 8px 46px 8px 10px; border: 2px solid var(--navy); border-radius: 999px;
    background: #f7f4f0 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234e513e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 18px center / 16px;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.03); font-family: inherit; font-size: 0.98rem; color: var(--brown); text-align: left; cursor: pointer; transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-picker.is-open .lp-picker-btn { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234e513e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m18 15-6-6-6 6'/%3E%3C/svg%3E"); }
.loan-dialog .lp-picker-btn:focus-visible, .loan-dialog .lp-picker.is-open .lp-picker-btn { outline: none; background-color: var(--white); border-color: var(--tan); box-shadow: 0 0 0 4px rgba(192, 144, 80, 0.22); }
.loan-dialog .lp-native.is-invalid + .lp-picker .lp-picker-btn { border-color: var(--rust); background-color: #fdf2f2; }
.loan-dialog .lp-picker-btn.is-empty .lp-pick-text { opacity: 0.55; }
.loan-dialog .lp-pick-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: #ece5db; color: var(--tan); }
.loan-dialog .lp-pick-icon svg { width: 18px; height: 18px; }
.loan-dialog .lp-picker-btn.is-empty .lp-pick-icon { background: transparent; color: rgba(78, 81, 62, 0.45); }
.loan-dialog .lp-pick-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
.loan-dialog .lp-picker-list { display: none; position: absolute; z-index: 20; top: 100%; left: 0; right: 0; min-width: 240px; margin-top: 8px; padding: 6px; background: var(--white); border: 2px solid var(--navy); border-radius: 20px; box-shadow: 5px 5px 0 var(--navy); }
.loan-dialog .lp-picker.is-open .lp-picker-list { display: grid; gap: 2px; animation: lpPickerIn 0.18s ease both; }
@keyframes lpPickerIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.loan-dialog .lp-option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 8px 12px; border: none; border-radius: 14px; background: transparent; font-family: inherit; color: var(--brown); text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background-color 0.15s ease; }
.loan-dialog .lp-option:focus-visible { outline: 3px solid var(--gold); outline-offset: -3px; }
@media (hover: hover) { .loan-dialog .lp-option:hover { background: #f2ede6; } }
.loan-dialog .lp-option.is-picked { background: var(--olive); color: var(--cream); }
.loan-dialog .lp-option.is-picked .lp-pick-icon { background: var(--cream); color: var(--olive); }
.loan-dialog .lp-option-text { display: grid; gap: 1px; min-width: 0; }
.loan-dialog .lp-option-main { font-weight: bold; font-size: 0.98rem; }
.loan-dialog .lp-option-sub { font-size: 0.84rem; opacity: 0.75; }
.loan-dialog .lp-check { margin-left: auto; flex: 0 0 auto; width: 18px; height: 18px; opacity: 0; }
.loan-dialog .lp-option.is-picked .lp-check { opacity: 1; }
/* Lender fees: the standard ones (a set name and a price), then any others (a name, a price and a remove button) */
.loan-dialog .lp-fees-help { margin: -2px 0 0 6px; font-size: 0.86rem; opacity: 0.75; }
.loan-dialog .lp-fees { display: grid; gap: 8px; }
.loan-dialog .lp-fee-row { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 40px; gap: 8px; align-items: center; }
.loan-dialog .lp-fee-row.is-head { font-size: 0.8rem; font-weight: bold; opacity: 0.7; padding: 0 6px; }
.loan-dialog .lp-fee-row.is-std { padding: 2px 4px; border-radius: 14px; }
.loan-dialog .lp-fee-name { font-size: 0.95rem; font-weight: bold; padding-left: 6px; }
.loan-dialog .lp-fee-row .money-wrap input { min-height: 46px; }
.loan-dialog .lp-fee-remove { width: 36px; height: 36px; border: none; border-radius: 50%; background: #f2ede6; color: var(--brown); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.loan-dialog .lp-fee-remove svg { width: 15px; height: 15px; }
.loan-dialog .lp-fees-sub { margin: 10px 0 0 6px; font-size: 0.9rem; font-weight: bold; }
.loan-dialog .lp-fees-extra:empty { display: none; }
.loan-dialog .lp-add-fee { justify-self: start; margin-top: 2px; padding: 6px 4px; border: none; background: none; font-family: inherit; font-size: 0.92rem; font-weight: bold; color: var(--rust); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.loan-dialog .lp-fee-row .is-invalid { border-color: var(--rust); background: #fdf2f2; }
/* Max DTI: a credit score and its max DTI (and housing-only max DTI, when there's a separate one) per row */
.loan-dialog .lp-tier-list { display: grid; gap: 8px; }
.loan-dialog .lp-tier-list:empty { display: none; }
.loan-dialog .lp-tier-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 40px; }
.loan-dialog .lp-tiers.has-housing .lp-tier-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 40px; }
.loan-dialog .lp-tiers:not(.has-housing) [data-tier-housing] { display: none; }
.loan-dialog .lp-tier-row input { min-height: 46px; }
.loan-dialog .lp-tier-sum { margin: 2px 0 0 6px; font-size: 0.86rem; line-height: 1.5; }
.loan-dialog .lp-tier-sum:empty { display: none; }
/* Rates: the lender's 27 quotes (one table per credit score: DTI down, LTV across), then the markups they work out to */
.loan-dialog .lp-quotes { display: grid; gap: 12px; }
.loan-dialog .lp-quote-block { padding: 10px 8px 6px; border: 2px solid rgba(14, 42, 59, 0.18); border-radius: 18px; background: #faf8f5; }
.loan-dialog .lp-quote-title { margin: 0 0 4px 8px; font-size: 0.95rem; font-weight: bold; }
.loan-dialog .lp-quote-grid { width: 100%; border-collapse: separate; border-spacing: 5px; table-layout: fixed; }
.loan-dialog .lp-quote-grid th { font-size: 0.8rem; font-weight: bold; opacity: 0.75; text-align: center; padding: 0 2px; }
.loan-dialog .lp-quote-grid th[scope="row"] { width: 62px; text-align: left; padding-left: 4px; }
.loan-dialog .lp-quote-grid .pct-wrap::after { right: 12px; }
.loan-dialog .field .lp-quote-grid input { min-height: 46px; padding: 8px 24px 8px 12px; font-size: 1rem; border-radius: 14px; }
.loan-dialog .lp-quote-help strong { white-space: nowrap; }
.loan-dialog .lp-markups { display: grid; gap: 12px; margin-top: 4px; }
.loan-dialog .lp-markups-empty { margin: 0 0 0 6px; font-size: 0.88rem; opacity: 0.7; }
.loan-dialog .lp-markups-head { margin: 4px 0 0 6px; font-size: 0.78rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--rust); }
.loan-dialog .lp-markup-sum { margin: 0; padding: 10px 14px; border-radius: 16px; background: #f2ede6; font-size: 0.9rem; line-height: 1.45; }
.loan-dialog .lp-markup-sum b { white-space: nowrap; }
/* Each metric: its chart (the curve) beside its table */
.loan-dialog .lp-metrics { display: grid; gap: 12px; }
.loan-dialog .lp-markup-table { border: 2px solid var(--navy); border-radius: 16px; overflow: hidden; background: var(--white); }
.loan-dialog .lp-markup-table h4 { margin: 0; padding: 8px 10px; background: var(--olive); color: var(--cream); font-size: 0.9rem; text-align: center; }
.loan-dialog .lp-metric-body { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); }
.loan-dialog .lp-chart { position: relative; padding: 10px 6px 4px 2px; border-right: 1px solid rgba(14, 42, 59, 0.12); outline: none; touch-action: pan-y; cursor: crosshair; }
.loan-dialog .lp-chart:focus-visible { box-shadow: inset 0 0 0 3px var(--gold); }
.loan-dialog .lp-chart svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
.loan-dialog .lp-chart text { font-size: 11px; fill: rgba(79, 45, 44, 0.75); }
.loan-dialog .lp-tip { position: absolute; top: 8px; z-index: 2; display: grid; gap: 1px; padding: 5px 10px; border: 1.5px solid var(--navy); border-radius: 10px; background: var(--white); box-shadow: 2px 2px 0 var(--navy); font-size: 0.78rem; line-height: 1.25; white-space: nowrap; pointer-events: none; }
.loan-dialog .lp-tip[hidden] { display: none; }
.loan-dialog .lp-tip b { font-size: 0.95rem; color: var(--brown); font-variant-numeric: tabular-nums; }
.loan-dialog .lp-tip span { color: rgba(79, 45, 44, 0.75); }
.loan-dialog .lp-mt-scroll { max-height: 236px; overflow-y: auto; }
.loan-dialog .lp-markup-table tr.is-hover td { background: rgba(166, 90, 53, 0.16); }
.loan-dialog .lp-markup-table table { width: 100%; border-collapse: collapse; font-size: 0.86rem; font-variant-numeric: tabular-nums; }
.loan-dialog .lp-markup-table th { position: sticky; top: 0; background: #ece5db; padding: 5px 8px; font-size: 0.76rem; text-align: left; }
.loan-dialog .lp-markup-table th:last-child, .loan-dialog .lp-markup-table td:last-child { text-align: right; }
.loan-dialog .lp-markup-table td { padding: 4px 8px; border-top: 1px solid rgba(14, 42, 59, 0.08); }
.loan-dialog .lp-markup-table tr.is-quoted td { font-weight: bold; background: rgba(192, 144, 80, 0.16); }
.loan-dialog .lp-markup-table tr.is-estimated td { color: rgba(78, 81, 62, 0.7); font-style: italic; }
.loan-dialog .lp-markup-key { margin: 0 0 0 6px; font-size: 0.8rem; opacity: 0.75; }
.loan-dialog .lp-key-line { display: inline-block; width: 18px; height: 0; margin: 0 3px 3px 0; vertical-align: middle; border-top: 2px solid #a65a35; }
.loan-dialog .lp-key-line.is-dashed { border-top-style: dashed; }
.loan-dialog .lp-markup-table tr.is-denied td { color: rgba(78, 81, 62, 0.6); background: rgba(14, 42, 59, 0.05); }
.loan-dialog .lp-key-denied { display: inline-block; width: 12px; height: 10px; margin: 0 3px 1px 0; vertical-align: middle; border-radius: 2px; background: repeating-linear-gradient(45deg, rgba(14, 42, 59, 0.22) 0 2px, rgba(14, 42, 59, 0.05) 2px 5px); }
.loan-dialog .lp-key-band { display: inline-block; width: 12px; height: 10px; margin: 0 3px 1px 0; vertical-align: middle; border-radius: 2px; background: rgba(192, 144, 80, 0.28); }
.loan-dialog .lp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* The rate quote sheet (27 quotes + 4 buydown quotes): being filled in (the boxes and Submit Quotes), or submitted (the
   boxes hidden, the date it was submitted and Requote) */
.loan-dialog [data-quote-entry][hidden], .loan-dialog .lp-sheet-status[hidden], .loan-dialog .lp-sheet-actions[hidden], .loan-dialog .lp-sheet-buttons .btn[hidden] { display: none; }
.loan-dialog .lp-sheet-status { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 2px solid var(--olive); border-radius: 16px; background: #eef0e6; }
.loan-dialog .lp-sheet-status p { flex: 1; margin: 0; font-size: 0.9rem; line-height: 1.45; }
.loan-dialog .lp-sheet-status .btn { flex: none; }
.loan-dialog .lp-sheet-actions { display: grid; gap: 8px; padding-top: 4px; }
.loan-dialog .lp-sheet-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
.loan-dialog .lp-sheet-note { margin: 0 0 0 6px; font-size: 0.86rem; opacity: 0.75; }
.loan-dialog .lp-sheet-msg { margin: 0 0 0 6px; font-size: 0.92rem; font-weight: bold; color: var(--rust); }
.loan-dialog .lp-sheet-msg:empty { display: none; }
@media (max-width: 600px) {
    .loan-dialog .lp-sheet-status { flex-direction: column; align-items: stretch; }
}
/* Mortgage insurance, by product type: FHA's fixed UFMIP, VA's funding fee charts, or the lender's annual premiums
   (Jumbo and Non-Conforming first ask whether there are any) */
.loan-dialog .lp-mi { display: grid; gap: 12px; }
.loan-dialog .lp-mi-part { display: grid; gap: 12px; }
.loan-dialog .lp-mi [data-mi-for][hidden] { display: none; }
.loan-dialog .lp-fixed { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border: 2px dashed rgba(14, 42, 59, 0.3); border-radius: 18px; background: #f2ede6; }
.loan-dialog .lp-fixed-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: #e6ded2; color: var(--olive); }
.loan-dialog .lp-fixed-icon svg { width: 18px; height: 18px; }
.loan-dialog .lp-fixed-text { flex: 1; display: grid; gap: 2px; min-width: 0; }
.loan-dialog .lp-fixed-k { font-size: 0.86rem; font-weight: bold; opacity: 0.8; }
.loan-dialog .lp-fixed-v { font-size: 1.6rem; font-weight: bold; color: var(--brown); font-variant-numeric: tabular-nums; line-height: 1.1; }
.loan-dialog .lp-fixed-tag { flex: none; padding: 4px 10px; border-radius: 999px; background: var(--olive); color: var(--cream); font-size: 0.78rem; font-weight: bold; }
.loan-dialog .lp-va-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.loan-dialog .lp-va-charts td:last-child { font-weight: bold; }
.loan-dialog .lp-check-row { display: flex; align-items: center; gap: 12px; margin: 0; padding: 12px 16px; border: 2px solid rgba(14, 42, 59, 0.35); border-radius: 18px; background: #f7f4f0; color: var(--brown); font-size: 0.95rem; font-weight: bold; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.loan-dialog .lp-check-row input { flex: none; width: 22px; height: 22px; margin: 0; accent-color: var(--olive); cursor: pointer; }
.loan-dialog .lp-check-row:has(input:checked) { border-color: var(--olive); background: #eef0e6; }
.loan-dialog .lp-check-row:has(input:focus-visible) { outline: 3px solid var(--gold); outline-offset: 3px; }
@media (max-width: 600px) {
    .loan-dialog .lp-va-charts { grid-template-columns: 1fr; }
    .loan-dialog .lp-fixed { flex-wrap: wrap; }
}
@media (max-width: 600px) {
    .loan-dialog .lp-metric-body { grid-template-columns: 1fr; }
    .loan-dialog .lp-chart { border-right: none; border-bottom: 1px solid rgba(14, 42, 59, 0.12); }
    .loan-dialog .lp-mt-scroll { max-height: 220px; }
    /* Room for a rate like 7.875 in each quote box */
    .loan-dialog .lp-quote-block { padding: 8px 2px 4px; }
    .loan-dialog .lp-quote-grid { border-spacing: 3px; }
    .loan-dialog .lp-quote-grid th[scope="row"] { width: 38px; padding-left: 4px; font-size: 0.74rem; }
    .loan-dialog .lp-quote-grid th { font-size: 0.74rem; }
    .loan-dialog .field .lp-quote-grid input { padding: 8px 17px 8px 7px; font-size: 0.95rem; border-radius: 12px; }
    .loan-dialog .lp-quote-grid .pct-wrap::after { right: 6px; font-size: 0.85rem; }
    .loan-dialog .gate-body { grid-template-columns: 1fr; }
    /* Phones: an added fee's name on its own line, then its price and remove button */
    .loan-dialog .lp-fee-row.is-extra { grid-template-columns: minmax(0, 1fr) 40px; }
    .loan-dialog .lp-fee-row.is-extra [data-fee-k="name"] { grid-column: 1 / -1; }
}
`;

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0; };
const isTrue = v => String(v || '').trim().toUpperCase() === 'TRUE';

// Each dropdown choice's icon and short description (by its value)
const CHOICES = {
    'Conventional': { icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'), sub: 'Not backed by the government' },
    'FHA': { icon: ICON('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'), sub: 'Government-insured, low down payment' },
    'VA': { icon: ICON('<path d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6L12 17l-5.4 2.8 1-6L3.3 9.4l6-.9Z"/>'), sub: 'For veterans and service members' },
    'Jumbo': { icon: ICON('<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5"/><path d="M9 11h.01"/><path d="M15 11h.01"/>'), sub: 'Above the conforming loan limit' },
    'Down Payment Assistance': { icon: ICON('<path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 16 6 6"/><circle cx="16" cy="9" r="2.9"/><circle cx="6" cy="5" r="3"/>'), sub: 'A second “piggy back” loan toward the down payment' },
    'Non-Conforming': { icon: ICON('<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/>'), sub: 'Outside the standard guidelines' },
    'Fixed Rate': { icon: ICON('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'), sub: 'The same rate for the whole loan' },
    'Adjustable Rate': { icon: ICON('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'), sub: 'Can change after the first few years' },
    '30': { icon: ICON('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>'), main: '30 years' },
    '15': { icon: ICON('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>'), main: '15 years' },
    'other': { icon: ICON('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'), main: 'Other', sub: 'Type the number of years' },
    // A Down Payment Assistance product's Loan Type, Grant Type and amount type, and the qualifications
    'Deferred Silent Second': { icon: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), sub: 'No payment; repaid when the home is sold or refinanced' },
    'Forgivable Silent Second': { icon: ICON('<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>'), sub: 'No payment; forgiven after a number of years' },
    'Second Mortgage': { icon: ICON('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 14h4"/><path d="M8 17h8"/>'), sub: 'A second loan with its own monthly payment' },
    'Grant': { icon: ICON('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'), sub: 'Money that isn’t paid back' },
    'Arizona Department of Housing': { icon: ICON('<path d="M3 21h18"/><path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-6h6v6"/>'), sub: 'A state housing grant' },
    'Individual Development Accounts': { icon: ICON('<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5Z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/>'), sub: 'Matches what the buyer saves' },
    'Profession/Group-Specific': { icon: ICON('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'), sub: 'Only for certain professions or groups' },
    'Percentage': { icon: ICON('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'), sub: 'A share of the purchase price' },
    'Flat Dollar Amount': { icon: ICON('<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'), sub: 'A set dollar amount' },
    'Income Limit': { icon: ICON('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'), sub: 'Household income can’t be over a limit' },
    'Census Designation': { icon: ICON('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>'), sub: 'Only homes in certain census tracts' },
    'Minimum Credit Score': { icon: ICON('<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>'), sub: 'Each purchaser needs at least this score' },
    'First Time Homebuyer': { icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="m9.5 15 2 2 3.5-4"/>'), sub: 'No home owned for a number of years' },
    'Homebuyer Education Class': { icon: ICON('<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>'), sub: 'A purchaser takes a class' },
    'Home Price Maximum': { icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 14h6"/>'), sub: 'The price can’t be over a limit' },
};
const MULTI_ICON = ICON('<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>');
const CHECK_ICON = '<svg class="lp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const EMPTY_ICON = ICON('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>');

// Labels that change with another answer: { col, when: [that column, its value], label }
const LABEL_RULES = [
    // A second loan the client can't adjust is a set LTV, not a maximum
    { col: 'SECOND LOAN LTV MAX', when: ['SECOND LOAN ADJUSTABLE BY CLIENT', 'FALSE'], label: 'Second Loan LTV' },
    // ...and a flat amount the client can adjust is a maximum
    { col: 'SECOND LOAN FLAT AMOUNT', when: ['SECOND LOAN ADJUSTABLE BY CLIENT', 'TRUE'], label: 'Dollar Amount Max' },
];

// --- Max DTI ---
// Credit scores go from 300 to 850 (the lowest and highest possible)
export const CREDIT_MIN = 300, CREDIT_MAX = 850;
const scoreOk = v => /^\d{3}$/.test(String(v).trim()) && +v >= CREDIT_MIN && +v <= CREDIT_MAX;
// The old set tiers (MAX DTI CREDIT SCORE <600 ... 800+), each from its lowest score
const OLD_DTI_TIERS = [['<600', 300], ['600-620', 600], ['620-640', 620], ['640-660', 640], ['660-680', 660], ['680-700', 680],
    ['700-720', 700], ['720-740', 720], ['740-760', 740], ['760-780', 760], ['780-800', 780], ['800+', 800]];
/**
 * A product's max DTI tiers, lowest credit score first: [{ score, dti, housing }] (decimals). Each applies from its credit
 * score up to the next tier's; the lowest also covers any score below it. From MAX DTI TIERS, or (a product saved before
 * those) its MAX DTI CREDIT SCORE ... and MAX DTI HOUSING ONLY CREDIT SCORE ... columns, with tiers in a row that have the
 * same limits merged (none when they're all blank). get(column) → the product's value.
 */
export function productDtiTiers(get) {
    const raw = String(get('MAX DTI TIERS') || '').trim();
    if (raw) {
        try {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                return list.map(t => ({ score: Number(t && t.SCORE), dti: Number(t && t.DTI), housing: t && t.HOUSING !== undefined && t.HOUSING !== null && t.HOUSING !== '' ? Number(t.HOUSING) : Number(t && t.DTI) }))
                    .filter(t => isFinite(t.score) && isFinite(t.dti) && isFinite(t.housing)).sort((a, b) => a.score - b.score);
            }
        } catch (e) { /* the old columns below */ }
    }
    const old = OLD_DTI_TIERS.map(([k, score]) => { const dti = num(get('MAX DTI CREDIT SCORE ' + k)); return { score, dti, housing: num(get('MAX DTI HOUSING ONLY CREDIT SCORE ' + k)) || dti }; });
    if (old.every(t => !t.dti && !t.housing)) return [];
    return old.filter((t, i) => i === 0 || t.dti !== old[i - 1].dti || t.housing !== old[i - 1].housing);
}
// The tier for a credit score (the lowest tier when the score is below them all), or null without tiers
export function dtiTierFor(tiers, score) {
    return tiers.length ? tiers.reduce((best, t) => (t.score <= score ? t : best), tiers[0]) : null;
}
// A product's MIN CREDIT SCORE (below it an applicant is denied), or null when there's none (blank, or 300: the lowest possible)
export function minCreditScore(raw) {
    const n = Math.round(num(raw));
    return n > CREDIT_MIN && n <= CREDIT_MAX ? n : null;
}

// A product's OTHER LENDER FEES (JSON: [{ NAME, AMOUNT }]) as [{ name, amount }]
export function lenderFees(raw) {
    try {
        const list = JSON.parse(String(raw || '[]'));
        return Array.isArray(list) ? list.map(f => ({ name: String((f && f.NAME) || '').trim(), amount: Number(f && f.AMOUNT) || 0 })).filter(f => f.name) : [];
    } catch (e) {
        return [];
    }
}

const DESIGNATIONS = ['LOW', 'MODERATE', 'MIDDLE', 'UPPER'];
const anyAbove0 = cols => v => cols.some(c => num(v[c]) > 0);

// Items: a column question ({ col, label?, input? }), property tiles ({ tiles }), a column always set to one value
// ({ col, fixed }), or a yes/no ({ gate, label, items, isOn(values), off(col, values)?, col?, invert? }). A gate with a col
// is itself that TRUE / FALSE column. When a gate is no (invert: yes), the columns under it get off(col) (else 0, or FALSE
// for yes/no). A cond ({ cond, show(answer), items }) shows its items only while show(answer) is true (answer(column) →
// that question's current answer); hidden, its columns are left blank. Also: a list of professions / groups to tick
// ({ groups: column }) and a product's qualifications ({ quals: column }).
// Scope: a Down Payment Assistance product (Product Type) is a second loan (or a grant) toward the down payment, so it's
// asked only its name, type and the 'dpa' questions; any other product is asked everything else ('regular': every
// section but Product and Down Payment Assistance, plus Rate Type and Loan Term). Questions out of scope aren't shown: a
// regular product's SECOND LOAN ADJUSTABLE BY CLIENT and SECOND LOAN LTV MAX are No / 0 and its other DPA answers
// (DPA_ONLY) are blank, and a DPA product's other answers are left blank.
const DPA = 'Down Payment Assistance';
const SILENT = ['Deferred Silent Second', 'Forgivable Silent Second'];
const DPA_ONLY = ['DPA LOAN TYPE', 'FORGIVEN AFTER YEARS', 'SECOND LOAN TERM', 'SAME RATE AS FIRST LOAN', 'SECOND LOAN RATE MARKUP',
    'GRANT TYPE', 'IDA MATCH RATIO', 'GROUP SPECIFIC', 'ELIGIBLE GROUPS', 'SECOND LOAN AMOUNT TYPE', 'SECOND LOAN FLAT AMOUNT',
    'COMBINED LOANS CAN EXCEED PRICE', 'EXCESS REFUNDED TO BUYER', 'AFFECTS FIRST LOAN RATE', 'FIRST LOAN RATE MARKUP', 'DPA QUALIFICATIONS'];
const LAYOUT = [
    { section: 'Product', scope: '', items: [
        { col: 'LOAN PRODUCT NAME' },
        { col: 'PRODUCT TYPE' },
        // A Down Payment Assistance product's Loan Type, then that type's questions: a forgivable silent second's years in
        // the home; a silent second's professions / groups (if it's for certain ones); a second mortgage's term and rate
        // (the first loan's, or a markup / discount from it); a grant's type (an Individual Development Account's match
        // ratio, or a profession / group grant's groups)
        { col: 'DPA LOAN TYPE', label: 'Loan Type', scope: 'dpa' },
        { cond: 'dpa-forgivable', scope: 'dpa', show: a => a('DPA LOAN TYPE') === 'Forgivable Silent Second', items: [
            { col: 'FORGIVEN AFTER YEARS', label: 'How long must you stay in the home until it is forgiven? (Years)' },
        ] },
        { cond: 'dpa-silent', scope: 'dpa', show: a => SILENT.includes(a('DPA LOAN TYPE')), items: [
            { gate: 'groupspec', col: 'GROUP SPECIFIC', label: 'Is this Profession/Group specific?', items: [], isOn: v => isTrue(v['GROUP SPECIFIC']) },
        ] },
        { cond: 'dpa-second', scope: 'dpa', show: a => a('DPA LOAN TYPE') === 'Second Mortgage', items: [
            { col: 'SECOND LOAN TERM', label: 'What is the loan duration? (Years)' },
            { gate: 'samerate', col: 'SAME RATE AS FIRST LOAN', label: 'Is it the same interest rate as the first loan?', invert: true,
                items: [{ col: 'SECOND LOAN RATE MARKUP', label: 'What is the markup/discount compared to the first loan’s interest rate? (Negative for a lower rate)' }],
                isOn: v => isTrue(v['SAME RATE AS FIRST LOAN']) },
        ] },
        { cond: 'dpa-grant', scope: 'dpa', show: a => a('DPA LOAN TYPE') === 'Grant', items: [
            { col: 'GRANT TYPE' },
            { cond: 'dpa-ida', show: a => a('GRANT TYPE') === 'Individual Development Accounts', items: [{ col: 'IDA MATCH RATIO', label: 'What is the match ratio?' }] },
        ] },
        { cond: 'dpa-groups', scope: 'dpa', show: a => (SILENT.includes(a('DPA LOAN TYPE')) && a('GROUP SPECIFIC') === 'TRUE') || (a('DPA LOAN TYPE') === 'Grant' && a('GRANT TYPE') === 'Profession/Group-Specific'),
            items: [{ groups: 'ELIGIBLE GROUPS', label: 'Which professions or groups is it for?' }] },
        { col: 'RATE TYPE', scope: 'regular' },
        // (no Lender Name question: a product's lender is set by the API from the lender it's under)
        { col: 'LOAN TERM', label: 'Loan Term (Years)', input: 'term', scope: 'regular' },
    ] },
    // How much it is (a share of the price or a flat amount; a maximum when the client can adjust it), whether the two
    // loans can go past the price to cover closing costs (and whether what's left can be refunded to the buyer), whether
    // it changes the first loan's rate (by an average markup), and its qualifications (a list; each type once)
    { section: 'Down Payment Assistance', scope: 'dpa', items: [
        { col: 'SECOND LOAN ADJUSTABLE BY CLIENT', label: 'Is the second loan amount able to be adjusted by the client?' },
        { col: 'SECOND LOAN AMOUNT TYPE', label: 'Is the second loan a percentage of the price or a flat dollar amount?' },
        { cond: 'dpa-pct', show: a => a('SECOND LOAN AMOUNT TYPE') === 'Percentage', items: [{ col: 'SECOND LOAN LTV MAX' }] },
        { cond: 'dpa-flat', show: a => a('SECOND LOAN AMOUNT TYPE') === 'Flat Dollar Amount', items: [{ col: 'SECOND LOAN FLAT AMOUNT', label: 'Dollar Amount' }] },
        { gate: 'exceed', col: 'COMBINED LOANS CAN EXCEED PRICE', label: 'Can the combined loan amounts exceed the purchase price to cover closing costs?',
            items: [{ col: 'EXCESS REFUNDED TO BUYER', label: 'Can any remaining excess be a refund to the buyer?' }], isOn: v => isTrue(v['COMBINED LOANS CAN EXCEED PRICE']), off: () => '' },
        { gate: 'firstrate', col: 'AFFECTS FIRST LOAN RATE', label: 'Does this affect the interest rate on the first loan?',
            items: [{ col: 'FIRST LOAN RATE MARKUP', label: 'Average Rate Markup' }], isOn: v => isTrue(v['AFFECTS FIRST LOAN RATE']), off: () => '' },
        { gate: 'quals', label: 'Are there qualifications?', items: [{ quals: 'DPA QUALIFICATIONS' }], isOn: v => dpaQualifications(v['DPA QUALIFICATIONS']).length > 0 },
    ] },
    // (a product's income limit is now one of a Down Payment Assistance product's qualifications)
    { section: 'Loan Limits', items: [
        { col: 'MAX LTV' }, { col: 'MIN LOAN AMOUNT' }, { col: 'MAX LOAN AMOUNT' }, { col: 'MAX SELLER CREDIT %' },
        { col: 'SILENT SECOND', fixed: 'TRUE' },
    ] },
    { section: 'Property Types', items: [{ tiles: [
        { col: 'ALLOW SINGLE FAMILY', label: 'Single Family', icon: ICON('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>') },
        { col: 'ALLOW TOWNHOME', label: 'Townhome', icon: ICON('<path d="M2 11 7 6l5 5"/><path d="M12 11l5-5 5 5"/><path d="M4 10v11h16V10"/><path d="M12 11v10"/>') },
        { col: 'ALLOW CONDO', label: 'Condo', icon: ICON('<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M9 14h2M13 14h2"/><path d="M10 22v-4h4v4"/>') },
        { col: 'ALLOW MOBILE', label: 'Mobile', icon: ICON('<rect x="2" y="7" width="16" height="10" rx="1"/><path d="M18 11h3l1 3v3h-4"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>') },
        { col: 'ALLOW LAND', label: 'Land', icon: ICON('<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>') },
    ] }] },
    { section: 'Origination & Lender Credits', items: [
        { col: 'ORIGINATION FEE %' }, { col: 'ORIGINATION FEE $' },
        { gate: 'credit', label: 'Is there a lender credit?',
            items: [{ col: 'LENDER CREDIT % OF PURCHASE PRICE' }, { col: 'LENDER CREDIT % OF LOAN AMOUNT' }, { col: 'LENDER CREDIT FLAT $' }, { col: 'ADDITIONAL LENDER CREDIT' }],
            isOn: anyAbove0(['LENDER CREDIT % OF PURCHASE PRICE', 'LENDER CREDIT % OF LOAN AMOUNT', 'LENDER CREDIT FLAT $', 'ADDITIONAL LENDER CREDIT']) },
    ] },
    // Standard fees (every product has them; 0 counts) and any others the lender charges (OTHER LENDER FEES, a list)
    { section: 'Lender Fees', items: [{ fees: {
        standard: ['APPRAISAL FEE AT CLOSING', 'APPRAISAL DEPOSIT', 'APPRASIAL MANAGEMENT FEE', 'CREDIT REPORT FEE', 'FLOOD CERT FEE', 'TAX CERT FEE', 'ATTORNEY REVIEW FEE'],
        col: 'OTHER LENDER FEES' } }] },
    // By Product Type (see /mortgage-insurance.js): FHA shows its fixed 1.75% UFMIP (the section reads "UFMIP"); VA shows
    // the VA's funding fee charts (first and subsequent use; "VA Funding Fee"); Conventional asks the lender's 27 annual
    // premiums (MI QUOTES) and shows the premium curves and the upfront premium worked out from them; Jumbo and
    // Non-Conforming ask whether the product has no mortgage insurance guidelines (NO MI GUIDELINES, checked for a new
    // product) and, when it has them, the same as Conventional
    { section: 'Mortgage Insurance', items: [{ mi: { quotes: 'MI QUOTES', none: 'NO MI GUIDELINES' } }] },
    // The lender's 27 quoted rates (RATE QUOTES) and the markups they work out to, then the 4 quotes with points bought
    // (BUYDOWN QUOTES) and the buydown they work out to (see /rate-markups.js). They replace POINT RATE BUYDOWN AMOUNT.
    { section: 'Rates', items: [{ quotes: 'RATE QUOTES' }, { buydown: 'BUYDOWN QUOTES' }] },
    // The lowest credit score accepted (MIN CREDIT SCORE: below it an applicant is denied; 300, the lowest possible, when
    // there's none), then the max DTI from each credit score the lender lists (MAX DTI TIERS, a list like Lender Fees'
    // added fees), each with its own housing-only max when there's a separate one (else the same as its max DTI)
    { section: 'Max DTI', items: [
        { gate: 'minscore', label: 'Is there a minimum credit score? (Below it, an applicant is denied.)', items: [{ col: 'MIN CREDIT SCORE', label: 'Minimum Credit Score' }],
            isOn: v => minCreditScore(v['MIN CREDIT SCORE']) !== null, off: () => String(CREDIT_MIN) },
        { gate: 'housing', label: 'Is there a separate metric for housing-only DTI?', items: [],
            isOn: v => productDtiTiers(c => v[c]).some(t => t.housing !== t.dti) },
        { tiers: 'MAX DTI TIERS' },
    ] },
    { section: 'Income Qualifying', items: ['SALARY', 'HOURLY', '1099', 'TIP', 'COMMISSION', 'BONUS'].map(k => ({ col: k + ' QUALIFYING %' })) },
    { section: 'Escrow', items: [{ col: 'MONTHS COLLECTED FOR TAXES', input: 'stepper' }, { col: 'MONTHS COLLECTED FOR INSURANCE', input: 'stepper' }] },
    { section: 'Census Designation Credit', items: [
        { gate: 'census', label: 'Is there any credit given for the Census Designation?',
            items: DESIGNATIONS.map(d => ({ gate: 'census-' + d.toLowerCase(), col: 'CENSUS CREDIT ' + d, label: 'Credit for ' + d.charAt(0) + d.slice(1).toLowerCase() + '?',
                items: [{ col: 'CENSUS CREDIT % ' + d, label: d.charAt(0) + d.slice(1).toLowerCase() + ' Credit %' }], isOn: v => isTrue(v['CENSUS CREDIT ' + d]) })),
            isOn: v => DESIGNATIONS.some(d => isTrue(v['CENSUS CREDIT ' + d])) },
    ] },
];
const ESCROW_DEFAULT = '3';

// "MAX DTI HOUSING ONLY CREDIT SCORE 620-640" in the Max DTI Housing Only section reads "Credit Score 620-640"
const SECTION_PREFIX = { 'Rates': 'PAR RATE ', 'Max DTI': 'MAX DTI ', 'Max DTI Housing Only': 'MAX DTI HOUSING ONLY ' };
const UPPER = ['LTV', 'DTI', 'PMI', 'MI', 'FHA', 'VA', 'USDA', 'LLC', 'ID'];
const LOWER = ['of', 'for', 'at', 'and', 'or', 'to'];
export function labelFor(col, section) {
    let text = col.replace('APPRASIAL', 'APPRAISAL').replace('PREPAID MORTGAGE INSURANCE RATE', 'PREPAID MI RATE');
    const prefix = SECTION_PREFIX[section];
    if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length);
    return text.split(' ').map((w, i) => {
        if (UPPER.includes(w)) return w;
        const lower = w.toLowerCase();
        if (i > 0 && LOWER.includes(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join(' ');
}

// Saved value → what the box shows (rates as percents: 0.0275 → "2.75")
function shown(kind, raw) {
    const v = String(raw === undefined || raw === null ? '' : raw).trim();
    if (v === '' || kind === 'text' || kind === 'bool') return v;
    const n = Number(v.replace(/[$,%\s]/g, ''));
    if (!isFinite(n)) return '';
    if (kind === 'rate' || kind === 'signedRate') return String(Number((n * 100).toPrecision(10)));
    if (kind === 'ratio') return String(n);
    if (kind === 'int' || kind === 'score') return String(Math.round(n));
    return withCommas(String(Number(n.toFixed(2))));
}
// "1234567.5" → "1,234,567.5" (the cents part is left as typed)
function withCommas(v) {
    const [whole, cents] = v.split('.');
    const w = whole.replace(/^0+(?=\d)/, '');
    return (w ? Number(w).toLocaleString('en-US') : (cents !== undefined ? '0' : '')) + (cents !== undefined ? '.' + cents : '');
}
// ...and may start with a minus sign
const signedDecimal = (v, places) => (/^\s*-/.test(v) ? '-' : '') + decimalOnly(v, places);
// A dropdown of checkboxes (any number picked). attrs go on its wrapper; the button shows what's picked.
function multiHtml(attrs, options, placeholder) {
    return '<div class="lp-picker lp-multi" ' + attrs + ' data-placeholder="' + escapeHtml(placeholder) + '">'
        + '<button type="button" class="lp-picker-btn is-empty" aria-haspopup="true" aria-expanded="false"><span class="lp-pick-icon">' + MULTI_ICON + '</span><span class="lp-pick-text">' + escapeHtml(placeholder) + '</span></button>'
        + '<div class="lp-picker-list lp-multi-list">' + options.map(o => '<label class="lp-option lp-multi-option"><input type="checkbox" value="' + escapeHtml(o) + '"><span>' + escapeHtml(o) + '</span></label>').join('') + '</div></div>';
}
// Shows what a dropdown of checkboxes has picked (one or two by name, else how many)
function syncMulti(picker) {
    const picked = [...picker.querySelectorAll('input:checked')].map(i => i.value);
    const btn = picker.querySelector('.lp-picker-btn');
    btn.classList.toggle('is-empty', !picked.length);
    btn.querySelector('.lp-pick-text').textContent = !picked.length ? picker.dataset.placeholder : picked.length <= 2 ? picked.join(', ') : picked.length + ' selected';
}
const multiPicked = picker => (picker ? [...picker.querySelectorAll('input:checked')].map(i => i.value) : []);
// Digits and at most one dot, with at most `places` digits after it
function decimalOnly(v, places) {
    const clean = v.replace(/[^\d.]/g, '');
    const dot = clean.indexOf('.');
    if (dot < 0) return clean;
    return clean.slice(0, dot) + '.' + clean.slice(dot + 1).replace(/\./g, '').slice(0, places);
}

const yesNo = (name, attrs) => '<div class="type-picker yes-no" ' + attrs + '>'
    + '<input type="radio" name="' + name + '" id="' + name + '-yes" value="TRUE"><label for="' + name + '-yes">Yes</label>'
    + '<input type="radio" name="' + name + '" id="' + name + '-no" value="FALSE"><label for="' + name + '-no">No</label></div>';

// One column question (its box picked by the column's kind, or item.input)
function question(item, kind, section, n) {
    const id = 'lp-' + n;
    const label = escapeHtml(item.label || labelFor(item.col, section));
    // A list of choices (Product Type, Rate Type): a dropdown
    if (Array.isArray(kind)) {
        return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-col="' + escapeHtml(item.col) + '" data-kind="choice">'
            + '<option value="">Choose...</option>' + kind.map(c => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('') + '</select></div>';
    }
    const attrs = 'id="' + id + '" data-col="' + escapeHtml(item.col) + '" data-kind="' + kind + '"';
    const box = (cls, mode) => '<input ' + attrs + ' class="' + cls + '" type="text" inputmode="' + mode + '" autocomplete="off">';
    const wrap = (cls, inner) => '<div class="' + cls + '">' + inner + '</div>';
    const field = (inner, span) => '<div class="field' + (span ? ' span-2' : '') + '"' + (item.editOnly ? ' data-edit-only' : '') + '><label for="' + id + '">' + label + '</label>' + inner + '</div>';
    if (item.input === 'term') {
        return field('<select id="' + id + '" data-term><option value="">Choose...</option><option value="30">30</option><option value="15">15</option><option value="other">Other</option></select>')
            + '<div class="field" data-term-other hidden><label for="' + id + '-years">Loan Term (Years)</label><input id="' + id + '-years" data-col="' + escapeHtml(item.col) + '" data-kind="int" class="digits" type="text" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="Years"></div>';
    }
    if (item.input === 'stepper') {
        return field('<div class="lp-stepper"><button type="button" class="lp-step" data-step="-1" aria-label="Fewer months">−</button>'
            + box('digits', 'numeric').replace('autocomplete="off"', 'autocomplete="off" maxlength="2"')
            + '<button type="button" class="lp-step" data-step="1" aria-label="More months">+</button></div>');
    }
    if (kind === 'bool') return '<div class="field"><span class="field-label">' + label + '</span>' + yesNo(id, 'data-col="' + escapeHtml(item.col) + '" data-kind="bool"') + '</div>';
    if (kind === 'rate') return field(wrap('pct-wrap', box('pct', 'decimal')));
    // (can be negative, so a full keyboard for the minus sign)
    if (kind === 'signedRate') return field(wrap('pct-wrap', box('pct', 'text')));
    if (kind === 'ratio') return field(wrap('lp-ratio', box('', 'decimal').replace('autocomplete="off"', 'autocomplete="off" maxlength="6"') + '<span>to 1</span>'));
    if (kind === 'money') return field(wrap('money-wrap', box('money', 'numeric')));
    if (kind === 'cents') return field(wrap('money-wrap', box('money', 'decimal')));
    if (kind === 'int') return field(box('digits', 'numeric'));
    if (kind === 'score') return field(box('digits', 'numeric').replace('autocomplete="off"', 'autocomplete="off" maxlength="3" placeholder="300-850"'));
    return field(box('', 'text'), true);
}

let built = null;

/**
 * Opens the loan product pop-up. fields: [{ section, col, kind }] from the API.
 * product: { row, values } to edit one, or null for a new one.
 * submit(values, row) must resolve once it's saved (or throw an Error whose message is the API's error code).
 */
export function openLoanProductForm({ fields, product, submit }) {
    if (!built) built = build();
    built.open({ fields, product, submit });
}

function build() {
    ensureDialogStyles();
    if (!document.getElementById('loan-products-css')) {
        const style = document.createElement('style');
        style.id = 'loan-products-css';
        style.textContent = CSS;
        document.head.append(style);
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'income-dialog loan-dialog';
    dialog.setAttribute('aria-labelledby', 'loan-dialog-title');
    dialog.innerHTML = '<form class="income-form" novalidate>'
        + '<div class="dialog-head"><h2 id="loan-dialog-title">Loan Product</h2><button type="button" class="close-btn" data-close aria-label="Close">' + CLOSE_ICON + '</button></div>'
        + '<p class="muted">Percentages are entered as percents (2.75 for 2.75%).</p>'
        + '<div class="dialog-scroll" data-sections></div>'
        + '<div class="dialog-foot"><p class="form-message" role="alert"></p>'
            + '<div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>'
            + '<button type="submit" class="btn" data-save><span class="btn-spinner" aria-hidden="true"></span><span data-save-text>Save</span></button></div></div>'
        + '</form>';
    document.body.append(dialog);

    const $ = sel => dialog.querySelector(sel);
    const form = $('form');
    const message = $('.form-message');
    const saveBtn = $('[data-save]');
    const sectionsEl = $('[data-sections]');
    let ctx = null;
    let saving = false;
    let drawnFor = '';
    let layout = [];
    let kinds = {};
    let gateOfCol = {};   // a yes/no that's itself a column: its gate key, by column

    // LAYOUT, minus columns the API doesn't know, plus an "Other" section for columns LAYOUT doesn't mention
    function layoutFor(fields) {
        kinds = {};
        gateOfCol = {};
        fields.forEach(f => { kinds[f.col] = f.kind; });
        const used = {};
        const keep = items => items.map(it => {
            if (it.tiles) { const tiles = it.tiles.filter(t => kinds[t.col]); tiles.forEach(t => { used[t.col] = true; }); return tiles.length ? { tiles } : null; }
            if (it.fees) {
                const standard = it.fees.standard.filter(c => kinds[c]);
                standard.forEach(c => { used[c] = true; });
                used[it.fees.col] = true;
                return standard.length || kinds[it.fees.col] ? { fees: { standard, col: kinds[it.fees.col] ? it.fees.col : null } } : null;
            }
            if (it.quotes) { used[it.quotes] = true; return kinds[it.quotes] ? it : null; }
            if (it.buydown) { used[it.buydown] = true; return kinds[it.buydown] ? it : null; }
            if (it.tiers) { used[it.tiers] = true; return kinds[it.tiers] ? it : null; }
            if (it.mi) { used[it.mi.quotes] = true; used[it.mi.none] = true; return kinds[it.mi.quotes] ? it : null; }
            if (it.groups) { used[it.groups] = true; return kinds[it.groups] ? it : null; }
            if (it.quals) { used[it.quals] = true; return kinds[it.quals] ? it : null; }
            if (it.cond) { const items = keep(it.items); return items.length ? { ...it, items } : null; }
            if (it.gate) { if (it.col) { used[it.col] = true; gateOfCol[it.col] = it.gate; } return { ...it, items: keep(it.items) }; }
            used[it.col] = true;
            return kinds[it.col] ? it : null;
        }).filter(Boolean);
        const out = LAYOUT.map(s => ({ section: s.section, scope: s.scope === undefined ? 'regular' : s.scope, items: keep(s.items) })).filter(s => s.items.length);
        const extra = fields.filter(f => !used[f.col]).map(f => ({ col: f.col, optional: f.section === 'Other' && f.kind === 'text' }));
        if (extra.length) out.push({ section: 'Other', scope: 'regular', items: extra });
        return out;
    }

    function itemsHtml(items, section, counter) {
        return items.map(it => {
            const n = counter.n++;
            if (it.fixed) return '';
            if (it.quotes) return quotesHtml();
            if (it.buydown) return buydownHtml();
            if (it.mi) return miHtml();
            if (it.cond) {
                const inner = '<div class="lp-cond" data-cond="' + it.cond + '" hidden>' + itemsHtml(it.items, section, counter) + '</div>';
                return it.scope ? '<div class="lp-scope" data-scope="' + it.scope + '">' + inner + '</div>' : inner;
            }
            if (it.groups) {
                return '<div class="field"><span class="field-label">' + escapeHtml(it.label) + '</span>'
                    + multiHtml('data-groups="' + escapeHtml(it.groups) + '"', PROFESSION_GROUPS, 'Choose professions or groups...') + '</div>';
            }
            if (it.quals) {
                return '<p class="lp-fees-help">Add each qualification a buyer must meet (each kind once). Buyer Breakdown pages show a disclaimer when one isn’t met.</p>'
                    + '<div class="lp-quals" data-quals><div class="lp-qual-list" data-qual-list></div>'
                    + '<button type="button" class="lp-add-fee" data-add-qual>+ Add Qualification</button></div>';
            }
            if (it.tiers) {
                return '<p class="lp-fees-help">List each credit score where the max DTI changes. Each max applies from its credit score up to the next one listed; the lowest also covers any score below it. Credit scores go from '
                    + CREDIT_MIN + ' to ' + CREDIT_MAX + '.</p>'
                    + '<div class="lp-fees lp-tiers" data-tiers><div class="lp-fee-row lp-tier-row is-head"><span>Credit Score</span><span>Max DTI</span><span data-tier-housing>Housing-Only Max DTI</span><span></span></div>'
                    + '<div class="lp-tier-list" data-tier-list></div>'
                    + '<button type="button" class="lp-add-fee" data-add-tier>+ Add Credit Score</button>'
                    + '<p class="lp-tier-sum" data-tier-sum></p></div>';
            }
            if (it.fees) {
                return '<p class="lp-fees-help">Every product has the standard fees (0 if the lender doesn’t charge one). Add any other fee the lender charges. The buyer pays them at closing.</p>'
                    + '<div class="lp-fees"><div class="lp-fee-row is-head"><span>Fee</span><span>Amount</span><span></span></div>'
                    + it.fees.standard.map((c, i) => '<div class="lp-fee-row is-std field"><label class="lp-fee-name" for="lp-' + n + '-' + i + '">' + escapeHtml(labelFor(c, section)) + '</label>'
                        + '<div class="money-wrap"><input id="lp-' + n + '-' + i + '" class="money" data-col="' + escapeHtml(c) + '" data-kind="cents" type="text" inputmode="decimal" autocomplete="off"></div><span></span></div>').join('')
                    + (it.fees.col ? '<p class="lp-fees-sub">Other fees</p><div class="lp-fees-extra" data-fee-list></div>'
                        + '<button type="button" class="lp-add-fee" data-add-fee>+ Add Fee</button>' : '')
                    + '</div>';
            }
            if (it.tiles) {
                return '<p class="lp-tiles-help">Select all that are allowed.</p><div class="lp-tiles">' + it.tiles.map(t => '<div class="lp-tile">'
                    + '<input type="checkbox" id="lp-' + n + '-' + escapeHtml(t.col) + '" data-col="' + escapeHtml(t.col) + '" data-kind="tile">'
                    + '<label for="lp-' + n + '-' + escapeHtml(t.col) + '"><span class="lp-tile-icon">' + t.icon + '</span>' + escapeHtml(t.label) + '</label></div>').join('') + '</div>';
            }
            if (it.gate) {
                return '<div class="field span-2"><span class="field-label">' + escapeHtml(it.label) + '</span>' + yesNo('lp-gate-' + it.gate, 'data-gate="' + it.gate + '"') + '</div>'
                    + (it.items.length ? '<div class="gate-body" data-gate-body="' + it.gate + '"' + (it.invert ? ' data-gate-invert' : '') + ' hidden>' + itemsHtml(it.items, section, counter) + '</div>' : '');
            }
            const q = question(it, kinds[it.col], section, n);
            return it.scope ? '<div class="lp-scope" data-scope="' + it.scope + '">' + q + '</div>' : q;
        }).join('');
    }

    // One fieldset per section, drawn again only when the list of questions changes
    function draw(fields) {
        const key = fields.map(f => f.section + '|' + f.col + '|' + f.kind).join('\n');
        if (key === drawnFor) return;
        drawnFor = key;
        layout = layoutFor(fields);
        const counter = { n: 0 };
        sectionsEl.innerHTML = layout.map(s => '<fieldset class="income-section"' + (s.scope ? ' data-scope="' + s.scope + '"' : '') + '><div class="section-head"><h3>' + escapeHtml(s.section) + '</h3></div>'
            + '<div class="type-fields">' + itemsHtml(s.items, s.section, counter) + '</div></fieldset>').join('');
        sectionsEl.querySelectorAll('input[data-kind]').forEach(el => el.addEventListener('input', () => {
            const kind = el.dataset.kind;
            if (kind === 'int' || kind === 'score') el.value = el.value.replace(/\D/g, '');
            else if (kind === 'money') el.value = withCommas(el.value.replace(/\D/g, ''));
            else if (kind === 'cents') el.value = withCommas(decimalOnly(el.value, 2));
            else if (kind === 'rate') el.value = decimalOnly(el.value, 4);
            else if (kind === 'signedRate') el.value = signedDecimal(el.value, 4);
            else if (kind === 'ratio') el.value = decimalOnly(el.value, 2);
            if (el.closest('.lp-stepper')) syncStepper(el);
        }));
        sectionsEl.querySelectorAll('[data-gate] input').forEach(r => r.addEventListener('change', showGates));
        const term = sectionsEl.querySelector('[data-term]');
        if (term) term.addEventListener('change', showTerm);
        const type = sectionsEl.querySelector('[data-col="PRODUCT TYPE"]');
        if (type) type.addEventListener('change', showScopes);
        sectionsEl.querySelectorAll('.lp-step').forEach(b => b.addEventListener('click', () => {
            const input = b.parentElement.querySelector('input');
            input.value = String(Math.max(0, Math.min(99, num(input.value) + Number(b.dataset.step))));
            input.classList.remove('is-invalid');
            syncStepper(input);
        }));
        sectionsEl.querySelectorAll('select').forEach(makePicker);
    }

    // A select → a styled picker: a button showing the choice, and a list floating under it (scrolled into view when
    // opened) of each choice with its icon and description. The select keeps the answer and gets a change event.
    function makePicker(select) {
        select.classList.add('lp-native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        const picker = document.createElement('div');
        picker.className = 'lp-picker';
        const btnId = select.id + '-btn';
        const label = sectionsEl.querySelector('label[for="' + select.id + '"]');
        if (label) label.htmlFor = btnId;
        const options = [...select.options].filter(o => o.value);
        picker.innerHTML = '<button type="button" class="lp-picker-btn" id="' + btnId + '" aria-haspopup="listbox" aria-expanded="false"></button>'
            + '<div class="lp-picker-list" role="listbox">' + options.map(o => {
                const info = CHOICES[o.value] || {};
                return '<button type="button" class="lp-option" role="option" data-value="' + escapeHtml(o.value) + '"><span class="lp-pick-icon">' + (info.icon || EMPTY_ICON) + '</span>'
                    + '<span class="lp-option-text"><span class="lp-option-main">' + escapeHtml(info.main || o.text) + '</span>'
                    + (info.sub ? '<span class="lp-option-sub">' + escapeHtml(info.sub) + '</span>' : '') + '</span>' + CHECK_ICON + '</button>';
            }).join('') + '</div>';
        select.after(picker);
        const btn = picker.querySelector('.lp-picker-btn');
        const open = on => {
            if (on) sectionsEl.querySelectorAll('.lp-picker.is-open').forEach(p => { if (p !== picker) p.classList.remove('is-open'); });
            picker.classList.toggle('is-open', on);
            btn.setAttribute('aria-expanded', String(on));
            if (on) { const list = picker.querySelector('.lp-picker-list'); list.scrollIntoView({ block: 'nearest' }); (list.querySelector('.is-picked') || list.querySelector('.lp-option')).focus({ preventScroll: true }); }
        };
        btn.addEventListener('click', () => open(!picker.classList.contains('is-open')));
        picker.querySelectorAll('.lp-option').forEach(o => o.addEventListener('click', () => {
            select.value = o.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncPicker(select);
            open(false);
            btn.focus({ preventScroll: true });
        }));
        picker.addEventListener('keydown', e => {
            if (e.key === 'Escape' && picker.classList.contains('is-open')) { e.preventDefault(); e.stopPropagation(); open(false); btn.focus(); }
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && picker.classList.contains('is-open')) {
                e.preventDefault();
                const all = [...picker.querySelectorAll('.lp-option')];
                const i = all.indexOf(document.activeElement);
                all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
            }
        });
        syncPicker(select);
    }
    // Shows the select's choice on its picker button
    function syncPicker(select) {
        const picker = select.nextElementSibling;
        if (!picker || !picker.classList.contains('lp-picker')) return;
        const info = CHOICES[select.value] || {};
        const opt = [...select.options].find(o => o.value && o.value === select.value);
        const btn = picker.querySelector('.lp-picker-btn');
        btn.classList.toggle('is-empty', !opt);
        btn.innerHTML = '<span class="lp-pick-icon">' + (opt ? info.icon || EMPTY_ICON : EMPTY_ICON) + '</span><span class="lp-pick-text">' + escapeHtml(opt ? info.main || opt.text : 'Choose...') + '</span>';
        picker.querySelectorAll('.lp-option').forEach(o => { const on = o.dataset.value === select.value; o.classList.toggle('is-picked', on); o.setAttribute('aria-selected', String(on)); });
    }
    // An added lender fee: its name, its amount and a remove button
    const feeRow = (f = {}) => '<div class="lp-fee-row is-extra field"><input type="text" data-fee-k="name" maxlength="100" autocomplete="off" aria-label="Fee name" placeholder="Fee name" value="' + escapeHtml(f.name || '') + '">'
        + '<div class="money-wrap"><input class="money" data-fee-k="amount" type="text" inputmode="decimal" autocomplete="off" aria-label="Amount" value="' + escapeHtml(f.amount === undefined || f.amount === null || f.amount === '' ? '' : shown('cents', f.amount)) + '"></div>'
        + '<button type="button" class="lp-fee-remove" data-remove-fee aria-label="Remove fee"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
    // Max DTI: one row per credit score (its score, max DTI and housing-only max DTI)
    const tierRow = (t = {}) => '<div class="lp-fee-row lp-tier-row field">'
        + '<input class="digits" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="300-850" data-tier-k="score" aria-label="Credit score" value="' + (t.score ? escapeHtml(String(t.score)) : '') + '">'
        + '<div class="pct-wrap"><input class="pct" type="text" inputmode="decimal" autocomplete="off" data-tier-k="dti" aria-label="Max DTI" value="' + (t.dti ? escapeHtml(shown('rate', t.dti)) : '') + '"></div>'
        + '<div class="pct-wrap" data-tier-housing><input class="pct" type="text" inputmode="decimal" autocomplete="off" data-tier-k="housing" aria-label="Housing-only max DTI" value="' + (t.housing ? escapeHtml(shown('rate', t.housing)) : '') + '"></div>'
        + '<button type="button" class="lp-fee-remove" data-remove-tier aria-label="Remove this credit score"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
    const tierRows = () => [...sectionsEl.querySelectorAll('[data-tier-list] .lp-tier-row')];
    // The minimum credit score as answered (null: none, or not a valid score yet)
    function currentMinScore() {
        if (gateAnswer('minscore') !== true) return null;
        const el = sectionsEl.querySelector('[data-col="MIN CREDIT SCORE"]');
        return el && scoreOk(el.value) ? minCreditScore(el.value) : null;
    }
    // The housing-only column (when there's a separate one) and the tiers as score ranges, e.g. "620–679: 43% · 680 and up: 45%"
    function syncTiers() {
        const box = sectionsEl.querySelector('[data-tiers]');
        if (!box) return;
        const housingOn = gateAnswer('housing') === true;
        box.classList.toggle('has-housing', housingOn);
        const tiers = tierRows().map(row => {
            const v = k => row.querySelector('[data-tier-k="' + k + '"]').value.trim();
            return { score: v('score'), dti: v('dti'), housing: v('housing') };
        }).filter(t => scoreOk(t.score) && t.dti !== '').map(t => ({ ...t, score: +t.score })).sort((a, b) => a.score - b.score)
            .filter((t, i, list) => !i || t.score !== list[i - 1].score);
        const min = currentMinScore();
        const parts = [];
        tiers.forEach((t, i) => {
            const lo = Math.max(i ? t.score : CREDIT_MIN, min || CREDIT_MIN), hi = i < tiers.length - 1 ? tiers[i + 1].score - 1 : CREDIT_MAX;
            if (lo > hi) return;
            const range = lo === CREDIT_MIN && hi === CREDIT_MAX ? 'Every credit score' : lo === CREDIT_MIN ? 'Up to ' + hi : hi === CREDIT_MAX ? lo + ' and up' : lo + '–' + hi;
            parts.push(range + ': <b>' + Number(t.dti) + '%</b>' + (housingOn && t.housing !== '' ? ' (housing only ' + Number(t.housing) + '%)' : ''));
        });
        box.querySelector('[data-tier-sum]').innerHTML = parts.join(' · ') + (parts.length ? '.' : '') + (min !== null ? (parts.length ? ' ' : '') + 'Below ' + min + ': <b>denied</b>.' : '');
    }
    sectionsEl.addEventListener('change', e => {
        showConds();
        if (e.target.closest('.lp-multi')) syncMulti(e.target.closest('.lp-multi'));
        if (e.target.matches('[data-qual-type]')) { renderQualValue(e.target.closest('[data-qual-row]')); syncQuals(); }
        if (e.target.closest('[data-gate="minscore"], [data-gate="housing"]')) { syncTiers(); showRateMarkups(); showMiOut(); }
        if (e.target.matches('[data-mi-none]')) showMi();
        // (the upfront premium follows the loan term)
        if (e.target.closest('[data-term], [data-term-other]')) showMiOut();
    });
    sectionsEl.addEventListener('click', e => {
        // A dropdown of checkboxes: its button opens and closes it
        const multiBtn = e.target.closest('.lp-multi > .lp-picker-btn');
        if (multiBtn) {
            const picker = multiBtn.parentElement;
            const on = !picker.classList.contains('is-open');
            sectionsEl.querySelectorAll('.lp-picker.is-open').forEach(p => { if (p !== picker) p.classList.remove('is-open'); });
            picker.classList.toggle('is-open', on);
            multiBtn.setAttribute('aria-expanded', String(on));
            if (on) picker.querySelector('.lp-picker-list').scrollIntoView({ block: 'nearest' });
            return;
        }
        if (e.target.closest('[data-add-qual]')) {
            const row = addQualRow();
            e.target.closest('[data-add-qual]').classList.remove('is-invalid');
            row.querySelector('.lp-picker-btn').focus();
            return;
        }
        const removeQual = e.target.closest('[data-remove-qual]');
        if (removeQual) { removeQual.closest('[data-qual-row]').remove(); syncQuals(); return; }
        if (e.target.closest('[data-add-tier]')) {
            const list = sectionsEl.querySelector('[data-tier-list]');
            list.insertAdjacentHTML('beforeend', tierRow());
            list.lastElementChild.querySelector('input').focus();
            e.target.closest('[data-add-tier]').classList.remove('is-invalid');
            return;
        }
        const removeTier = e.target.closest('[data-remove-tier]');
        if (removeTier) { removeTier.closest('.lp-tier-row').remove(); syncTiers(); return; }
        if (e.target.closest('[data-submit-quotes]')) { submitSheet(); return; }
        // Requote: every box blank, to fill in from scratch
        if (e.target.closest('[data-requote]')) {
            requoting = true;
            sheetMode = 'open';
            putSheet(null, null);
            showSheet();
            const first = quoteBoxes()[0];
            first.closest('.lp-quotes').previousElementSibling.scrollIntoView({ block: 'start' });
            first.focus({ preventScroll: true });
            return;
        }
        if (e.target.closest('[data-cancel-requote]')) {
            requoting = false;
            sheetMode = 'locked';
            putSheet(locked.quotes, locked.buys);
            showSheet();
            sectionsEl.querySelector('[data-sheet-status]').scrollIntoView({ block: 'nearest' });
            return;
        }
        if (e.target.closest('[data-add-fee]')) {
            const list = sectionsEl.querySelector('[data-fee-list]');
            list.insertAdjacentHTML('beforeend', feeRow());
            list.lastElementChild.querySelector('input').focus();
            return;
        }
        const remove = e.target.closest('[data-remove-fee]');
        if (remove) remove.closest('.lp-fee-row').remove();
    });
    sectionsEl.addEventListener('input', e => {
        if (e.target.matches('[data-quote], [data-buy]')) {
            e.target.value = decimalOnly(e.target.value, 4);
            e.target.classList.remove('is-invalid');
            const msg = sectionsEl.querySelector('[data-sheet-msg]');
            if (msg) msg.textContent = '';
            if (e.target.matches('[data-quote]')) showMarkups(); else showBuydown();
        }
        if (e.target.matches('[data-fee-k="amount"]')) e.target.value = withCommas(decimalOnly(e.target.value, 2));
        if (e.target.matches('[data-fee-k]')) e.target.classList.remove('is-invalid');
        if (e.target.matches('[data-tier-k]')) {
            e.target.value = e.target.dataset.tierK === 'score' ? e.target.value.replace(/\D/g, '') : decimalOnly(e.target.value, 4);
            e.target.classList.remove('is-invalid');
            syncTiers();
        }
        if (e.target.matches('[data-col="MIN CREDIT SCORE"]')) { syncTiers(); showRateMarkups(); showMiOut(); }
        if (e.target.matches('[data-qual-k="money"]')) e.target.value = withCommas(e.target.value.replace(/\D/g, ''));
        if (e.target.matches('[data-qual-k="score"], [data-qual-k="years"]')) e.target.value = e.target.value.replace(/\D/g, '');
        if (e.target.matches('[data-qual-k]')) e.target.classList.remove('is-invalid');
        if (e.target.matches('[data-miq]')) {
            e.target.value = decimalOnly(e.target.value, 4);
            e.target.classList.remove('is-invalid');
            showMiOut();
        }
    });
    // Closes an open picker when something else is clicked
    dialog.addEventListener('click', e => {
        if (!e.target.closest('.lp-picker')) sectionsEl.querySelectorAll('.lp-picker.is-open').forEach(p => { p.classList.remove('is-open'); p.querySelector('.lp-picker-btn').setAttribute('aria-expanded', 'false'); });
    });

    // Rates: the 27 quote boxes, one table per credit score (debt-to-income down the side, loan-to-value across)
    const pctText = v => String(Math.round(v * 100)) + '%';
    const quoteLabel = (c, d, l) => QUOTE_CREDIT[c] + ' credit score, ' + pctText(QUOTE_DTI[d]) + ' DTI, ' + pctText(QUOTE_LTV[l]) + ' LTV';
    function quotesHtml() {
        return '<div class="lp-sheet-status" data-sheet-status hidden><p data-sheet-text></p><button type="button" class="btn btn-secondary" data-requote>Requote</button></div>'
            + '<p class="lp-fees-help lp-quote-help" data-quote-entry>Quote the interest rate (no points bought) for each scenario. Today’s interest rate is <strong data-today>not set</strong>; each quote’s markup is how far it is above (or below) it.</p>'
            + '<div class="field lp-quotes" data-quote-entry>' + QUOTE_CREDIT.map((c, ci) => '<div class="lp-quote-block"><p class="lp-quote-title">' + c + ' Credit Score</p>'
                + '<table class="lp-quote-grid"><thead><tr><th scope="col"><span class="lp-sr">DTI</span></th>'
                + QUOTE_LTV.map(l => '<th scope="col">' + pctText(l) + ' LTV</th>').join('') + '</tr></thead><tbody>'
                + QUOTE_DTI.map((d, di) => '<tr><th scope="row">' + pctText(d) + ' DTI</th>' + QUOTE_LTV.map((l, li) => '<td><div class="pct-wrap"><input class="pct" type="text" inputmode="decimal" autocomplete="off" data-quote="'
                    + quoteIndex(ci, di, li) + '" aria-label="' + escapeHtml(quoteLabel(ci, di, li)) + '"></div></td>').join('') + '</tr>').join('')
                + '</tbody></table></div>').join('') + '</div>'
            + '<div class="lp-markups" data-markups></div>';
    }
    // Rate buydown: the 4 quotes with points bought, for one scenario
    const pointsText = v => String(Number((v * 100).toFixed(2))) + '%';
    const scenarioText = BUYDOWN_SCENARIO.credit + ' credit score, ' + pctText(BUYDOWN_SCENARIO.dti) + ' DTI and ' + pctText(BUYDOWN_SCENARIO.ltv) + ' LTV';
    const buyLabel = i => scenarioText + ', ' + pointsText(BUYDOWN_POINTS[i]) + ' in points';
    function buydownHtml() {
        return '<p class="lp-fees-help lp-quote-help" data-quote-entry>Rate buydown: quote the interest rate for a ' + scenarioText + ' with each amount of points bought (a percent of the loan). '
            + 'With no points, that rate comes from the quotes above (<strong data-buy-base>…</strong>); each quote’s buydown is how far below it is.</p>'
            + '<div class="field lp-quotes" data-quote-entry><div class="lp-quote-block"><p class="lp-quote-title">Points Purchased</p>'
            + '<table class="lp-quote-grid"><thead><tr>' + BUYDOWN_POINTS.map(p => '<th scope="col">' + pointsText(p) + '</th>').join('') + '</tr></thead><tbody><tr>'
            + BUYDOWN_POINTS.map((p, i) => '<td><div class="pct-wrap"><input class="pct" type="text" inputmode="decimal" autocomplete="off" data-buy="' + i
                + '" aria-label="' + escapeHtml(buyLabel(i)) + '"></div></td>').join('')
            + '</tr></tbody></table></div></div>'
            + '<div class="lp-markups" data-buydown></div>'
            + '<div class="lp-sheet-actions" data-sheet-actions><p class="lp-sheet-note" data-sheet-note></p><p class="lp-sheet-msg" role="alert" data-sheet-msg></p>'
            + '<div class="lp-sheet-buttons"><button type="button" class="btn" data-submit-quotes><span class="btn-spinner" aria-hidden="true"></span>Submit Quotes</button>'
            + '<button type="button" class="btn btn-secondary" data-cancel-requote hidden>Keep Current Quotes</button></div></div>';
    }
    const buyBoxes = () => [...sectionsEl.querySelectorAll('[data-buy]')].sort((a, b) => a.dataset.buy - b.dataset.buy);
    // The 4 buydown quotes as decimals, or null while any is blank or not over 0
    function buyNow() {
        const boxes = buyBoxes();
        if (boxes.length !== BUYDOWN_POINTS.length || boxes.some(b => b.value.trim() === '')) return null;
        const list = boxes.map(b => Number(b.value.trim()) / 100);
        return list.every(q => isFinite(q) && q > 0) ? list : null;
    }

    // The quote sheet: 'open' while it's being filled in, 'locked' once submitted. locked: the submitted sheet ({ quotes,
    // buys, today, date, pending }; pending: a new product's, saved when the product is added). requoting: a new sheet is
    // being filled in over a submitted one (which stays until the new one is submitted).
    let sheetMode = 'open', locked = null, requoting = false;
    const quoteBoxes = () => [...sectionsEl.querySelectorAll('[data-quote]')].sort((a, b) => a.dataset.quote - b.dataset.quote);
    const quotesField = () => (ctx && ctx.fields || []).find(f => f.col === 'RATE QUOTES');
    const fieldToday = () => { const f = quotesField(); return f && Number(f.today) > 0 ? Number(f.today) : null; };
    // The 27 quotes as decimals, or null while any is blank or not over 0
    function quotesNow() {
        const boxes = quoteBoxes();
        if (boxes.length !== 27 || boxes.some(b => b.value.trim() === '')) return null;
        const list = boxes.map(b => Number(b.value.trim()) / 100);
        return list.every(q => isFinite(q) && q > 0) ? list : null;
    }
    // Today's rate the markups are measured from: a submitted sheet's (today's rate the day it was submitted), else today's
    // (a sheet is stamped with today's rate when it's submitted)
    function todayFor() {
        return sheetMode === 'locked' && locked && !locked.pending && locked.today ? { rate: locked.today, saved: true } : { rate: fieldToday(), saved: false };
    }
    // Puts a sheet's rates in the boxes (null: blank)
    function putSheet(quotes, buys) {
        quoteBoxes().forEach((b, i) => { b.value = quotes ? shown('rate', quotes[i]) : ''; b.classList.remove('is-invalid'); });
        buyBoxes().forEach((b, i) => { b.value = buys ? shown('rate', buys[i]) : ''; b.classList.remove('is-invalid'); });
    }
    const dateText = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
    // Open: the boxes, Submit Quotes (and Keep Current Quotes while requoting). Locked: the boxes hidden; when it was
    // submitted, and Requote. The markup and buydown tables show either way.
    function showSheet() {
        const open = sheetMode === 'open';
        sectionsEl.querySelectorAll('[data-quote-entry]').forEach(el => { el.hidden = !open; });
        const status = sectionsEl.querySelector('[data-sheet-status]'), actions = sectionsEl.querySelector('[data-sheet-actions]');
        if (status) {
            status.hidden = open;
            if (!open && locked) status.querySelector('[data-sheet-text]').innerHTML = locked.pending
                ? '<b>Rate quotes ready.</b> They’re saved when you add the loan product, and can’t be edited after that. To change them, requote all of them.'
                : '<b>Rate quotes submitted' + (locked.date ? ' on ' + dateText(locked.date) : '') + '</b>' + (locked.today ? ' (today’s interest rate was ' + rateText(locked.today) + ')' : '')
                    + '. They can’t be edited. To change them, requote: enter all 27 rates and the 4 buydown rates again.';
        }
        if (actions) {
            actions.hidden = !open;
            actions.querySelector('[data-cancel-requote]').hidden = !requoting;
            actions.querySelector('[data-sheet-note]').textContent = requoting
                ? 'Your current quotes stay in place until you submit these. Submitting replaces them.'
                : 'Once submitted, the quotes can’t be edited, only requoted from scratch.';
            actions.querySelector('[data-sheet-msg]').textContent = '';
        }
        showMarkups();
    }
    // Submit Quotes: checks every box, then saves the sheet right away (a saved product) or holds it for the product's save
    // (a new one), and locks it
    async function submitSheet() {
        const msg = sectionsEl.querySelector('[data-sheet-msg]');
        const fail = (el, text) => {
            if (el) { el.classList.add('is-invalid'); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center' }); }
            msg.textContent = text;
        };
        msg.textContent = '';
        message.textContent = '';
        const boxes = [...quoteBoxes(), ...buyBoxes()];
        const blank = boxes.find(b => b.value.trim() === '');
        if (blank) return fail(blank, 'Please quote a rate for ' + (blank.matches('[data-buy]') ? 'each amount of points' : 'every scenario') + ' (' + blank.getAttribute('aria-label') + ').');
        const bad = boxes.find(b => !(Number(b.value) > 0 && Number(b.value) <= 100));
        if (bad) return fail(bad, 'Each quoted rate must be more than 0 and no more than 100 (' + bad.getAttribute('aria-label') + ').');
        // More points can't make the rate higher
        const buys = buyBoxes();
        const rising = buys.findIndex((el, i) => i > 0 && Number(el.value) > Number(buys[i - 1].value));
        if (rising > 0) return fail(buys[rising], 'More points should lower the rate (or keep it the same), so the ' + pointsText(BUYDOWN_POINTS[rising])
            + ' quote can’t be higher than the ' + pointsText(BUYDOWN_POINTS[rising - 1]) + ' quote.');
        const today = fieldToday();
        if (!today) return fail(null, ERRORS.no_today_rate);
        const dec = el => Number((Number(el.value.trim()) / 100).toPrecision(10));
        const sheet = { quotes: quoteBoxes().map(dec), buys: buys.map(dec), today, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }), pending: !ctx.product };
        if (ctx.product) {
            const values = { 'RATE QUOTES': JSON.stringify({ QUOTES: sheet.quotes }), 'BUYDOWN QUOTES': JSON.stringify({ QUOTES: sheet.buys }) };
            const btn = sectionsEl.querySelector('[data-submit-quotes]');
            saving = true;
            btn.disabled = true;
            btn.classList.add('is-loading');
            saveBtn.disabled = true;
            try {
                await ctx.submit(values, ctx.product.row, { quotesOnly: true });
            } catch (err) {
                console.error(err);
                return fail(null, ERRORS[err.message] || 'We couldn’t submit the quotes. Please try again.');
            } finally {
                saving = false;
                btn.disabled = false;
                btn.classList.remove('is-loading');
                saveBtn.disabled = false;
            }
            ctx.product.values['RATE QUOTES'] = JSON.stringify({ QUOTES: sheet.quotes, TODAY: today, DATE: sheet.date });
            ctx.product.values['BUYDOWN QUOTES'] = values['BUYDOWN QUOTES'];
        }
        locked = sheet;
        requoting = false;
        sheetMode = 'locked';
        showSheet();
        sectionsEl.querySelector('[data-sheet-status]').scrollIntoView({ block: 'nearest' });
    }
    const markText = v => { const r = Math.round(v * 1e5) / 1e3; return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(3) + '%'; };
    const rateText = v => String(Number((v * 100).toFixed(4))) + '%';
    // Each markup (or the buydown): its chart beside its table
    const metricTable = mt => '<div class="lp-mt-scroll"><table><thead><tr><th scope="col">' + mt.head + '</th><th scope="col">' + (mt.valueHead || 'Markup') + '</th></tr></thead><tbody>'
        + mt.rows.map(r => '<tr class="is-' + r.place + '" data-v="' + r.value + '"><td>' + mt.label(r.value) + '</td><td>' + (r.place === 'denied' ? 'Denied' : (mt.fmt || markText)(r.markup)) + '</td></tr>').join('') + '</tbody></table></div>';
    const metricCard = mt => '<div class="lp-markup-table" data-metric="' + mt.key + '"><h4>' + mt.title + '</h4><div class="lp-metric-body">' + markupChart(mt) + metricTable(mt) + '</div></div>';
    function showMarkups() { showRateMarkups(); showBuydown(); }
    // The starting markup and the three markup tables (credit score 850 to 300, DTI 5% to 70%, LTV 5% to 100%)
    function showRateMarkups() {
        const el = sectionsEl.querySelector('[data-markups]');
        if (!el) return;
        const quotes = quotesNow();
        const today = todayFor(quotes);
        const todayBox = sectionsEl.querySelector('[data-today]');
        if (todayBox) todayBox.textContent = today.rate ? rateText(today.rate) + (today.saved ? ' (when these were quoted)' : '') : 'not set';
        if (!quotes) { el.innerHTML = '<p class="lp-markups-empty">Fill in all 27 quotes to see the rate markups.</p>'; return; }
        if (!today.rate) { el.innerHTML = '<p class="lp-markups-empty">Today’s interest rate isn’t set, so the markups can’t be worked out yet.</p>'; return; }
        const m = markupModel(quotes, today.rate);
        // Below the minimum credit score (Max DTI) an applicant is denied: no markup there, and the curve stops at it
        const minScore = currentMinScore();
        const creditRows = minScore === null ? m.tables.credit : m.tables.credit.map(r => (r.value < minScore ? { ...r, place: 'denied' } : r));
        const metrics = [
            { key: 'credit', title: 'Credit Score', head: 'Score', rows: creditRows, fn: m.credit, quoted: QUOTE_CREDIT, cutoff: minScore, label: v => String(v), tip: v => v + ' credit score', ticks: [300, 400, 500, 600, 700, 800], tick: v => String(v) },
            { key: 'dti', title: 'Debt-to-Income', head: 'DTI', rows: m.tables.dti, fn: m.dti, quoted: QUOTE_DTI, label: pctText, tip: v => pctText(v) + ' DTI', ticks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], tick: pctText },
            { key: 'ltv', title: 'Loan-to-Value', head: 'LTV', rows: m.tables.ltv, fn: m.ltv, quoted: QUOTE_LTV, label: pctText, tip: v => pctText(v) + ' LTV', ticks: [0.2, 0.4, 0.6, 0.8, 1], tick: pctText },
        ];
        el.innerHTML = '<p class="lp-markups-head">Rate Markups</p>'
            + '<p class="lp-markup-sum">Starting markup (800 credit score, 20% DTI, 50% LTV): <b>' + markText(m.start) + '</b>. A buyer’s rate is today’s interest rate + the starting markup + the three markups below'
            + (m.worstMiss >= 0.00005 ? '; that comes within <b>' + (Math.round(m.worstMiss * 1e5) / 1e3).toFixed(3) + '%</b> of every quote.' : ', matching every quote.') + '</p>'
            + '<div class="lp-metrics">' + metrics.map(metricCard).join('') + '</div>'
            + '<p class="lp-markup-key"><span class="lp-key-band"></span>Shaded: the quoted range, where the curve passes through the quoted levels (the dots and <b>bold</b> rows). '
            + '<span class="lp-key-line is-dashed"></span>Dashed and <i>italic</i>: estimated past the quotes. The curve flattens out on one side and keeps bending on the other.'
            + (minScore !== null ? ' <span class="lp-key-denied"></span>Hatched: below the ' + minScore + ' minimum credit score (Max DTI), where an applicant is denied.' : '') + '</p>';
        metrics.forEach(mt => wireChart(el.querySelector('[data-metric="' + mt.key + '"]'), mt));
    }
    // The buydown scenario's no-points rate, and the buydown table (no points to 5% by 0.25%) with its chart
    function showBuydown() {
        const el = sectionsEl.querySelector('[data-buydown]');
        if (!el) return;
        const quotes = quotesNow();
        const baseBox = sectionsEl.querySelector('[data-buy-base]');
        if (baseBox) baseBox.textContent = quotes ? (buydownBase(quotes) * 100).toFixed(3) + '%' : 'once all 27 are in';
        const buys = buyNow();
        if (!quotes || !buys) { el.innerHTML = '<p class="lp-markups-empty">Fill in all 27 quotes above and the 4 buydown quotes to see the buydown.</p>'; return; }
        const b = buydownModel(quotes, buys);
        const mt = { key: 'buydown', title: 'Rate Buydown', head: 'Points', valueHead: 'Rate Change', rows: b.table, fn: b.rateChange, quoted: BUYDOWN_POINTS,
            band: [0, BUYDOWN_POINTS[BUYDOWN_POINTS.length - 1]], label: pointsText, tip: v => pointsText(v) + ' in points', ticks: [0, 0.01, 0.02, 0.03, 0.04, 0.05], tick: pointsText };
        const top = BUYDOWN_POINTS.length;
        const clampNote = !b.clamped ? '' : ' <b>The ' + (b.clamped === 1 ? pointsText(BUYDOWN_POINTS[0]) + ' quote isn’t' : pointsText(BUYDOWN_POINTS[0]) + ' to ' + pointsText(BUYDOWN_POINTS[b.clamped - 1]) + ' quotes aren’t')
            + ' below the no-points rate</b>, so ' + (b.clamped === 1 ? 'it counts' : 'they count') + ' as no buydown.';
        const past = b.fade <= 0 ? 'no more buydown than at ' + pointsText(BUYDOWN_POINTS[top - 1])
            : b.fade >= 1 - 1e-9 ? 'each further point buys as much as the ' + top + 'th did'
            : 'each further point buys ' + Math.round(b.fade * 100) + '% of what the point before it did (as the ' + top + 'th did of the ' + (top - 1) + 'rd)';
        el.innerHTML = '<p class="lp-markups-head">Rate Buydown</p>'
            + '<p class="lp-markup-sum">With no points, the rate for a ' + scenarioText + ' works out to <b>' + (b.base * 100).toFixed(3) + '%</b>, so ' + pointsText(BUYDOWN_POINTS[top - 1])
            + ' in points buys the rate down <b>' + (b.levels[top] * 100).toFixed(3) + '%</b>. Points lower every buyer’s rate by the rate change below, whatever their credit score, DTI and LTV.' + clampNote + '</p>'
            + '<div class="lp-metrics">' + metricCard(mt) + '</div>'
            + '<p class="lp-markup-key"><span class="lp-key-band"></span>Shaded: no points to ' + pointsText(BUYDOWN_POINTS[top - 1]) + ', where the curve passes through each quote (the dots and <b>bold</b> rows). '
            + '<span class="lp-key-line is-dashed"></span>Dashed and <i>italic</i>: estimated past ' + pointsText(BUYDOWN_POINTS[top - 1]) + ', where ' + past + '.</p>';
        wireChart(el.querySelector('[data-metric="buydown"]'), mt);
    }

    // --- Mortgage insurance ---
    const LOCK_ICON = ICON('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>');
    const feeText = v => String(Number((v * 100).toFixed(3))) + '%';
    const premText = v => (v * 100).toFixed(3) + '%';
    const miQuoteLabel = (c, d, l) => MI_CREDIT[c] + ' credit score, ' + pctText(MI_DTI[d]) + ' DTI, ' + pctText(MI_LTV[l]) + ' LTV';
    function miHtml() {
        const vaChart = (key, title) => '<div class="lp-markup-table"><h4>' + title + '</h4><table><thead><tr><th scope="col">Down Payment</th><th scope="col">Funding Fee</th></tr></thead><tbody>'
            + VA_FUNDING_FEES[key].map((t, i) => '<tr><td>' + VA_DOWN_LABELS[i] + '</td><td>' + feeText(t.fee) + '</td></tr>').join('') + '</tbody></table></div>';
        return '<div class="lp-mi" data-mi>'
            + '<p class="lp-fees-help" data-mi-for="pick">Choose the Product Type (under Product) to see its mortgage insurance.</p>'
            + '<div class="lp-mi-part" data-mi-for="fha" hidden><div class="lp-fixed"><span class="lp-fixed-icon">' + LOCK_ICON + '</span>'
                + '<span class="lp-fixed-text"><span class="lp-fixed-k">Upfront Mortgage Insurance Premium</span><span class="lp-fixed-v">' + feeText(FHA_UFMIP) + '</span></span>'
                + '<span class="lp-fixed-tag">Set by HUD</span></div>'
                + '<p class="lp-fees-help">Every FHA loan has an upfront mortgage insurance premium (UFMIP) of ' + feeText(FHA_UFMIP) + ' of the base loan amount, so it can’t be changed.</p></div>'
            + '<div class="lp-mi-part" data-mi-for="va" hidden><p class="lp-fees-help">VA loans have no mortgage insurance. Instead, there’s the VA funding fee: a percent of the loan set by the VA, by the down payment, so it can’t be changed. '
                + 'A buyer’s first VA loan uses the first chart; any later one uses the second.</p>'
                + '<div class="lp-va-charts">' + vaChart('first', 'First-Time VA Use') + vaChart('subsequent', 'Subsequent VA Use') + '</div></div>'
            + '<div class="lp-mi-part" data-mi-for="guide" hidden><label class="lp-check-row"><input type="checkbox" data-mi-none>This product does not have mortgage insurance guidelines</label></div>'
            + '<div class="lp-mi-part" data-mi-for="quotes" hidden>'
                + '<p class="lp-fees-help lp-quote-help">Quote the annual mortgage insurance premium (a percent of the loan each year) for each scenario. A loan at '
                    + pctText(MI_REQUIRED_ABOVE) + ' LTV or less has no mortgage insurance, so the quotes are at ' + MI_LTV.map(pctText).join(', ').replace(/, ([^,]*)$/, ' and $1') + ' LTV.</p>'
                + '<div class="field lp-quotes">' + MI_CREDIT.map((c, ci) => '<div class="lp-quote-block"><p class="lp-quote-title">' + c + ' Credit Score</p>'
                    + '<table class="lp-quote-grid"><thead><tr><th scope="col"><span class="lp-sr">DTI</span></th>'
                    + MI_LTV.map(l => '<th scope="col">' + pctText(l) + ' LTV</th>').join('') + '</tr></thead><tbody>'
                    + MI_DTI.map((d, di) => '<tr><th scope="row">' + pctText(d) + ' DTI</th>' + MI_LTV.map((l, li) => '<td><div class="pct-wrap"><input class="pct" type="text" inputmode="decimal" autocomplete="off" data-miq="'
                        + quoteIndex(ci, di, li) + '" aria-label="' + escapeHtml(miQuoteLabel(ci, di, li)) + '"></div></td>').join('') + '</tr>').join('')
                    + '</tbody></table></div>').join('') + '</div>'
                + '<div class="lp-markups" data-mi-out></div></div>'
            + '</div>';
    }
    const miBoxes = () => [...sectionsEl.querySelectorAll('[data-miq]')].sort((a, b) => a.dataset.miq - b.dataset.miq);
    // The 27 premiums as decimals, or null while any is blank or not a number from 0 up
    function miNow() {
        const boxes = miBoxes();
        if (boxes.length !== 27 || boxes.some(b => b.value.trim() === '')) return null;
        const list = boxes.map(b => Number(b.value.trim()) / 100);
        return list.every(q => isFinite(q) && q >= 0) ? list : null;
    }
    const productType = () => { const t = sectionsEl.querySelector('[data-col="PRODUCT TYPE"]'); return t ? t.value : ''; };
    // The parts of the section that show for the Product Type: 'pick' (none chosen yet), 'fha', 'va', 'quotes' (the 27
    // premiums), 'guide' (Jumbo / Non-Conforming: the checkbox, then the premiums when it's unchecked)
    function miParts() {
        const type = productType();
        if (!type) return ['pick'];
        if (type === 'FHA') return ['fha'];
        if (type === 'VA') return ['va'];
        if (type === 'Conventional') return ['quotes'];
        if (type === 'Jumbo' || type === 'Non-Conforming') {
            const none = sectionsEl.querySelector('[data-mi-none]');
            return none && none.checked ? ['guide'] : ['guide', 'quotes'];
        }
        return [];
    }
    function showMi() {
        const box = sectionsEl.querySelector('[data-mi]');
        if (!box) return;
        const parts = miParts();
        box.querySelectorAll('[data-mi-for]').forEach(el => { el.hidden = !parts.includes(el.dataset.miFor); });
        box.closest('fieldset').querySelector('.section-head h3').textContent = parts.includes('fha') ? 'UFMIP' : parts.includes('va') ? 'VA Funding Fee' : 'Mortgage Insurance';
        showMiOut();
    }
    // The loan term as answered (years), or 30 until it's answered
    function termYears() {
        const term = sectionsEl.querySelector('[data-term]');
        const years = !term ? 0 : term.value === 'other' ? num(sectionsEl.querySelector('[data-term-other] input').value) : num(term.value);
        return years > 0 ? years : 30;
    }
    // The annual premium: the starting premium and three adjustment charts (like the rate markups). The upfront premium:
    // one chart per metric (the other two held at MI_REFERENCE), worked out at today's rate over the loan term.
    function showMiOut() {
        const el = sectionsEl.querySelector('[data-mi-out]');
        if (!el || !miParts().includes('quotes')) return;
        const quotes = miNow();
        if (!quotes) { el.innerHTML = '<p class="lp-markups-empty">Fill in all 27 premiums to see the premium curves and the upfront premium.</p>'; return; }
        const m = miModel(quotes);
        const minScore = currentMinScore();
        const deny = list => (minScore === null ? list : list.map(r => (r.value < minScore ? { ...r, place: 'denied' } : r)));
        const creditBase = { title: 'Credit Score', head: 'Score', quoted: MI_CREDIT, cutoff: minScore, label: v => String(v), tip: v => v + ' credit score', ticks: [300, 400, 500, 600, 700, 800], tick: v => String(v) };
        const dtiBase = { title: 'Debt-to-Income', head: 'DTI', quoted: MI_DTI, label: pctText, tip: v => pctText(v) + ' DTI', ticks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], tick: pctText };
        const ltvBase = { title: 'Loan-to-Value', head: 'LTV', quoted: MI_LTV, label: pctText, tip: v => pctText(v) + ' LTV', ticks: [0.85, 0.9, 0.95, 1], tick: pctText };
        const annual = [
            { ...creditBase, key: 'mi-credit', rows: deny(m.tables.credit), fn: m.credit, valueHead: 'Adjustment' },
            { ...dtiBase, key: 'mi-dti', rows: m.tables.dti, fn: m.dti, valueHead: 'Adjustment' },
            { ...ltvBase, key: 'mi-ltv', rows: m.tables.ltv, fn: m.ltv, valueHead: 'Adjustment' },
        ];
        const R = MI_REFERENCE;
        const refText = R.credit + ' credit score, ' + pctText(R.dti) + ' DTI and ' + pctText(R.ltv) + ' LTV';
        let html = '<p class="lp-markups-head">Annual Premium</p>'
            + '<p class="lp-markup-sum">Starting premium (' + MI_CREDIT[0] + ' credit score, ' + pctText(MI_DTI[0]) + ' DTI, ' + pctText(MI_LTV[0]) + ' LTV): <b>' + premText(m.start) + '</b> a year. '
            + 'A buyer’s premium is the starting premium + the three adjustments below'
            + (m.worstMiss >= 0.00005 ? '; that comes within <b>' + (Math.round(m.worstMiss * 1e5) / 1e3).toFixed(3) + '%</b> of every quote.' : ', matching every quote.')
            + ' None at ' + pctText(MI_REQUIRED_ABOVE) + ' LTV or less. It’s paid monthly (the yearly premium ÷ 12), unless the buyer pays it up front.</p>'
            + '<div class="lp-metrics">' + annual.map(metricCard).join('') + '</div>'
            + '<p class="lp-markup-key"><span class="lp-key-band"></span>Shaded: the quoted range, where the curve passes through the quoted levels (the dots and <b>bold</b> rows). '
            + '<span class="lp-key-line is-dashed"></span>Dashed and <i>italic</i>: estimated past the quotes.'
            + (minScore !== null ? ' <span class="lp-key-denied"></span>Hatched: below the ' + minScore + ' minimum credit score (Max DTI), where an applicant is denied.' : '') + '</p>';
        // The upfront premium
        const today = fieldToday();
        const field = (ctx && ctx.fields || []).find(f => f.col === 'MI QUOTES');
        const s = miSettings(field && field.mi);
        const years = termYears();
        let upMetrics = [];
        html += '<p class="lp-markups-head">Upfront Premium</p>';
        if (!today) html += '<p class="lp-markups-empty">Today’s interest rate isn’t set, so the upfront premium can’t be worked out yet.</p>';
        else {
            const factor = ltv => upfrontFactor(ltv, today, years, s);
            const up = (c, d, l) => m.premium(c, d, l) * factor(l).factor;
            const rowsOf = (list, fn) => list.map(r => ({ value: r.value, markup: fn(r.value), place: r.place }));
            const fns = { credit: c => up(c, R.dti, R.ltv), dti: d => up(R.credit, d, R.ltv), ltv: l => up(R.credit, R.dti, l) };
            const upBase = { unsigned: true, fmt: premText, valueHead: 'Upfront' };
            upMetrics = [
                { ...creditBase, ...upBase, key: 'up-credit', rows: deny(rowsOf(m.tables.credit, fns.credit)), fn: fns.credit },
                { ...dtiBase, ...upBase, key: 'up-dti', rows: rowsOf(m.tables.dti, fns.dti), fn: fns.dti },
                { ...ltvBase, ...upBase, key: 'up-ltv', rows: rowsOf(m.tables.ltv, fns.ltv), fn: fns.ltv },
            ];
            const ref = factor(R.ltv);
            const pct = v => String(Number((v * 100).toFixed(2))) + '%';
            html += '<p class="lp-markup-sum">Instead of monthly, the buyer can pay the premium once at closing. That upfront premium is estimated as the monthly premiums until the loan is expected to be at <b>'
                + pct(s.removalLtv) + ' LTV</b>: the balance paid down at today’s ' + rateText(today) + ' rate over ' + years + ' years, and the home’s value growing ' + pct(s.appreciation)
                + ' a year (at least ' + s.minYears + (s.minYears === 1 ? ' year' : ' years') + '), each premium discounted ' + pct(s.discount) + ' a year back to closing. '
                + 'For a ' + refText + ', that’s <b>' + premText(up(R.credit, R.dti, R.ltv)) + '</b> of the loan (about ' + (Math.round(ref.months / 12 * 10) / 10) + ' years of its '
                + premText(m.premium(R.credit, R.dti, R.ltv)) + ' annual premium). Each chart changes one metric and holds the other two at those.</p>'
                + '<div class="lp-metrics">' + upMetrics.map(metricCard).join('') + '</div>'
                + '<p class="lp-markup-key">Dots: the quoted levels. <span class="lp-key-line is-dashed"></span>Dashed and <i>italic</i>: estimated past the quotes. On the Buyer Breakdown, the buyer’s own rate, term and scenario are used.</p>';
        }
        el.innerHTML = html;
        [...annual, ...upMetrics].forEach(mt => wireChart(el.querySelector('[data-metric="' + mt.key + '"]'), mt));
    }

    // A markup curve as an SVG line chart: the curve (solid across the quoted range, dashed past it), a dot at each quoted
    // level, the quoted range shaded, and a hover / arrow-key readout that snaps to the table's rows
    const CH = { w: 340, h: 210, l: 46, r: 12, t: 10, b: 26, line: '#a65a35' };
    function chartScales(mt) {
        const xs = mt.rows.map(r => r.value);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        const samples = Array.from({ length: 161 }, (_, i) => { const x = xMin + (xMax - xMin) * i / 160; return [x, mt.fn(x)]; });
        // (only where the curve is drawn: not below a cutoff)
        const drawn = mt.cutoff ? samples.filter(p => p[0] >= mt.cutoff).concat([[mt.cutoff, mt.fn(mt.cutoff)]]) : samples;
        let yMin = Math.min(0, ...drawn.map(s => s[1])), yMax = Math.max(0, ...drawn.map(s => s[1]));
        if (yMax - yMin < 1e-5) { yMin -= 0.0005; yMax += 0.0005; }
        // A little room above and below the curve, and clean tick steps inside it (in decimals: 0.0025 is 0.25%)
        const pad = (yMax - yMin) * 0.06;
        yMin -= pad; yMax += pad;
        const rough = (yMax - yMin) / 5;
        const pow = Math.pow(10, Math.floor(Math.log10(rough)));
        const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= rough);
        const pw = CH.w - CH.l - CH.r, ph = CH.h - CH.t - CH.b;
        return { xMin, xMax, yMin, yMax, step, samples,
            x: v => CH.l + (v - xMin) / (xMax - xMin) * pw, y: v => CH.t + (yMax - v) / (yMax - yMin) * ph };
    }
    function markupChart(mt) {
        const s = chartScales(mt);
        let [qMin, qMax] = mt.band || [Math.min(...mt.quoted), Math.max(...mt.quoted)];
        // A cutoff (the minimum credit score): nothing is drawn below it but a hatched "Denied" area
        const cut = mt.cutoff && mt.cutoff > s.xMin ? mt.cutoff : null;
        if (cut) qMin = Math.max(qMin, cut);
        const dots = mt.quoted.filter(q => !cut || q >= cut);
        // As many decimals as the step needs (2.5% steps: "+2.5%", "+5.0%")
        const stepPct = Math.round(s.step * 1e6) / 1e4;
        const dec = [0, 1, 2, 3].find(d => Math.abs(stepPct * Math.pow(10, d) - Math.round(stepPct * Math.pow(10, d))) < 1e-6);
        const yLabel = v => { const p = Math.round(v * 1e6) / 1e4; return (mt.unsigned ? (p < 0 ? '−' : '') : p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(dec) + '%'; };
        const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + s.x(p[0]).toFixed(1) + ' ' + s.y(p[1]).toFixed(1)).join('');
        // The curve in three pieces: below the quoted range, across it, above it (each sampled finely, sharing their ends)
        const piece = (from, to) => { const pts = s.samples.filter(p => p[0] >= from && p[0] <= to); pts.unshift([from, mt.fn(from)]); pts.push([to, mt.fn(to)]); return pts; };
        const parts = [[s.xMin, qMin, true], [qMin, qMax, false], [qMax, s.xMax, true]].map(([a, b, d]) => [cut ? Math.max(a, cut) : a, b, d]).filter(p => p[1] > p[0]);
        const plotB = CH.h - CH.b, cx = cut ? s.x(cut) : 0;
        const denied = !cut ? '' : '<defs><pattern id="lp-denied-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(14,42,59,0.03)"/>'
            + '<line x1="0" y1="0" x2="0" y2="6" stroke="rgba(14,42,59,0.12)" stroke-width="2"/></pattern></defs>'
            + '<rect x="' + CH.l + '" y="' + CH.t + '" width="' + (cx - CH.l).toFixed(1) + '" height="' + (plotB - CH.t) + '" fill="url(#lp-denied-hatch)"/>';
        const deniedMark = !cut ? '' : '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + CH.t + '" y2="' + plotB + '" stroke="rgba(79,45,44,0.6)" stroke-width="1.5"/>'
            + (cx - CH.l > 70 ? '<text x="' + ((CH.l + cx) / 2).toFixed(1) + '" y="' + (CH.t + 16) + '" text-anchor="middle" style="font-weight: bold">Denied</text>'
                + '<text x="' + ((CH.l + cx) / 2).toFixed(1) + '" y="' + (CH.t + 30) + '" text-anchor="middle">below ' + cut + '</text>' : '');
        let grid = '';
        for (let v = Math.ceil(s.yMin / s.step - 1e-9) * s.step; v <= s.yMax + 1e-12; v += s.step) {
            const y = s.y(v).toFixed(1), zero = Math.abs(v) < s.step / 2;
            grid += '<line x1="' + CH.l + '" x2="' + (CH.w - CH.r) + '" y1="' + y + '" y2="' + y + '" stroke="' + (zero ? 'rgba(14,42,59,0.4)' : 'rgba(14,42,59,0.09)') + '" stroke-width="1"/>'
                + '<text x="' + (CH.l - 6) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' + yLabel(zero ? 0 : v) + '</text>';
        }
        const xTicks = mt.ticks.map(v => '<text x="' + s.x(v).toFixed(1) + '" y="' + (CH.h - 6) + '" text-anchor="middle">' + escapeHtml(mt.tick(v)) + '</text>').join('');
        const live = mt.rows.filter(r => r.place !== 'denied');
        const top = live.reduce((a, r) => (Math.abs(r.markup) > Math.abs(a.markup) ? r : a), live[0]);
        const fmt = mt.fmt || markText;
        const label = mt.title + ' chart: ' + dots.map(q => mt.tip(q) + ' ' + fmt(mt.fn(q))).join(', ') + '; ' + mt.tip(top.value) + ' ' + fmt(top.markup) + ' (estimated)'
            + (cut ? '; denied below ' + cut : '') + '. The table beside it lists every value.';
        return '<div class="lp-chart" tabindex="0" role="img" aria-label="' + escapeHtml(label) + '"><svg viewBox="0 0 ' + CH.w + ' ' + CH.h + '" aria-hidden="true">'
            + denied + (qMax > qMin ? '<rect x="' + s.x(qMin).toFixed(1) + '" y="' + CH.t + '" width="' + (s.x(qMax) - s.x(qMin)).toFixed(1) + '" height="' + (CH.h - CH.t - CH.b) + '" fill="rgba(192,144,80,0.16)"/>' : '')
            + grid + xTicks + deniedMark
            + parts.map(([a, b, dashed]) => '<path d="' + path(piece(a, b)) + '" fill="none" stroke="' + CH.line + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (dashed ? ' stroke-dasharray="5 4"' : '') + '/>').join('')
            + dots.map(q => '<circle cx="' + s.x(q).toFixed(1) + '" cy="' + s.y(mt.fn(q)).toFixed(1) + '" r="4.5" fill="' + CH.line + '" stroke="#fff" stroke-width="2"/>').join('')
            + '<g data-hover style="display: none"><line data-cross y1="' + CH.t + '" y2="' + (CH.h - CH.b) + '" stroke="rgba(14,42,59,0.45)" stroke-width="1"/><circle data-dot r="5" fill="#fff" stroke="' + CH.line + '" stroke-width="2.5"/></g>'
            + '</svg><div class="lp-tip" hidden><b data-tip-v></b><span data-tip-k></span></div></div>';
    }
    // Hover, touch and arrow keys: a crosshair on the nearest table row, its value in a tooltip, and that row highlighted
    function wireChart(card, mt) {
        const chart = card.querySelector('.lp-chart');
        const svg = chart.querySelector('svg');
        const s = chartScales(mt);
        const rows = mt.rows.slice().sort((a, b) => a.value - b.value);
        const hover = svg.querySelector('[data-hover]'), cross = svg.querySelector('[data-cross]'), dot = svg.querySelector('[data-dot]');
        const tip = chart.querySelector('.lp-tip'), scroller = card.querySelector('.lp-mt-scroll');
        let at = -1;
        const show = i => {
            at = Math.max(0, Math.min(rows.length - 1, i));
            const r = rows[at];
            const isDenied = r.place === 'denied';
            const px = s.x(r.value);
            hover.style.display = '';
            cross.setAttribute('x1', px); cross.setAttribute('x2', px);
            dot.style.display = isDenied ? 'none' : '';
            if (!isDenied) { dot.setAttribute('cx', px); dot.setAttribute('cy', s.y(r.markup)); }
            tip.querySelector('[data-tip-v]').textContent = isDenied ? 'Denied' : (mt.fmt || markText)(r.markup);
            tip.querySelector('[data-tip-k]').textContent = mt.tip(r.value) + (isDenied ? ' · below the ' + mt.cutoff + ' minimum' : r.place === 'estimated' ? ' · estimated' : r.place === 'quoted' ? ' · quoted' : '');
            tip.hidden = false;
            const box = svg.getBoundingClientRect(), outer = chart.getBoundingClientRect();
            const left = px * box.width / CH.w + box.left - outer.left;
            const right = left > chart.clientWidth * 0.55;
            tip.style.left = right ? '' : (left + 12) + 'px';
            tip.style.right = right ? (chart.clientWidth - left + 12) + 'px' : '';
            card.querySelectorAll('tr.is-hover').forEach(t => t.classList.remove('is-hover'));
            const row = card.querySelector('tr[data-v="' + r.value + '"]');
            if (row) {
                row.classList.add('is-hover');
                const head = scroller.querySelector('thead').offsetHeight;
                if (row.offsetTop - head < scroller.scrollTop) scroller.scrollTop = row.offsetTop - head;
                else if (row.offsetTop + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = row.offsetTop + row.offsetHeight - scroller.clientHeight;
            }
        };
        const hide = () => { at = -1; hover.style.display = 'none'; tip.hidden = true; card.querySelectorAll('tr.is-hover').forEach(t => t.classList.remove('is-hover')); };
        const nearest = clientX => {
            const box = svg.getBoundingClientRect();
            const v = s.xMin + ((clientX - box.left) / box.width * CH.w - CH.l) / (CH.w - CH.l - CH.r) * (s.xMax - s.xMin);
            let best = 0;
            rows.forEach((r, i) => { if (Math.abs(r.value - v) < Math.abs(rows[best].value - v)) best = i; });
            return best;
        };
        chart.addEventListener('pointermove', e => show(nearest(e.clientX)));
        chart.addEventListener('pointerdown', e => show(nearest(e.clientX)));
        chart.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && document.activeElement !== chart) hide(); });
        chart.addEventListener('focus', () => { if (at < 0) show(rows.findIndex(r => r.place === 'quoted')); });
        chart.addEventListener('blur', hide);
        chart.addEventListener('keydown', e => {
            const move = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
            if (move) { e.preventDefault(); show((at < 0 ? 0 : at) + move); }
            if (e.key === 'Home') { e.preventDefault(); show(0); }
            if (e.key === 'End') { e.preventDefault(); show(rows.length - 1); }
            if (e.key === 'Escape' && at >= 0) { e.preventDefault(); e.stopPropagation(); hide(); }
        });
    }

    // No negative months: "−" stops at 0
    function syncStepper(input) {
        input.parentElement.querySelector('[data-step="-1"]').disabled = num(input.value) <= 0;
    }
    const isDpa = () => { const type = sectionsEl.querySelector('[data-col="PRODUCT TYPE"]'); return !!type && type.value === DPA; };
    const scopeOn = scope => (scope === 'dpa' ? isDpa() : scope === 'regular' ? !isDpa() : true);
    function showScopes() {
        sectionsEl.querySelectorAll('[data-scope]').forEach(el => { el.hidden = !scopeOn(el.dataset.scope); });
        showMi();
    }
    function showTerm() {
        const term = sectionsEl.querySelector('[data-term]');
        sectionsEl.querySelector('[data-term-other]').hidden = term.value !== 'other';
    }
    const gateAnswer = key => { const on = sectionsEl.querySelector('[data-gate="' + key + '"] input:checked'); return on ? on.value === 'TRUE' : null; };
    function showGates() {
        sectionsEl.querySelectorAll('[data-gate-body]').forEach(b => { b.hidden = gateAnswer(b.dataset.gateBody) !== (b.hasAttribute('data-gate-invert') ? false : true); });
    }
    // A question's current answer by its column ('' when unanswered; a yes/no is TRUE or FALSE)
    function answerOf(col) {
        if (gateOfCol[col]) { const a = gateAnswer(gateOfCol[col]); return a === null ? '' : a ? 'TRUE' : 'FALSE'; }
        const el = sectionsEl.querySelector('[data-col="' + col + '"]');
        if (!el) return '';
        return el.dataset.kind === 'bool' ? ((el.querySelector('input:checked') || {}).value || '') : el.value;
    }
    // Each cond's questions: shown while its answers call for them
    function showConds() {
        const walk = items => items.forEach(it => {
            if (it.cond) { const el = sectionsEl.querySelector('[data-cond="' + it.cond + '"]'); if (el) el.hidden = !it.show(answerOf); }
            if (it.items) walk(it.items);
        });
        layout.forEach(s => walk(s.items));
    }

    // Qualifications: one row per kind (its type picked from a dropdown, then the box it needs)
    let qualCount = 0;
    const qualRows = () => [...sectionsEl.querySelectorAll('[data-qual-list] [data-qual-row]')];
    function addQualRow(q = {}) {
        const list = sectionsEl.querySelector('[data-qual-list]');
        const id = 'lp-qual-' + (++qualCount);
        list.insertAdjacentHTML('beforeend', '<div class="lp-qual-row field" data-qual-row>'
            + '<div><select id="' + id + '" data-qual-type aria-label="Qualification"><option value="">Choose a qualification...</option>'
            + QUALIFICATIONS.map(x => '<option value="' + escapeHtml(x.type) + '">' + escapeHtml(x.type) + '</option>').join('') + '</select></div>'
            + '<button type="button" class="lp-fee-remove" data-remove-qual aria-label="Remove this qualification">' + CLOSE_ICON + '</button>'
            + '<div class="lp-qual-value" data-qual-value></div></div>');
        const row = list.lastElementChild;
        const select = row.querySelector('select');
        select.value = q.type || '';
        makePicker(select);
        renderQualValue(row, q.value);
        syncQuals();
        return row;
    }
    // The box a row's qualification needs, holding value (a number, or the census designations)
    function renderQualValue(row, value) {
        const def = qualificationOf(row.querySelector('[data-qual-type]').value);
        const box = row.querySelector('[data-qual-value]');
        const id = row.querySelector('select').id + '-v';
        const has = value !== undefined && value !== null && value !== '';
        const label = def ? '<label for="' + id + '">' + escapeHtml(def.label) + '</label>' : '';
        if (!def) box.innerHTML = '';
        else if (def.input === 'none') box.innerHTML = '<p class="lp-qual-none">Nothing else to add: at least one purchaser must take a homebuyer education class.</p>';
        else if (def.input === 'money') box.innerHTML = label + '<div class="money-wrap"><input id="' + id + '" class="money" data-qual-k="money" type="text" inputmode="numeric" autocomplete="off" value="' + (has ? escapeHtml(shown('money', value)) : '') + '"></div>';
        else if (def.input === 'score') box.innerHTML = label + '<input id="' + id + '" class="digits" data-qual-k="score" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="' + CREDIT_MIN + '-' + CREDIT_MAX + '" value="' + (has ? escapeHtml(String(value)) : '') + '">';
        else if (def.input === 'years') box.innerHTML = label + '<div class="lp-ratio"><input id="' + id + '" class="digits" data-qual-k="years" type="text" inputmode="numeric" maxlength="2" autocomplete="off" value="' + (has ? escapeHtml(String(value)) : '') + '"><span>years</span></div>';
        else if (def.input === 'census') {
            box.innerHTML = '<span class="lp-qual-label">' + escapeHtml(def.label) + '</span>' + multiHtml('data-qual-k="census"', CENSUS_DESIGNATIONS, 'Choose designations...');
            const picked = Array.isArray(value) ? value : [];
            box.querySelectorAll('input').forEach(i => { i.checked = picked.includes(i.value); });
            syncMulti(box.querySelector('.lp-multi'));
        }
    }
    // Each kind can be picked in one row only; + Add Qualification hides once there's a row for every kind
    function syncQuals() {
        const rows = qualRows();
        const used = rows.map(r => r.querySelector('[data-qual-type]').value);
        rows.forEach((r, i) => r.querySelectorAll('.lp-picker:not(.lp-multi) .lp-option').forEach(o => { o.hidden = used.some((u, j) => j !== i && u === o.dataset.value); }));
        const add = sectionsEl.querySelector('[data-add-qual]');
        if (add) add.hidden = rows.length >= QUALIFICATIONS.length;
    }

    // Puts a product's values in the boxes (a new product: blank, escrow months at 3, every yes/no unanswered)
    function fill(values, isNew) {
        // A Down Payment Assistance product saved before its amount could be a flat amount: a percentage of the price
        if (!isNew && String(values['PRODUCT TYPE'] || '').trim() === DPA && !String(values['SECOND LOAN AMOUNT TYPE'] || '').trim() && num(values['SECOND LOAN LTV MAX']) > 0) {
            values = { ...values, 'SECOND LOAN AMOUNT TYPE': 'Percentage' };
        }
        const setGates = items => items.forEach(it => {
            if (it.cond) { setGates(it.items); return; }
            if (!it.gate) return;
            const on = isNew ? null : it.isOn(values);
            sectionsEl.querySelectorAll('[data-gate="' + it.gate + '"] input').forEach(r => { r.checked = on !== null && r.value === String(on).toUpperCase(); });
            // Columns under a closed gate start empty, so opening it doesn't show the stand-in values
            if (on === (it.invert ? true : false)) clearUnder(it.items);
            setGates(it.items);
        });
        const clearUnder = items => items.forEach(it => { if (it.gate || it.cond) clearUnder(it.items); else if (it.col) cleared[it.col] = true; });
        const cleared = {};
        layout.forEach(s => setGates(s.items));
        sectionsEl.querySelectorAll('[data-col]').forEach(el => {
            const col = el.dataset.col;
            const kind = el.dataset.kind;
            const raw = cleared[col] ? '' : values[col];
            if (kind === 'tile') el.checked = isTrue(raw);
            else if (kind === 'bool') el.querySelectorAll('input').forEach(r => { r.checked = String(raw || '').trim().toUpperCase() === r.value; });
            else if (kind === 'choice') {
                const pick = [...el.options].find(o => o.value && o.value.toLowerCase() === String(raw || '').trim().toLowerCase());
                el.value = pick ? pick.value : '';
            }
            else el.value = isNew && el.closest('.lp-stepper') ? ESCROW_DEFAULT : shown(kind, raw);
            if (el.closest('.lp-stepper')) syncStepper(el);
        });
        // A saved product with both its quotes and its buydown quotes has submitted its sheet (locked); otherwise it's
        // filled in here, starting from any quotes it has
        const savedQuotes = isNew ? null : rateQuotes(values['RATE QUOTES']);
        const savedBuys = isNew ? null : buydownQuotes(values['BUYDOWN QUOTES']);
        locked = savedQuotes && savedBuys ? { quotes: savedQuotes.quotes, buys: savedBuys, today: savedQuotes.today, date: savedQuotes.date, pending: false } : null;
        requoting = false;
        sheetMode = locked ? 'locked' : 'open';
        putSheet(savedQuotes && savedQuotes.quotes, savedBuys);
        showSheet();
        const feeList = sectionsEl.querySelector('[data-fee-list]');
        if (feeList) feeList.innerHTML = lenderFees(values['OTHER LENDER FEES']).map(feeRow).join('');
        // A Down Payment Assistance product's professions / groups and qualifications (one blank row to start)
        sectionsEl.querySelectorAll('[data-groups]').forEach(p => {
            const picked = isNew ? [] : groupList(values[p.dataset.groups]);
            p.querySelectorAll('input').forEach(i => { i.checked = picked.includes(i.value); });
            syncMulti(p);
        });
        const qualList = sectionsEl.querySelector('[data-qual-list]');
        if (qualList) {
            qualList.innerHTML = '';
            const quals = isNew ? [] : dpaQualifications(values['DPA QUALIFICATIONS']);
            (quals.length ? quals : [{}]).forEach(q => addQualRow(q));
        }
        // Mortgage insurance: the saved premiums; a Jumbo / Non-Conforming product's checkbox starts checked (a new product,
        // or one saved before it that has no premiums)
        const savedMi = isNew ? null : miQuotes(values['MI QUOTES']);
        miBoxes().forEach((b, i) => { b.value = savedMi ? shown('rate', savedMi[i]) : ''; b.classList.remove('is-invalid'); });
        const noneBox = sectionsEl.querySelector('[data-mi-none]');
        if (noneBox) {
            const raw = String(values['NO MI GUIDELINES'] || '').trim().toUpperCase();
            noneBox.checked = isNew || raw === 'TRUE' || (raw !== 'FALSE' && !savedMi);
        }
        // A product's tiers (one saved before the tier list: its old set tiers); a new one starts with one blank row
        const tierList = sectionsEl.querySelector('[data-tier-list]');
        if (tierList) {
            const tiers = isNew ? [] : productDtiTiers(c => values[c]);
            tierList.innerHTML = (tiers.length ? tiers : [{}]).map(tierRow).join('');
        }
        const term = sectionsEl.querySelector('[data-term]');
        if (term) {
            const years = String(values['LOAN TERM'] || '').trim();
            term.value = !years ? '' : years === '30' || years === '15' ? years : 'other';
            sectionsEl.querySelector('[data-term-other] input').value = term.value === 'other' ? shown('int', years) : '';
            showTerm();
        }
        sectionsEl.querySelectorAll('[data-edit-only]').forEach(f => { f.hidden = isNew; });
        sectionsEl.querySelectorAll('select.lp-native').forEach(syncPicker);
        syncLabels();
        showScopes();
        sectionsEl.querySelectorAll('.lp-picker.is-open').forEach(p => p.classList.remove('is-open'));
        showGates();
        showConds();
        syncTiers();
    }

    // Every field's value to save (rates back to decimals). missing: the first unanswered question shown.
    function read() {
        const values = {};
        const offs = [];
        let missing = null;
        const need = (el, v) => { if (v === '' && !missing) missing = el; };
        const boxValue = el => {
            let v = el.value.trim().replace(/,/g, '');
            if ((el.dataset.kind === 'rate' || el.dataset.kind === 'signedRate') && v !== '' && v !== '-') v = String(Number((Number(v) / 100).toPrecision(10)));
            return v === '-' ? '' : v;
        };
        const offValue = (col, off) => (off ? off(col, values) : kinds[col] === 'bool' ? 'FALSE' : '0');
        const walk = (items, active, off) => items.forEach(it => {
            if (it.scope && !scopeOn(it.scope)) { blank(it); return; }
            // A cond's hidden questions are left blank (within an answered section)
            if (it.cond) { walk(it.items, active && it.show(answerOf), active ? (it.off || (() => '')) : off); return; }
            // Professions / groups: at least one
            if (it.groups) {
                const picker = sectionsEl.querySelector('[data-groups="' + it.groups + '"]');
                const picked = active ? multiPicked(picker) : [];
                if (active && !picked.length) need(picker, '');
                values[it.groups] = picked.length ? JSON.stringify(picked) : '';
                return;
            }
            // Qualifications: each row's type and what it needs ("[]" for none)
            if (it.quals) {
                values[it.quals] = '[]';
                if (!active) return;
                const list = [];
                qualRows().forEach(row => {
                    const select = row.querySelector('[data-qual-type]');
                    const def = qualificationOf(select.value);
                    if (!def) { need(select, ''); return; }
                    if (def.input === 'none') { list.push({ TYPE: def.type }); return; }
                    if (def.input === 'census') {
                        const picker = row.querySelector('[data-qual-k="census"]');
                        const picked = multiPicked(picker);
                        if (!picked.length) need(picker, ''); else list.push({ TYPE: def.type, VALUE: picked });
                        return;
                    }
                    const box = row.querySelector('[data-qual-k]');
                    const raw = box.value.trim().replace(/,/g, '');
                    need(box, raw);
                    if (raw !== '') list.push({ TYPE: def.type, VALUE: Number(raw) });
                });
                if (!qualRows().length) need(sectionsEl.querySelector('[data-add-qual]'), '');
                values[it.quals] = JSON.stringify(list);
                return;
            }
            if (it.fixed) { values[it.col] = it.fixed; return; }
            if (it.tiles) { it.tiles.forEach(t => { values[t.col] = sectionsEl.querySelector('[data-col="' + t.col + '"]').checked ? 'TRUE' : 'FALSE'; }); return; }
            // The submitted sheet (a saved product's is kept by the API whatever is sent: only a requote replaces it)
            if (it.quotes) { values[it.quotes] = active && locked ? JSON.stringify({ QUOTES: locked.quotes }) : ''; return; }
            if (it.buydown) { values[it.buydown] = active && locked ? JSON.stringify({ QUOTES: locked.buys }) : ''; return; }
            // Max DTI tiers: each row filled in (a blank row is skipped); no separate housing-only max: the same as its max DTI
            if (it.tiers) {
                values[it.tiers] = '';
                if (!active) return;
                const housingOn = gateAnswer('housing') === true;
                const dec = v => Number((Number(v) / 100).toPrecision(10));
                const list = [];
                tierRows().forEach(row => {
                    const box = k => row.querySelector('[data-tier-k="' + k + '"]');
                    const s = box('score').value.trim(), d = box('dti').value.trim(), h = box('housing').value.trim();
                    if (!s && !d && !(housingOn && h)) return;
                    need(box('score'), s);
                    need(box('dti'), d);
                    if (housingOn) need(box('housing'), h);
                    if (s && d && (!housingOn || h)) list.push({ SCORE: Number(s), DTI: dec(d), HOUSING: housingOn ? dec(h) : dec(d) });
                });
                if (!list.length) need(sectionsEl.querySelector('[data-add-tier]'), '');
                values[it.tiers] = JSON.stringify(list.sort((a, b) => a.SCORE - b.SCORE));
                return;
            }
            // Mortgage insurance: the 27 premiums when the type asks them, and the Jumbo / Non-Conforming checkbox
            if (it.mi) {
                const parts = miParts();
                values[it.mi.none] = parts.includes('guide') && sectionsEl.querySelector('[data-mi-none]').checked ? 'TRUE' : 'FALSE';
                values[it.mi.quotes] = '';
                if (active && parts.includes('quotes')) {
                    const boxes = miBoxes();
                    boxes.forEach(b => need(b, b.value.trim()));
                    if (boxes.every(b => b.value.trim() !== '')) values[it.mi.quotes] = JSON.stringify({ QUOTES: boxes.map(b => Number((Number(b.value.trim()) / 100).toPrecision(10))) });
                }
                return;
            }
            if (it.fees) {
                it.fees.standard.forEach(c => {
                    const el = sectionsEl.querySelector('[data-col="' + c + '"]');
                    values[c] = active ? boxValue(el) : '0';
                    if (active) need(el, values[c]);
                });
                if (it.fees.col) {
                    const list = [];
                    if (active) sectionsEl.querySelectorAll('[data-fee-list] .lp-fee-row').forEach(row => {
                        const name = row.querySelector('[data-fee-k="name"]'), amount = row.querySelector('[data-fee-k="amount"]');
                        const n = name.value.trim(), a = amount.value.trim().replace(/,/g, '');
                        if (!n && !a) return;
                        if (!n) need(name, '');
                        if (a === '') need(amount, '');
                        if (n && a !== '') list.push({ NAME: n, AMOUNT: Number(a) });
                    });
                    values[it.fees.col] = JSON.stringify(list);
                }
                return;
            }
            if (it.gate) {
                const on = active ? gateAnswer(it.gate) : false;
                if (on === null) need(sectionsEl.querySelector('[data-gate="' + it.gate + '"]'), '');
                if (it.col) values[it.col] = active ? (on ? 'TRUE' : 'FALSE') : offValue(it.col, off);
                walk(it.items, active && on === (it.invert ? false : true), it.off || off);
                return;
            }
            if (!active) { offs.push([it.col, off]); return; }
            // A new product's lender name is the bank on file (the API fills it in)
            if (it.editOnly && !ctx.product) return;
            if (it.input === 'term') {
                const term = sectionsEl.querySelector('[data-term]');
                const other = sectionsEl.querySelector('[data-term-other] input');
                values[it.col] = term.value === 'other' ? other.value.trim() : term.value;
                need(term.value === 'other' ? other : term, values[it.col]);
                return;
            }
            const el = sectionsEl.querySelector('[data-col="' + it.col + '"]');
            values[it.col] = el.dataset.kind === 'bool' ? ((el.querySelector('input:checked') || {}).value || '')
                : el.dataset.kind === 'choice' ? el.value : boxValue(el);
            if (!it.optional) need(el, values[it.col]);
        });
        // A DPA product: everything regular is left blank
        const blanks = [];
        const blank = it => { if (it.cond) it.items.forEach(blank); else if (it.groups) blanks.push(it.groups); else if (it.quals) blanks.push(it.quals); else if (it.tiles) it.tiles.forEach(t => blanks.push(t.col)); else if (it.quotes) blanks.push(it.quotes); else if (it.buydown) blanks.push(it.buydown); else if (it.tiers) blanks.push(it.tiers); else if (it.mi) blanks.push(it.mi.quotes, it.mi.none); else if (it.fees) { it.fees.standard.forEach(c => blanks.push(c)); if (it.fees.col) blanks.push(it.fees.col); } else if (it.gate) { if (it.col) blanks.push(it.col); it.items.forEach(blank); } else if (it.col) blanks.push(it.col); };
        layout.forEach(s => { if (scopeOn(s.scope)) walk(s.items, true, null); else if (s.scope === 'regular') s.items.forEach(blank); else walk(s.items, false, null); });
        // After the answers, so "same as Max DTI" can copy them
        offs.forEach(([col, off]) => { values[col] = offValue(col, off); });
        blanks.forEach(col => { values[col] = ''; });
        // Any other product: none of the DPA-only answers
        if (!isDpa()) DPA_ONLY.forEach(col => { if (col in kinds) values[col] = ''; });
        return { values, missing };
    }

    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
    const clear = e => { const el = e.target.closest('[data-col], [data-gate], [data-term], [data-quote], [data-buy], [data-miq], [data-groups], [data-qual-type], [data-qual-k]'); if (el) el.classList.remove('is-invalid'); message.textContent = ''; };
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);
    form.addEventListener('change', syncLabels);
    // Credit scores (the minimum and each tier's): one that can't be (not 300 to 850) is outlined in red as soon as it's typed
    const scoreBox = el => el.matches('[data-tier-k="score"], [data-kind="score"], [data-qual-k="score"]');
    form.addEventListener('input', e => { if (scoreBox(e.target) && e.target.value.length === 3 && !scoreOk(e.target.value)) e.target.classList.add('is-invalid'); });
    form.addEventListener('change', e => { if (scoreBox(e.target) && e.target.value !== '' && !scoreOk(e.target.value)) e.target.classList.add('is-invalid'); });
    // Each LABEL_RULES label: its own text while the other answer matches, else the usual one
    function syncLabels() {
        LABEL_RULES.forEach(r => {
            const box = sectionsEl.querySelector('[data-col="' + r.col + '"]');
            const label = box && sectionsEl.querySelector('label[for="' + box.id + '"]');
            if (!label) return;
            if (!label.dataset.usual) label.dataset.usual = label.textContent;
            const other = sectionsEl.querySelector('[data-col="' + r.when[0] + '"]');
            const answer = other ? (other.matches('input, select') ? other.value : ((other.querySelector('input:checked') || {}).value || '')) : '';
            label.textContent = answer === r.when[1] ? r.label : label.dataset.usual;
        });
    }

    const problem = (el, text) => {
        if (el) {
            el.classList.add('is-invalid');
            const picker = el.matches('select.lp-native') ? el.nextElementSibling : el.classList.contains('lp-multi') ? el : null;
            const focusable = picker ? picker.querySelector('.lp-picker-btn') : el.matches('input, select, button') ? el : el.querySelector('input');
            if (focusable) focusable.focus({ preventScroll: true });
            el.scrollIntoView({ block: 'center' });
        }
        message.textContent = text;
    };
    const ERRORS = {
        duplicate_name: 'You already have a loan product with that name.',
        invalid_value: 'One of the answers isn’t valid. Percentages can’t be over 100.',
        not_found: 'That loan product couldn’t be found. Please refresh and try again.',
        no_lender_bank: 'Your account doesn’t have a lender bank on file yet. Please ask Andrew to add it.',
        no_today_rate: 'Today’s interest rate isn’t set, so the quoted rates can’t be saved yet. Please ask Andrew to set it.',
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        message.textContent = '';
        const { values, missing } = read();
        if (missing) {
            if (missing.matches('[data-add-tier]')) { problem(missing, 'Please add at least one credit score and its max DTI.'); return; }
            if (missing.matches('[data-tier-k]')) { problem(missing, 'Please fill in each credit score’s row (or remove it).'); return; }
            if (missing.matches('[data-miq]')) { problem(missing, 'Please quote the annual mortgage insurance premium for every scenario (' + missing.getAttribute('aria-label') + ').'); return; }
            if (missing.matches('[data-fee-k]')) { problem(missing, missing.dataset.feeK === 'name' ? 'Please name the added fee (or remove it).' : 'Please enter the added fee’s amount (or remove it).'); return; }
            if (missing.matches('[data-groups]')) { problem(missing, 'Please choose at least one profession or group.'); return; }
            if (missing.matches('[data-add-qual]')) { problem(missing, 'Please add at least one qualification (or answer No).'); return; }
            if (missing.matches('[data-qual-type]')) { problem(missing, 'Please choose each qualification (or remove it).'); return; }
            if (missing.matches('[data-qual-k="census"]')) { problem(missing, 'Please choose at least one census designation.'); return; }
            if (missing.matches('[data-qual-k]')) { problem(missing, 'Please fill in each qualification (or remove it).'); return; }
            const field = missing.closest('.field');
            const name = field ? field.querySelector('label, .field-label').textContent : 'this question';
            problem(missing, 'Please answer "' + name + '".');
            return;
        }
        const bad = [...sectionsEl.querySelectorAll('input[data-kind="rate"], input[data-kind="signedRate"]')].find(el => el.offsetParent && Math.abs(Number(el.value)) > 100);
        if (bad) { problem(bad, 'Percentages can’t be over 100.'); return; }
        // A Down Payment Assistance product's years, amounts and match ratio are more than 0
        const zero = [...sectionsEl.querySelectorAll('[data-col="FORGIVEN AFTER YEARS"], [data-col="SECOND LOAN TERM"], [data-col="IDA MATCH RATIO"], [data-col="SECOND LOAN FLAT AMOUNT"], [data-col="SECOND LOAN LTV MAX"], [data-qual-k="money"], [data-qual-k="years"]')]
            .find(el => el.offsetParent && isDpa() && el.value.trim() !== '' && !(num(el.value) > 0));
        if (zero) { problem(zero, 'This needs to be more than 0.'); return; }
        const badMi = miBoxes().find(el => el.offsetParent && el.value.trim() !== '' && !(Number(el.value) >= 0 && Number(el.value) <= MI_MAX_QUOTE * 100));
        if (badMi) { problem(badMi, 'Each annual premium must be from 0 to ' + MI_MAX_QUOTE * 100 + '% of the loan a year (' + badMi.getAttribute('aria-label') + ').'); return; }
        // Credit scores from 300 to 850, each tier's listed once, and each max DTI over 0
        const badScore = [...sectionsEl.querySelectorAll('[data-kind="score"], [data-tier-k="score"], [data-qual-k="score"]')].find(el => el.offsetParent && el.value.trim() !== '' && !scoreOk(el.value));
        if (badScore) { problem(badScore, 'Credit scores go from ' + CREDIT_MIN + ' (the lowest possible) to ' + CREDIT_MAX + ' (the highest).'); return; }
        const tierScores = tierRows().map(r => r.querySelector('[data-tier-k="score"]')).filter(el => el.offsetParent && el.value.trim() !== '');
        const twice = tierScores.find((el, i) => tierScores.findIndex(o => +o.value === +el.value) !== i);
        if (twice) { problem(twice, 'Each credit score can only be listed once (' + twice.value.trim() + ' is listed twice).'); return; }
        const badDti = [...sectionsEl.querySelectorAll('[data-tier-k="dti"], [data-tier-k="housing"]')].find(el => el.offsetParent && el.value.trim() !== '' && !(Number(el.value) > 0 && Number(el.value) <= 100));
        if (badDti) { problem(badDti, 'Each max DTI must be more than 0 and no more than 100.'); return; }
        // The rate quotes are submitted on their own first (Submit Quotes, in Rates)
        const submitQuotes = sectionsEl.querySelector('[data-submit-quotes]');
        if (submitQuotes && !isDpa() && sheetMode === 'open') {
            submitQuotes.closest('[data-sheet-actions]').scrollIntoView({ block: 'center' });
            submitQuotes.focus({ preventScroll: true });
            message.textContent = requoting ? 'Please submit the new rate quotes (under Rates), or keep the current ones.' : 'Please submit the rate quotes (Submit Quotes, under Rates) first.';
            return;
        }
        saving = true;
        saveBtn.disabled = true;
        saveBtn.classList.add('is-loading');
        try {
            await ctx.submit(values, ctx.product ? ctx.product.row : null);
            saving = false;
            dialog.close();
        } catch (err) {
            console.error(err);
            message.textContent = ERRORS[err.message] || 'We couldn’t save the loan product. Please try again.';
            if (err.message === 'duplicate_name') problem(sectionsEl.querySelector('[data-col="LOAN PRODUCT NAME"]'), ERRORS.duplicate_name);
        } finally {
            saving = false;
            saveBtn.disabled = false;
            saveBtn.classList.remove('is-loading');
        }
    });

    return {
        open(next) {
            ctx = next;
            draw(ctx.fields);
            dialog.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            message.textContent = '';
            fill(ctx.product ? ctx.product.values : {}, !ctx.product);
            $('#loan-dialog-title').textContent = ctx.product ? 'Edit Loan Product' : 'New Loan Product';
            $('[data-save-text]').textContent = ctx.product ? 'Save Changes' : 'Add Loan Product';
            dialog.showModal();
            lockPageScroll(dialog);
            sectionsEl.scrollTop = 0;
        },
    };
}

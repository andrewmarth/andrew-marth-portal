# Firestore layout for the Portal

The portal's data lives in Firestore: project `andrew-marth-portal`, database `(default)`, in us-west1. The Portal
API (`api/`) and the wholesale email function (`wholesale-extractor/`) are the only things that read or write it.
You can edit it by hand in the Firebase console.

## Collections

| Collection | What's in it | Document ID |
|---|---|---|
| `accounts` | Each client and their roles (BUYER, SELLER, LENDER, ADMIN, CUM, ...), what Down Payment Assistance programs ask about: PROFESSION GROUPS (JSON list of names from /dpa.js; `Veteran (With benefits)` is a veteran who can use a VA loan; `["None Of These"]` when none apply), REAL ESTATE OWNED (JSON [{ STREET, CITY, STATE, ZIP, OWNERSHIP (`Personal`, `LLC` or `Trust`), OWNER, PURCHASED, SOLD (`YYYY-MM-DD`; blank while they still own it), USE (`Primary Residence`, `Secondary Residence` or `Investment`), INVESTMENT (`Fix & Flip`, `Fix & Rent` or `Turn-Key Rental`) }]; `[]` when they have never owned real estate; blank when not answered: it replaced LAST OWNED HOME, `Never` or a year, still read until it's answered) and HOMEBUYER EDUCATION, whether a veteran with benefits has used a VA loan before (VA LOAN USED), and LLCS and TRUSTS (JSON [{ NAME, TITLE }]: the LLCs and trusts a buyer, flipper buyer, flipper seller or landlord buys or holds property through; `[]` when they have none; blank when not answered). The old VETERAN (yes/no) counts as `Veteran (With benefits)` and FLIPPER LLC / FLIPPER TITLE as one LLC until those are saved again, which clears them. Clients can edit these on their Settings page; their credit score stays in `income` | the 10-digit phone number (ACCOUNT ID) |
| `income` | Each client's jobs, debts and credit score | the 10-digit phone number (ACCOUNT ID) |
| `pages` | Buyer Breakdowns, Seller Nets and Flips (PAGE TYPE says which). LENDER FEE OVERRIDES: the page's own lender fee amounts (JSON { fee: amount }; the fee is a loan product fee column like APPRAISAL DEPOSIT, or "OTHER: " + an added fee's name), used instead of the loan product's. Buyer Breakdown people: Buyer 1-4 in order in PRIMARY / ALT ACCOUNT ID 1-3 (type Purchaser), then the collaborators; collaborators past the six columns in MORE COLLABORATORS (JSON list of account IDs). BUYER ENTITY TYPE (`Individual(s)`, `LLC` or `Trust`) and BUYER ENTITY NAME: the LLC or trust every buyer has in their own LLCS / TRUSTS. Seller Net people: the same, with Seller 1-4 (type Seller) and SELLER TYPE (`Individual(s)`, `LLC` or `Trust`) with LLC NAME or TRUST NAME: the LLC or trust every seller has in their own LLCS / TRUSTS; each seller's SIGNER TITLE beside them. Seller Net expected buyer: BUYER PROFESSION GROUPS and BUYER ALSO QUALIFIES AS (names joined by ` | `; they replace BUYER QUALIFIES AS, still read on a page with neither); BUYER FINANCING is `Cash` for a cash buyer, otherwise blank (BUYER LOAN PRODUCT's type decides; older pages may still say Fixed Rate Loan, Adjustable Rate Loan or VA Loan). Both page types: PRIOR POLICY DATE (when the property's last owner's title policy was issued) and PRIOR POLICY INSURER (the titleCompanies ID that insured it), for the Prior Policy discounts; OWNERS TITLE DISCOUNT no longer applies a Prior Policy discount. Seller Net, for the title company's other fees: FOREIGN SELLER and HAS SEPTIC (Global Settings: TRUE / FALSE), 1031 EXCHANGE and ELECTRONIC SERVICE (TRUE / FALSE), HOLDBACK AMOUNT (dollars held back in escrow; 0 for none). Both page types: SELF CERTIFIED INVESTOR (TRUE / FALSE: the clients certify they're investors, for a title company's `certify` Investor discount). Both page types: HAS HOA OTHER FEES (Yes / No) and HOA OTHER FEES (a JSON list of { NAME, AMOUNT, PAYER: Buyer / Seller }, one line each in the breakdown); they replace HOA OTHER FEE and WHO PAYS OTHER FEE, which are still read (as one fee named "HOA Other Fee") on a page without a list, and cleared when the list is saved. Both page types: HOA PRIMARY MONTHLY DUES and HOA MASTER MONTHLY DUES are the amount of each payment (the names are from when they were always monthly), paid as often as HOA PRIMARY / MASTER DUES INTERVAL says (Monthly, Quarterly, Bi-Annually or Annually; blank: Monthly; the HOA is taken to bill on the calendar, so a proration credits the rest of the quarter, half year or year closing falls in); HOA PREPAID DUES MONTHS (whole months of both associations' dues the HOA collects ahead at closing) and WHO PAYS PREPAID DUES (Buyer / Seller; blank: the seller). Seller Net: HAS SELLER OTHER FEES (Yes / No) and SELLER OTHER FEES (a JSON list of { NAME, AMOUNT }): the seller's other costs (Miscellaneous), one line each in the net sheet. Seller Net, for the title company's discounts: SELLER NON PROFIT (Global Settings) and CORPORATE RELOCATION (TRUE / FALSE; they replace CLIENT QUALIFIES AS there, still read while they're blank); EXTRA TITLE FEES only picks fees whose WHEN is Sometimes (on a Buyer Breakdown, also the ones that follow those settings) | the PAGE ID (e.g. `4274`) |
| `loanProducts` | Lenders' loan products (ACCOUNT ID is the lender account that added it; LENDER NAME is its lender; RATE QUOTES is the lender's 27 quoted rates as JSON { QUOTES, TODAY, BASE, DATE } (TODAY: today's rate the day they were quoted for BASE, the kind of loan: Conventional, FHA, VA or Jumbo, from the product's type; a sheet from before BASE was measured against Conventional's, and an FHA, VA or Jumbo one is shown measured against its own from rateHistory) and BUYDOWN QUOTES its rates with 1%-4% in points as JSON { QUOTES }, see /rate-markups.js; MIN CREDIT SCORE is the lowest score it accepts, 300 for none; MAX DTI TIERS is its max DTI from each credit score as JSON [{ SCORE, DTI, HOUSING }]; MI QUOTES is its 27 annual mortgage insurance premiums as JSON { QUOTES } and NO MI GUIDELINES is TRUE for a Jumbo or Non-Conforming product without mortgage insurance, see /mortgage-insurance.js; a Down Payment Assistance product's DPA LOAN TYPE, its amount as SECOND LOAN AMOUNT TYPE with SECOND LOAN LTV MAX or SECOND LOAN FLAT AMOUNT, COMBINED LOANS CAN EXCEED PRICE, EXCESS REFUNDED TO BUYER, AFFECTS FIRST LOAN RATE, FIRST LOAN RATE MARKUP, DPA QUALIFICATIONS as JSON [{ TYPE, VALUE }], see /dpa.js; any product can be for certain professions / groups only: GROUP SPECIFIC, with ELIGIBLE GROUPS as a JSON list; LENDER CREDITS is its credits as JSON [{ NAME, WHEN, VALUE, TYPE, AMOUNT }], see /lender-credits.js, replacing the LENDER CREDIT ... and CENSUS CREDIT ... columns) | automatic |
| `lenders` | The admin Lenders card's lenders (NAME). A lender's loan products are those whose LENDER NAME is its name, and its linked lender accounts those whose LENDER BANK is its name | automatic |
| `settings` | `interestRate`: TODAY INTEREST RATE (Mortgage News Daily's 30 year fixed rate, pulled each weekday by the API's scheduled rate check, every 15 minutes from 9 AM to midnight Eastern until it's posted; the rate for Conventional loans), TODAY FHA RATE, TODAY VA RATE and TODAY JUMBO RATE (MND's 30 year FHA, VA and Jumbo rates, for those types of loan products; each with PREVIOUS FHA RATE...; with RATE DATE, PREVIOUS INTEREST RATE, RATE SOURCE, RATE UPDATED AT (Eastern time, as text) and RATE UPDATED ISO). `mortgageInsurance`: the upfront mortgage insurance estimate's settings (MI REMOVAL LTV, HOME APPRECIATION, MI MIN YEARS, MI DISCOUNT RATE; see /mortgage-insurance.js) | `interestRate`, `mortgageInsurance` |
| `rateHistory` | Mortgage News Daily's rates for each day the rate check saved (30 YR FIXED, 15 YR FIXED, 30 YR JUMBO, 7/6 SOFR ARM, 30 YR FHA, 30 YR VA as decimals) | the date (`2026-11-13`) |
| `homeInspectors`, `sewerInspectors`, `termiteInspectors` | Each inspector's price list | automatic |
| `cumTransactions`, `cumBalances` | Cash flow transactions and bank balances (a Roadhouse Paycheck has TYPE `Roadhouse Paycheck` and its shifts in ROADHOUSE SHIFTS as JSON: [{ hours, sales, tipPercent }]) | automatic |
| `cumSettings` | Each CUM account's Roadhouse Paycheck Settings (TIP POOL PAYOUT %, TIP POOL RECEIVED %, HOURLY RATE, AZ / FITW / MED / SS TAX %; percents as decimals) and SAVINGS ALLOCATION (money set aside for savings; a Spending Budget transaction's own SAVINGS ALLOCATION is added to it on the budget's Monday, when the budget is checked off) | the 10-digit phone number (ACCOUNT ID) |
| `roadhouseShows` | Each CUM account's show times for the day (roadhouse.html): DAY (YYYY-MM-DD, Arizona time; a day runs 6 AM to 6 AM, and an earlier day's list is deleted the next time it's read), SHOWS (each { ID, AUDITORIUM, START, END as "HH:MM" 24-hour, ROWS, and OPEN DONE / DROP DONE / PICKUP DONE as ISO times, blank until done }) and UPDATED AT | the 10-digit phone number (ACCOUNT ID) |
| `wholesaleDeals` | Wholesale deals from email (the flip map) | automatic |
| `links` | The admin Links card (TITLE, DESCRIPTION, SECTION, LINK) | automatic |
| `marketingPoints` | The admin Marketing Points card (TITLE, DESCRIPTION, LINK, LINK TEXT, and IMAGE DRIVE FILE ID / IMAGE NAME for a picture in the Marketing Points Drive folder) | automatic |
| `titleCompanies` | The admin Title Companies card: each company's filed fees (NAME, ESCROW RATE TABLE and OWNERS TITLE TABLE as lists of { UP TO, FEE }, add-ons, seller shares, DISCOUNTS and TITLE DISCOUNTS as lists of { NAME, PERCENT, QUALIFIES, APPLIES, INVESTOR RULE, INVESTOR PROPERTIES, INVESTOR YEARS, PRIOR POLICY COMPANY, PRIOR POLICY YEARS }, OTHER FEES). An Investor discount's INVESTOR RULE: `owned` (INVESTOR PROPERTIES in the last INVESTOR YEARS years), `current` (owns INVESTOR PROPERTIES now) or `certify` (a page's SELF CERTIFIED INVESTOR); saved before the rule: `owned` with INVESTOR PROPERTIES, otherwise `certify`. A Prior Policy discount applies on its own from a page's PRIOR POLICY DATE and PRIOR POLICY INSURER: PRIOR POLICY COMPANY `same` (only when this company insured it) or `any`, PRIOR POLICY YEARS (issued within that many years; blank: any age). OTHER FEES' WHEN: Every Sale, With a Loan, Manufactured Home, Foreign Seller, Septic, 1031 Exchange, Holdback, Electronic Service (those five follow a Seller Net's settings), Accelerated Escrow (with MAX ESCROW DAYS and DAY TYPE `calendar` or `business`: applies when either page's ESCROW DURATION is that many days or fewer; business days are the weekdays from OFFER ACCEPTANCE DATE to closing, less federal holidays), Holdback (optionally with RANGES: [{ UP TO (blank: any amount above), FEE }], priced by a Seller Net's HOLDBACK AMOUNT), Refinance or Sometimes (picked on the page) | automatic |
| `tasks` | Current Tasks (ASSIGNED is the account) | the TASK ID |
| `signatures` | One per signer of each document sent for signature | automatic |
| `documents` | One per signed PDF filed to Drive (CATEGORY says which log) | automatic |
| `wholesaleZips` | Target zips for wholesale deals: add a document to add a zip, delete one to drop it | the zip |
| `wholesaleStatus` | Each property API's `USAGE` (written by the function) and `CAP` (its limit) | the API's name (e.g. `REDFIN.COM DATA`) |
| `wholesaleHistory` | One per email the wholesale function handled | automatic |

The API also keeps a few collections of its own: `geocodes` (wholesale map positions), `locks` (short-lived, so two
requests don't hand out the same ID) and `filingClaims` (signed documents already filed).

## Rules for every document

- **Field names are upper-case column names** (`PURCHASE PRICE`, `ALT ACCOUNT ID 1`, ...). The pages read values by
  these names. `api/lib/columns.json` lists each collection's usual fields in order.
- **Values are stored as real types:**
  - Numbers are numbers: `500000`, not `$500,000.00`.
  - Percentages are decimals: `0.025` for 2.5%.
  - Yes/no fields are true/false.
  - Text is text.
- **Dates are text in `YYYY-MM-DD` form** (e.g. `2026-11-04`). They sort correctly and avoid time-zone shifts.
  Dates with a time (a signature's SENT DATE, a history entry's DATE) are `YYYY-MM-DD HH:MM:SS`, in Phoenix time.
- **Phone numbers / account IDs are 10-digit text** (`4805550123`) everywhere they appear, including
  `ALT ACCOUNT ID 1`, `LENDER ACCOUNT ID`, `SIGNER ACCOUNT ID 1` and the rest.
- **Blank values are left out** of the document. A missing field reads as blank.
- **List order is kept in an `_order` number.** New documents get the time they were created (in microseconds), so
  they sort after older ones.

## Editing in the Firebase console

- To edit a value, open the document and change the field. Keep the type the same: number, boolean or string.
- To add a field, add it to the documents that need it. The API treats a missing field as blank, so documents
  without it don't need to be touched.
- To add an entry to a collection with automatic IDs, add a document and give it an `_order` (any number larger
  than the others puts it last).

## Access

- Browsers can't read or write Firestore at all (`firestore.rules` denies everything). Everything goes through the
  Portal API.
- The API runs as `portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com`. It can read and write Firestore,
  and it reaches Google Drive as tiffany@andrewmarth.com, where the signed PDFs and wholesale photos are.
- The wholesale function runs as `wholesale-deal-extractor@bamboo-research-511821-j2.iam.gserviceaccount.com`
  (Cloud Datastore User on this project).
- Secrets (Documenso API token, Maps geocoding key) are in Secret Manager in the Website APIs project.
